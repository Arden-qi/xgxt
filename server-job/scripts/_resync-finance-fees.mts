/**
 * 一次性回推：把财务库**已有的**缴费单重新推给三个部门（补历史单）
 * ============================================================
 * 【为什么需要】
 *   `syncFeeToAll(id)` 只在「财务建单 / 改单 / 核对」时被调用
 *   （见 `finance/routes/fee.route.ts`），**没有定时任务**。所以
 *   功能上线**之前**建的历史单永远不会被推给下游。
 *
 * 【★ 为什么不能只报「调用成功 N 张」】
 *   `syncFeeToAll` 内部每一步都 try/catch（失败只 `console.warn`，
 *   不抛错 —— 这是设计：钱已经收好了，同步失败不该让主流程崩）。
 *   → 「函数返回了」**不等于**「数据落库了」。
 *   本脚本 v1 就是这么写的，回推完打印「成功 100 张，异常 0 张」，
 *   实际下游一行没多 —— 排查了很久才发现是**假象**。
 *   → v2 改成：**回推完逐条核对下游表**，只报真实落库数。
 *
 * 【核对口径】
 *   · 初高 → sms_common.t_uni_fee   (edu_stage='jh')
 *   · 大学 → sms_common.t_uni_urge  (edu_stage='class')  ← 催费页读这张
 *   · 就业 → sms_common.t_uni_fee   (edu_stage='job')
 *   幂等键统一是 `source_system='finance' + source_id=财务单id`。
 *
 * 【安全性】
 *   · 只调既有的幂等同步函数，重复跑不会插重复行
 *   · 不覆盖下游已经登记的信息（缴费方式/实缴金额是下游自己的）
 *   · 每条同步内部都 try/catch，单条失败不影响整批
 *   · 学号在教务查不到的单会被同步逻辑**自动跳过**（设计行为，不是报错）
 *     —— 所以「落库数 < 单数」是正常的，脚本会单独列出「未落库」的清单
 *
 * 用法（在 server-job 目录下）：
 *   npx tsx scripts/_resync-finance-fees.mts           预演：只统计，不写库
 *   npx tsx scripts/_resync-finance-fees.mts --apply   真正执行 + 核对
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import knex from 'knex';
import { db } from '../src/finance/utils/db';
import { syncFeeToAll } from '../src/finance/services/class-sync';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(ROOT, '.env') });

const APPLY = process.argv.includes('--apply');

/** 下游核对用的连接（sms_common） */
const common = knex({
  client: 'mysql2',
  connection: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME_COMMON || 'sms_common',
    charset: 'utf8mb4',
    timezone: '+08:00',
  },
});

const fees = (await db('t_finance_fee')
  .where({ is_deleted: 0 })
  .select('id', 'dept_code', 'student_no')
  .orderBy('create_time')) as Array<Record<string, any>>;

const byDept: Record<string, number> = {};
for (const f of fees) {
  const k = String(f.dept_code ?? 'null');
  byDept[k] = (byDept[k] || 0) + 1;
}

console.log(`${APPLY ? '【执行】' : '【预演】'} 回推财务缴费单`);
console.log(`  有效单合计 ${fees.length} 张，按部门（1=初高中 2=大学 3=就业）：${JSON.stringify(byDept)}`);

if (!APPLY) {
  console.log('  预演结束，加 --apply 执行');
  await common.destroy();
  process.exit(0);
}

let thrown = 0;
for (const f of fees) {
  try {
    // eslint-disable-next-line no-await-in-loop
    await syncFeeToAll(String(f.id));
  } catch (e: any) {
    thrown++;
    console.log(`  ✗ ${f.id} 抛错：${e?.message || e}`);
  }
}

/* ============================================================
 * 核对：逐部门查下游表，比对「这张单到底落没落库」
 * ============================================================ */
console.log('');
console.log('【核对落库情况】');

/** 该部门的单据应该出现在哪张表 */
const TARGETS: Record<string, { table: string; stage: string; label: string }> = {
  '1': { table: 't_uni_fee', stage: 'jh', label: '初高中（缴费台账）' },
  '2': { table: 't_uni_urge', stage: 'class', label: '大学（催费副本）' },
  '3': { table: 't_uni_fee', stage: 'job', label: '就业（催费单）' },
};

let totalMissing = 0;

for (const [dept, target] of Object.entries(TARGETS)) {
  const deptFees = fees.filter((f) => String(f.dept_code) === dept);
  if (deptFees.length === 0) continue;

  const landed = (await common(target.table)
    .where({ edu_stage: target.stage, source_system: 'finance' })
    .pluck('source_id')) as string[];
  const landedSet = new Set(landed);

  const missing = deptFees
    .map((f) => String(f.id))
    .filter((id) => !landedSet.has(id));

  totalMissing += missing.length;
  const rate = deptFees.length
    ? (((deptFees.length - missing.length) / deptFees.length) * 100).toFixed(1)
    : '0.0';
  console.log(
    `  ${target.label}：应落 ${deptFees.length} 张，实落 ${deptFees.length - missing.length} 张（${rate}%）`,
  );
  if (missing.length) {
    console.log(`    未落库 ${missing.length} 张：${missing.slice(0, 6).join(', ')}${missing.length > 6 ? ' …' : ''}`);
    console.log('    （学号在教务查不到的单会被自动跳过 —— 属设计行为，不是报错）');
  }
}

console.log('');
console.log(`  回推结束：调用 ${fees.length} 张，抛错 ${thrown} 张，未落库 ${totalMissing} 张`);

await common.destroy();
process.exit(0);
