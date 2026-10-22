/**
 * 迁移：统一表「回填兜底」——给老数据搬不进来的 NOT NULL 列补值（sms_common）
 * ============================================================
 * ★ 2026-10-22 接 `20261022_004`。
 *   本机老表与统一表的列集合不一致：统一表有些列**老表压根没有**
 *   （例：`t_uni_dorm_room.dorm_gender`、`t_uni_fee.due_date`），
 *   而这些列又是 `NOT NULL` 且**无默认值** → 回填时必报
 *   `Field 'xxx' doesn't have a default value`，整表搬不进去。
 *
 * 【兜底规则】（只动「NOT NULL 且无默认值」的列，其它列一律不碰）
 *   · 数值（int/tinyint/bigint/decimal）→ `DEFAULT 0`
 *   · 字符串（char/varchar/text）      → `DEFAULT ''`
 *   · 日期时间（date/datetime/timestamp）→ **改为可空**
 *     （给历史数据硬塞一个 1970 或 CURRENT_TIMESTAMP 会制造假数据，
 *       显示层本来就是 `fmtDate()` 空值兜底）
 *   · 跳过 `id` / `edu_stage`：这两列回填时一定显式给值，不能有默认值兜底，
 *     否则漏传会静默生出脏行。
 *
 * 【为什么写成「按表+按类型」的循环而不是一条条列出来】
 *   本机跟权威库的列差异会随合并不断变化；按规则兜底可以一次覆盖同类问题，
 *   而且幂等——已经补过默认值的列在 `information_schema` 里 `COLUMN_DEFAULT` 非空，直接跳过。
 */

const DB = 'sms_common';
const TABLES = ['t_uni_fee', 't_uni_dorm_room', 't_uni_dorm_bed', 't_uni_dorm_building', 't_uni_exam'];
const SKIP = new Set(['id', 'edu_stage']);

async function pendingCols(knex) {
  const [rows] = await knex.raw(
    `select TABLE_NAME t, COLUMN_NAME c, DATA_TYPE d, COLUMN_TYPE ty
       from information_schema.COLUMNS
      where TABLE_SCHEMA=? and TABLE_NAME in (${TABLES.map(() => '?').join(',')})
        and IS_NULLABLE='NO' and COLUMN_DEFAULT is null
      order by TABLE_NAME, ORDINAL_POSITION`,
    [DB, ...TABLES],
  );
  return rows.filter((r) => !SKIP.has(r.c));
}

const isNum = (d) => /int|decimal|numeric|float|double|bit/.test(d);
const isStr = (d) => /char|text|blob|enum|set|json/.test(d);
const isTime = (d) => /date|time/.test(d);

/**
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  const cols = await pendingCols(knex);
  for (const r of cols) {
    if (isNum(r.d)) {
      await knex.raw(`alter table \`${DB}\`.\`${r.t}\` modify column \`${r.c}\` ${r.ty} NOT NULL DEFAULT 0`);
    } else if (isStr(r.d)) {
      await knex.raw(`alter table \`${DB}\`.\`${r.t}\` modify column \`${r.c}\` ${r.ty} NOT NULL DEFAULT ''`);
    } else if (isTime(r.d)) {
      await knex.raw(`alter table \`${DB}\`.\`${r.t}\` modify column \`${r.c}\` ${r.ty} NULL DEFAULT NULL`);
    }
  }
  console.log(`[20261022_005] 兜底 ${cols.length} 列：${cols.map((r) => `${r.t}.${r.c}`).join(', ')}`);
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  /* 回滚 = 把本次加上的默认值撤掉、时间列恢复 NOT NULL。
     ⚠️ 若库里已有靠默认值插进来的行（NULL 时间列），恢复 NOT NULL 会失败 ——
        回滚前请先清空统一表里这批回填数据（老表数据不受影响）。 */
  const [rows] = await knex.raw(
    `select TABLE_NAME t, COLUMN_NAME c, DATA_TYPE d, COLUMN_TYPE ty
       from information_schema.COLUMNS
      where TABLE_SCHEMA=? and TABLE_NAME in (${TABLES.map(() => '?').join(',')})
        and IS_NULLABLE='NO' and COLUMN_DEFAULT is not null
      order by TABLE_NAME, ORDINAL_POSITION`,
    [DB, ...TABLES],
  );
  for (const r of rows) {
    if (SKIP.has(r.c)) continue;
    if (isNum(r.d) || isStr(r.d)) {
      await knex.raw(`alter table \`${DB}\`.\`${r.t}\` modify column \`${r.c}\` ${r.ty} NOT NULL`);
    }
  }
  const [nullables] = await knex.raw(
    `select TABLE_NAME t, COLUMN_NAME c, COLUMN_TYPE ty
       from information_schema.COLUMNS
      where TABLE_SCHEMA=? and TABLE_NAME in (${TABLES.map(() => '?').join(',')})
        and IS_NULLABLE='YES'`,
    [DB, ...TABLES],
  );
  for (const r of nullables) {
    if (SKIP.has(r.c)) continue;
    if (/date|time/.test(r.ty)) {
      await knex.raw(`alter table \`${DB}\`.\`${r.t}\` modify column \`${r.c}\` ${r.ty} NOT NULL`);
    }
  }
};
