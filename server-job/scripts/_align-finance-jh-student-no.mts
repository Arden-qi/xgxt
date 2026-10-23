/**
 * 一次性数据订正：把财务库初高部演示学生的学号对齐到教务学号
 * ============================================================
 * ★ 2026-10-22：用户口径「以教务学号为准」
 *
 * 【为什么需要】
 *   财务库 `sms_finance.t_student_base` 里初高部（dept_code=1）的演示学生
 *   用的是 `J26001~J26014` 这一套学号，而教务初高（`sms_class_jh.t_class_student`）
 *   用的是 `S20260001~S20260032` —— **两套完全不同的体系**。
 *
 *   后果：财务→初高的同步是「按学号回查教务学生」
 *   （见 `src/finance/services/class-sync.ts::syncFeeToJh`），
 *   学号对不上 → 回查不到 → 静默跳过 → 初高催费页看不到这批单。
 *   实测：财务初高 14 个学生，学号匹配率 **0/14**；
 *   而财务大学部（dept_code=2，`U26001~U26018`）与教务大学是同一套号，
 *   匹配率 18/18 —— 大学那条链路天生通，初高这条天生断。
 *
 * 【为什么用独立脚本而不是 knex 迁移】
 *   ⚠️ **knexfile 里没有 finance env**（只有 development/staging/production/
 *      edu/class/class-common/class-jh 五个 + 主库），
 *      `migrations-class-common` 连的是 sms_common —— 放进去改不到 sms_finance。
 *      这与「consult 库没有 env → 迁移静默跳过」是同一类坑（见 MEMORY 6 节）。
 *      → 用独立脚本，显式指定 sms_finance 连接。
 *
 * 【为什么不改主键】
 *   财务单主键形如 `FEE-J26001-1`（含学号），改主键会连带断掉跨表引用
 *   （`t_uni_fee.source_id` / `t_uni_urge.source_id` / 咨询侧 finance_fee_id…）。
 *   → 本脚本**只改学号列**（student_no），主键与 student_id 一律不动。
 *
 * 【映射规则：按序号 1:1 对齐】
 *   财务 J2600N ↔ 教务 S2026000N（N=1..14）。
 *   ⚠️ 前 10 个姓名一致或形近（王伟/李芳/张娜/刘敏/陈静/杨强/赵磊
 *      + 黄艳↔黄洋 / 周勇↔周艳 / 吴军↔吴勇 —— 同一批人的异写）；
 *      后 4 个（邓雨欣/罗佳怡/陈嘉豪/梁诗涵 ↔ 徐军/孙杰/马娟/朱涛）
 *      姓名对不上 —— 两批演示种子各自造名，按序号对齐即可。
 *      姓名以**教务**为准（用户口径「以教务学号为准」）。
 *
 * 【安全性】
 *   · 默认预演（只打印计划），`--apply` 才写库
 *   · 目标学号已被别人占用就跳过该条（避免撞 uk_student_no 唯一索引）
 *   · 幂等：已改过的库再跑一次不会重复改
 *   · 不物理删除任何数据
 *
 * 用法（在 server-job 目录下）：
 *   npx tsx scripts/_align-finance-jh-student-no.mts            预演
 *   npx tsx scripts/_align-finance-jh-student-no.mts --apply    执行
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import knex from 'knex';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(ROOT, '.env') });

const APPLY = process.argv.includes('--apply');

/** 需要改学号的财务表（student_no 列） */
const TABLES = [
  't_student_base',
  't_finance_fee',
  't_finance_bill',
  't_finance_refund',
  't_finance_freeze',
];

/** 映射表：财务学号 → 教务学号（按序号 1:1） */
function buildMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (let i = 1; i <= 14; i++) {
    map.set(`J${String(26000 + i).padStart(5, '0')}`, `S2026${String(i).padStart(4, '0')}`);
  }
  return map;
}

const db = knex({
  client: 'mysql2',
  connection: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME_FINANCE || 'sms_finance',
    charset: 'utf8mb4',
    timezone: '+08:00',
  },
});

const map = buildMap();

console.log(`${APPLY ? '【执行】' : '【预演】'} 财务初高部学号 → 教务学号 对齐`);
console.log(`  目标库：${process.env.DB_NAME_FINANCE || 'sms_finance'}`);

let totalChanged = 0;

for (const table of TABLES) {
  const hasTable = await db.schema.hasTable(table);
  if (!hasTable) {
    console.log(`  ${table}: 表不存在，跳过`);
    continue;
  }
  const cols = await db.raw(
    'select COLUMN_NAME from information_schema.COLUMNS where TABLE_SCHEMA = ? and TABLE_NAME = ?',
    [process.env.DB_NAME_FINANCE || 'sms_finance', table],
  );
  if (!cols[0].some((c: any) => c.COLUMN_NAME === 'student_no')) {
    console.log(`  ${table}: 无 student_no 列，跳过`);
    continue;
  }

  for (const [finNo, eduNo] of map) {
    // 目标学号已被别人占用 → 跳过（避免撞唯一索引）
    const occupied = await db(table)
      .where({ student_no: eduNo })
      .whereNot({ student_no: finNo })
      .count({ c: '*' })
      .first();
    if (Number((occupied as any)?.c || 0) > 0) {
      console.log(`  ⚠ ${table}: 目标学号 ${eduNo} 已被占用，跳过 ${finNo}`);
      continue;
    }

    const before = await db(table).where({ student_no: finNo }).count({ c: '*' }).first();
    const n = Number((before as any)?.c || 0);
    if (n === 0) continue;

    if (APPLY) {
      await db(table).where({ student_no: finNo }).update({ student_no: eduNo });
    }
    totalChanged += n;
    console.log(`  ${APPLY ? '✓' : '·'} ${table}: ${finNo} → ${eduNo}（${n} 行）`);
  }
}

console.log(
  APPLY
    ? `  完成：共改写 ${totalChanged} 行学号`
    : `  预演结束：预计改写 ${totalChanged} 行，加 --apply 执行`,
);

await db.destroy();
process.exit(0);
