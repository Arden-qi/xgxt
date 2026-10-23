/**
 * 结构补齐 · 退费「校长审批 → 财务退费管理」同步链（2026-10-22）
 * ============================================================
 *
 * 【为什么单独一个脚本，而不写进 knex 迁移】
 *   `knexfile` 里**没有 finance env**（只有 job / class / class-jh / class-common / consult / edu），
 *   `migrations-class-common` 连的是 `sms_common` —— 放进去改不到 `sms_finance`。
 *   这与 consult 库同一类坑（见 MEMORY.md 第 7 节）。
 *   → 财务库的结构变更一律用本目录下的独立脚本，显式指定库连接。
 *
 * 【本脚本做三件事，全部幂等（可重复跑）】
 *   ① `sms_finance.t_finance_refund` 加 3 列：
 *        source_module     上游模块（teaching 教学域 / consult 咨询）
 *        source_stage      上游学段（jh 初高中 / class 大学 / job 就业）
 *        source_refund_id  上游退费单 id（出款后按它对回上游）
 *      ＋ 唯一索引 `uk_source(source_module, source_refund_id)`
 *        —— 这是**防重复推送**的最后一道闸：同一张上游单只能落一条财务单。
 *        ⚠️ 历史行的 source_module 是 NULL，MySQL 唯一索引允许多个 NULL → 老数据不受影响。
 *   ② 新建 `sms_finance.t_finance_refund_item`（费用项明细）
 *        —— 用户口径 2026-10-22：「每一个费用项都要在财务那里对应一行」。
 *        主单仍是一笔出款（一张账单），明细只用于核对与展示，不参与出款金额计算。
 *   ③ `sms_common.t_uni_refund` 加 2 列：
 *        finance_refund_id / finance_refund_no
 *        —— 教学侧要知道「这张单在财务是哪个号」，出款回写与溯源都靠它。
 *        ⚠️ 老表（sms_job.t_job_refund 等）**不加**：P8 之后教学域写入只走统一表，
 *           仓储里 `tblTrx()` 的开关关分支已删除（见 teaching/shared/uniTable.ts）。
 *
 * 【用法】
 *   node scripts/_migrate-finance-refund-20261022.mjs            # 只预演，不写库
 *   node scripts/_migrate-finance-refund-20261022.mjs --apply    # 真正执行
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
const COMMON_DB = process.env.DB_NAME_COMMON || 'sms_common';

const plan = [];
const done = [];

/** 某库某表现有列 */
async function columnsOf(schema, table) {
  const [rows] = await db.raw(
    `select COLUMN_NAME as name from information_schema.COLUMNS
      where TABLE_SCHEMA = ? and TABLE_NAME = ?`,
    [schema, table],
  );
  return new Set(rows.map((r) => String(r.name)));
}

/** 某库某表是否存在 */
async function tableExists(schema, table) {
  const [rows] = await db.raw(
    `select TABLE_NAME as name from information_schema.TABLES
      where TABLE_SCHEMA = ? and TABLE_NAME = ?`,
    [schema, table],
  );
  return rows.length > 0;
}

/** 某库某表是否已有某索引 */
async function indexExists(schema, table, indexName) {
  const [rows] = await db.raw(
    `select INDEX_NAME as name from information_schema.STATISTICS
      where TABLE_SCHEMA = ? and TABLE_NAME = ? and INDEX_NAME = ? limit 1`,
    [schema, table, indexName],
  );
  return rows.length > 0;
}

async function addColumn(schema, table, column, ddl, comment) {
  const cols = await columnsOf(schema, table);
  const label = `${schema}.${table}.${column}`;
  if (cols.has(column)) {
    plan.push(`跳过（已存在） ${label}`);
    return;
  }
  plan.push(`新增列 ${label} —— ${comment}`);
  if (!APPLY) return;
  await db.raw(`alter table \`${schema}\`.\`${table}\` add column \`${column}\` ${ddl} comment ?`, [
    comment,
  ]);
  done.push(label);
}

async function addIndex(schema, table, indexName, ddl, comment) {
  if (await indexExists(schema, table, indexName)) {
    plan.push(`跳过（已存在） ${schema}.${table} 索引 ${indexName}`);
    return;
  }
  plan.push(`新增索引 ${schema}.${table}.${indexName} —— ${comment}`);
  if (!APPLY) return;
  await db.raw(`alter table \`${schema}\`.\`${table}\` add ${ddl}`);
  done.push(`${schema}.${table}.${indexName}`);
}

async function createRefundItemTable() {
  const exists = await tableExists(FINANCE_DB, 't_finance_refund_item');
  plan.push(`退款明细表 ${FINANCE_DB}.t_finance_refund_item —— ${exists ? '已存在，跳过' : '待新建'}`);
  if (exists || !APPLY) return;
  await db.raw(`
    create table \`${FINANCE_DB}\`.\`t_finance_refund_item\` (
      \`id\`          varchar(64)  not null comment '主键（randomUUID）',
      \`refund_id\`   varchar(64)  not null comment '所属退费单 id（t_finance_refund.id）',
      \`fee_type\`    tinyint      not null comment '费用类型：1学费 2住宿费 3餐费 4保险费 5试学费',
      \`amount\`      bigint       not null default 0 comment '该项退费金额（单位：分）',
      \`is_deleted\`  tinyint(1)   not null default 0 comment '软删：0正常 1已删',
      \`create_by\`   varchar(64)  null comment '创建人 id',
      \`create_time\` datetime     not null default current_timestamp comment '创建时间',
      \`update_by\`   varchar(64)  null comment '更新人 id',
      \`update_time\` datetime     null comment '更新时间',
      primary key (\`id\`),
      key \`idx_refund\` (\`refund_id\`)
    ) engine=InnoDB default charset=utf8mb4 comment='财务退费单费用项明细（一笔退费可含多个费用项）'
  `);
  done.push(`${FINANCE_DB}.t_finance_refund_item`);
}

try {
  console.log(`模式：${APPLY ? '★ 执行（--apply）' : '预演（不写库，加 --apply 才执行）'}\n`);

  /* ---------------- ① 财务退费主表：来源三列 ---------------- */
  await addColumn(
    FINANCE_DB,
    't_finance_refund',
    'source_module',
    'varchar(32) null',
    '上游模块（teaching 教学域 / consult 咨询）',
  );
  await addColumn(
    FINANCE_DB,
    't_finance_refund',
    'source_stage',
    'varchar(16) null',
    '上游学段（jh 初高中 / class 大学 / job 就业）',
  );
  await addColumn(
    FINANCE_DB,
    't_finance_refund',
    'source_refund_id',
    'varchar(64) null',
    '上游退费单 id（出款后按它对回上游）',
  );
  await addIndex(
    FINANCE_DB,
    't_finance_refund',
    'uk_source',
    'unique key `uk_source` (`source_module`, `source_refund_id`)',
    '防重复推送：同一张上游单只能落一条财务退费单',
  );

  /* ---------------- ② 财务退费明细表 ---------------- */
  await createRefundItemTable();

  /* ---------------- ③ 教学统一退费表：财务单号两列 ---------------- */
  if (await tableExists(COMMON_DB, 't_uni_refund')) {
    await addColumn(
      COMMON_DB,
      't_uni_refund',
      'finance_refund_id',
      'varchar(64) null',
      '财务退费单 id（推送成功后回写，出款回写按它溯源）',
    );
    await addColumn(
      COMMON_DB,
      't_uni_refund',
      'finance_refund_no',
      'varchar(32) null',
      '财务退费单号（TF20260001 这类，显示给用户看）',
    );
  } else {
    plan.push(`跳过（表不存在） ${COMMON_DB}.t_uni_refund`);
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
