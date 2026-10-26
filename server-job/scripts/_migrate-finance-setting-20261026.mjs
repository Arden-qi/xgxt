/**
 * 结构补齐 · 催费提醒设置（2026-10-26）
 * ============================================================
 *
 * 【背景】
 *   用户口径：催费不再按「教学 t_class_fee 的到期日 + 20 天窗口」判断，
 *   改为**以财务账单（餐费/住宿费/保险费）的到期日为准**，提前 N 天提醒续费。
 *   这个 N 要能在「费用标准」页里改，所以得有地方存。
 *
 * 【做两件事，幂等】
 *   ① 新建 `sms_finance.t_finance_setting`（KV 配置表）
 *        setting_key / setting_value / update_time / update_by
 *   ② 预置 `urgeAheadDays = 15`（不存在才插，不覆盖用户改过的值）
 *
 * 【用法】
 *   node scripts/_migrate-finance-setting-20261026.mjs            # 预演
 *   node scripts/_migrate-finance-setting-20261026.mjs --apply    # 执行
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

async function tableExists(schema, table) {
  const [rows] = await db.raw(
    `select count(*) as c from information_schema.TABLES
      where TABLE_SCHEMA = ? and TABLE_NAME = ?`,
    [schema, table],
  );
  return Number(rows[0].c) > 0;
}

try {
  /* ---------------- ① 建配置表 ---------------- */
  if (await tableExists(FINANCE_DB, 't_finance_setting')) {
    plan.push(`已存在 ${FINANCE_DB}.t_finance_setting`);
  } else {
    plan.push(`新建表 ${FINANCE_DB}.t_finance_setting（KV 配置）`);
    if (APPLY) {
      await db.raw(`
        create table \`${FINANCE_DB}\`.t_finance_setting (
          setting_key   varchar(64)  not null comment '配置键',
          setting_value varchar(255) not null default '' comment '配置值',
          update_time   datetime     null comment '更新时间',
          update_by     varchar(64)  null comment '更新人',
          primary key (setting_key)
        ) engine=InnoDB default charset=utf8mb4 comment='财务配置（催费提醒等）'
      `);
      done.push('建表 t_finance_setting');
    }
  }

  /* ---------------- ② 预置催费提前天数 ---------------- */
  if (APPLY && (await tableExists(FINANCE_DB, 't_finance_setting'))) {
    const [exist] = await db.raw(
      `select setting_value from \`${FINANCE_DB}\`.t_finance_setting where setting_key = 'urgeAheadDays'`,
    );
    if (exist.length) {
      plan.push(`已存在 urgeAheadDays = ${exist[0].setting_value}（不覆盖）`);
    } else {
      await db.raw(
        `insert into \`${FINANCE_DB}\`.t_finance_setting (setting_key, setting_value, update_time)
         values ('urgeAheadDays', '15', now())`,
      );
      plan.push('预置 urgeAheadDays = 15');
      done.push('预置 urgeAheadDays');
    }
  } else if (!APPLY) {
    plan.push('预演：将预置 urgeAheadDays = 15');
  }

  console.log('—— 计划 / 结果 ——');
  for (const p of plan) console.log(`  · ${p}`);
  if (APPLY) console.log(`\n✔ 已执行 ${done.length} 项`);
  else console.log('\n（预演结束，未写库。确认后加 --apply）');
} catch (e) {
  console.error('\n✖ 失败：', e.message);
  process.exitCode = 1;
} finally {
  await db.destroy();
}
