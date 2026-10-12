/**
 * 迁移：t_class_fee 增加「来源」两列（★ 2026-10-06 缴费与财务同步）
 *
 *   source_system  来源系统：'local'（默认，本模块种子/本地台账） / 'finance'（财务管理推送）
 *   source_id      来源侧业务主键：财务缴费单 id（t_finance_fee.id）
 *   period         费用周期（财务侧 period 原样带过来，如 2026-09）
 *
 * 用途：初高「学生详情 · 缴费情况」以财务管理为准（实时查 + 副本兜底），
 *      副本落回本表；用 (source_system, source_id) 做幂等键，
 *      财务单新增/核对/打回时重复推送不会造出重复行。
 *
 * ⚠️ up()/down() 都先判存在再改，保证可重复执行、可回滚。
 */

/** 判断索引是否存在 */
async function hasIndex(knex, table, indexName) {
  const res = await knex.raw(
    `SELECT COUNT(*) AS c FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?`,
    [table, indexName],
  );
  const rows = Array.isArray(res) ? res[0] : res;
  return Number(rows?.[0]?.c || 0) > 0;
}

/**
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  const hasSys = await knex.schema.hasColumn('t_class_fee', 'source_system');
  const hasId = await knex.schema.hasColumn('t_class_fee', 'source_id');
  const hasPeriod = await knex.schema.hasColumn('t_class_fee', 'period');

  if (!hasSys || !hasId || !hasPeriod) {
    await knex.schema.alterTable('t_class_fee', (t) => {
      if (!hasSys) {
        t.string('source_system', 20).defaultTo('local').comment('来源系统 local/finance');
      }
      if (!hasId) {
        t.string('source_id', 64).comment('来源侧业务主键（财务缴费单ID）');
      }
      if (!hasPeriod) {
        t.string('period', 32).comment('费用周期（源：财务，如 2026-09）');
      }
    });
  }

  // 幂等键：同一张财务单只留一行（唯一索引允许 NULL，seed 的老数据 source_id 为 NULL 不受影响）
  if (!(await hasIndex(knex, 't_class_fee', 'uk_fee_source'))) {
    await knex.schema.alterTable('t_class_fee', (t) => {
      t.unique(['source_system', 'source_id'], { indexName: 'uk_fee_source' });
    });
  }

  if (!(await hasIndex(knex, 't_class_fee', 'idx_fee_student_no'))) {
    await knex.schema.alterTable('t_class_fee', (t) => {
      t.index('student_no', 'idx_fee_student_no');
    });
  }
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  if (await hasIndex(knex, 't_class_fee', 'idx_fee_student_no')) {
    await knex.schema.alterTable('t_class_fee', (t) => {
      t.dropIndex('student_no', 'idx_fee_student_no');
    });
  }
  if (await hasIndex(knex, 't_class_fee', 'uk_fee_source')) {
    await knex.schema.alterTable('t_class_fee', (t) => {
      t.dropUnique(['source_system', 'source_id'], 'uk_fee_source');
    });
  }
  if (await knex.schema.hasColumn('t_class_fee', 'period')) {
    await knex.schema.alterTable('t_class_fee', (t) => {
      t.dropColumn('period');
    });
  }
  if (await knex.schema.hasColumn('t_class_fee', 'source_id')) {
    await knex.schema.alterTable('t_class_fee', (t) => {
      t.dropColumn('source_id');
    });
  }
  if (await knex.schema.hasColumn('t_class_fee', 'source_system')) {
    await knex.schema.alterTable('t_class_fee', (t) => {
      t.dropColumn('source_system');
    });
  }
};
