/**
 * 结构补齐 · 账单到期日 + 缴费单应缴金额（2026-10-26）
 * ============================================================
 *
 * 【为什么单独一个脚本，而不写进 knex 迁移】
 *   同 `_migrate-finance-refund-20261022.mjs`：knexfile 里没有 finance env，
 *   财务库的变更一律用独立脚本显式指定库连接。
 *
 * 【做两件事，全部幂等】
 *   ① `sms_finance.t_finance_bill` 加 `expire_date date null`
 *        —— 餐费 / 住宿费 / 保险费的「到期日」。
 *        用户口径 2026-10-26：财务核对完成后按「缴费金额 ÷ 该费用标准 = 月份数」
 *        算出到期日，账单明细里直接展示（不需展开）。
 *        学费 / 押金 / 校服 / 试学费 / 补费 没有到期概念，保持 NULL。
 *   ② `sms_finance.t_finance_fee` 加 `standard_amount int null`（应缴金额，单位分）
 *        ＋ 历史行回填 `standard_amount = amount`（优惠 = 0）
 *        —— 用户口径：缴费管理里要看到「应缴 / 实缴 / 优惠」三列。
 *        老单据没有应缴记录，回填成实缴是最安全的（不篡改历史、优惠显示 0）。
 *
 * 【用法】
 *   node scripts/_migrate-finance-bill-expire-20261026.mjs            # 预演
 *   node scripts/_migrate-finance-bill-expire-20261026.mjs --apply    # 执行
 */

import 'dotenv/config';
import knex from 'knex';

const APPLY = process.argv.includes('--apply');

const db = knex({
  client: 'mysql2',
  connection: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    multipleStatements: true,
  },
  pool: { min: 0, max: 5 },
});

const FINANCE_DB = process.env.DB_NAME_FINANCE || 'sms_finance';

const plan = [];
const done = [];

async function columnsOf(schema, table) {
  const [rows] = await db.raw(
    `select COLUMN_NAME as name from information_schema.COLUMNS
      where TABLE_SCHEMA = ? and TABLE_NAME = ?`,
    [schema, table],
  );
  return new Set(rows.map((r) => r.name));
}

async function tableExists(schema, table) {
  const [rows] = await db.raw(
    `select count(*) as c from information_schema.TABLES
      where TABLE_SCHEMA = ? and TABLE_NAME = ?`,
    [schema, table],
  );
  return Number(rows[0].c) > 0;
}

async function addColumnIfMissing(table, column, ddl, note) {
  if (!(await tableExists(FINANCE_DB, table))) {
    plan.push(`跳过（表不存在） ${FINANCE_DB}.${table}`);
    return false;
  }
  const cols = await columnsOf(FINANCE_DB, table);
  if (cols.has(column)) {
    plan.push(`已存在 ${FINANCE_DB}.${table}.${column}`);
    return false;
  }
  plan.push(`新增列 ${FINANCE_DB}.${table}.${column} —— ${note}`);
  if (APPLY) {
    await db.raw(`alter table \`${FINANCE_DB}\`.\`${table}\` add column \`${column}\` ${ddl}`);
    done.push(`${table}.${column}`);
  }
  return true;
}

try {
  /* ---------------- ① 账单到期日 ---------------- */
  await addColumnIfMissing(
    't_finance_bill',
    'expire_date',
    'date null',
    '餐费/住宿费/保险费的到期日（核对时按标准算出；学费等无到期概念）',
  );

  /* ---------------- ② 缴费单应缴金额 ---------------- */
  const addedStd = await addColumnIfMissing(
    't_finance_fee',
    'standard_amount',
    'int null',
    '应缴金额（分）。实缴 = amount，优惠 = standard_amount - amount',
  );

  /* ---------------- ③ 历史行回填 ---------------- */
  const feeCols = await columnsOf(FINANCE_DB, 't_finance_fee');
  if (!feeCols.has('standard_amount')) {
    plan.push('回填待执行：列尚未创建（本脚本 --apply 时会先加列再回填）');
  } else {
    const [cntRows] = await db.raw(
      `select count(*) as c from \`${FINANCE_DB}\`.t_finance_fee where standard_amount is null`,
    );
    const n = Number(cntRows[0].c);
    if (n > 0) {
      plan.push(`回填 ${FINANCE_DB}.t_finance_fee.standard_amount = amount（${n} 行，视为无优惠）`);
      if (APPLY) {
        const [r] = await db.raw(
          `update \`${FINANCE_DB}\`.t_finance_fee set standard_amount = amount where standard_amount is null`,
        );
        done.push(`回填 ${r.affectedRows ?? n} 行`);
      }
    } else {
      plan.push('无需回填（standard_amount 已全部有值）');
    }
  }
  if (addedStd) {
    // 新列默认值：新建单不传应缴时由业务层落 amount，这里不再设 DB 默认
    plan.push('提示：新建单由 feeService 写入 standard_amount（取标准价或调用方传入）');
  }

  console.log('—— 计划 / 结果 ——');
  for (const p of plan) console.log(`  · ${p}`);
  if (APPLY) {
    console.log(`\n✔ 已执行 ${done.length} 项`);
  } else {
    console.log('\n（预演结束，未写库。确认无误后加 --apply 再跑一次）');
  }
} catch (e) {
  console.error('\n✖ 失败：', e.message);
  process.exitCode = 1;
} finally {
  await db.destroy();
}
