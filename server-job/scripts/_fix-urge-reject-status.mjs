/**
 * 存量修复：财务「已打回」的单 → 催费行状态回填成 6「核对失败」
 * ============================================================
 * 【为什么需要】
 *   「核对失败(6)」是 2026-10-25 才加的状态，之前财务打回只在财务侧写了
 *   `is_rejected = 1`，催费侧照搬的是财务的 `pay_status = 2 已缴`。
 *   升级后新发生的打回会自动换算成 6，但**升级前已经打回的单**仍然是 2，
 *   班主任看不到「被打回」，也就不会去重传凭证。
 *
 * 【只动这几行】
 *   · 财务单：`is_rejected = 1 AND is_deleted = 0`
 *   · 催费行：`source_system = 'finance' AND source_id = 该财务单 id`
 *            且**当前 pay_status = 2**（已缴才回填；
 *            已经是 3 已核对 / 5 冻结 / 6 核对失败的绝不碰）
 *
 * 【安全】
 *   · 默认 --plan 只打印不写；--apply 才落库
 *   · 软删行不参与（`is_deleted = 0`）
 *   · 禁止物理删除
 *
 * 用法（server-job 目录）：
 *   node scripts/_fix-urge-reject-status.mjs --plan
 *   node scripts/_fix-urge-reject-status.mjs --apply
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(ROOT, '.env') });

const knex = (await import('knex')).default;
const mkconn = (database) =>
  knex({
    client: 'mysql2',
    connection: {
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD ?? '',
      database,
      charset: 'utf8mb4',
      timezone: '+08:00',
      dateStrings: true,
    },
    pool: { min: 0, max: 3 },
  });

const finance = mkconn(process.env.DB_NAME_FINANCE || 'sms_finance');
const common = mkconn(process.env.DB_NAME_COMMON || 'sms_common');

const APPLY = process.argv.includes('--apply');
const ST_PAID = 2;
const ST_REJECTED = 6;

/** 两张催费表：初高/就业共用 t_uni_fee，大学用 t_uni_urge */
const TARGETS = [
  { table: 't_uni_fee', label: 't_uni_fee（初高 / 就业）' },
  { table: 't_uni_urge', label: 't_uni_urge（大学）' },
];

async function main() {
  console.log(`\n===== 回填「核对失败」状态（${APPLY ? 'APPLY' : 'PLAN'}）=====\n`);

  const rejected = (await finance.raw(
    'SELECT id, student_no, fee_type, dept_code, pay_status FROM t_finance_fee WHERE is_deleted=0 AND is_rejected=1',
  ))[0];
  console.log(`财务库已打回的单：${rejected.length} 条`);
  if (!rejected.length) {
    console.log('无需修复。\n');
    return;
  }

  const ids = rejected.map((x) => String(x.id));
  let totalHit = 0;
  let totalChanged = 0;

  for (const t of TARGETS) {
    const rows = (await common.raw(
      `SELECT id, edu_stage, student_no, fee_type, pay_status, source_id
         FROM ${t.table}
        WHERE is_deleted = 0
          AND source_system = 'finance'
          AND source_id IN (${ids.map(() => '?').join(',')})`,
      ids,
    ))[0];
    const hit = rows.filter((r) => Number(r.pay_status) === ST_PAID);
    totalHit += hit.length;
    console.log(`\n${t.label}：命中 ${rows.length} 行，其中「已缴(2)」需回填 ${hit.length} 行`);
    hit.forEach((r) =>
      console.log(`  · ${r.edu_stage || '-'} ${r.student_no} fee=${r.fee_type} id=${r.id} → 2 改成 6`),
    );
    const skip = rows.filter((r) => Number(r.pay_status) !== ST_PAID);
    skip.forEach((r) =>
      console.log(`  · 跳过「${r.student_no}」id=${r.id}（当前 pay_status=${r.pay_status}，不覆盖）`),
    );

    if (APPLY && hit.length) {
      const changed = await common(t.table)
        .whereIn(
          'id',
          hit.map((r) => r.id),
        )
        .where('pay_status', ST_PAID)
        .update({ pay_status: ST_REJECTED, update_time: new Date(), update_by: 'reject-backfill' });
      totalChanged += Number(changed) || 0;
      console.log(`  → 已更新 ${changed} 行`);
    }
  }

  console.log(`\n合计：需回填 ${totalHit} 行${APPLY ? `，实际更新 ${totalChanged} 行` : '（未写入，加 --apply 执行）'}`);

  if (APPLY) {
    const left = (await common.raw(
      `SELECT
         (SELECT COUNT(*) FROM t_uni_fee  WHERE is_deleted=0 AND source_system='finance' AND pay_status=${ST_PAID} AND source_id IN (${ids.map(() => '?').join(',')}))
       + (SELECT COUNT(*) FROM t_uni_urge WHERE is_deleted=0 AND source_system='finance' AND pay_status=${ST_PAID} AND source_id IN (${ids.map(() => '?').join(',')})) AS c`,
      [...ids, ...ids],
    ))[0][0];
    console.log(`复核：仍为「已缴(2)」的打回行 = ${left.c}`);
  }
  console.log('');
}

main()
  .catch((e) => {
    console.error('修复失败：', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.all([finance.destroy().catch(() => {}), common.destroy().catch(() => {})]);
  });
