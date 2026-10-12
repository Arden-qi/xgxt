/**
 * 迁移：t_class_student 增加「来源」两列（★ 2026-10-05 分班/升学）
 *
 *   source_system  来源系统：'manual'（默认，手工录入） / 'consult'（咨询分班直建） / 'upgrade'（升学转入）
 *   source_id      来源侧业务主键：咨询单号(consult_no) / 升学来源学生ID
 *
 * 用途：咨询「分班」直接落到初高对应班级时，按 (source_system, source_id) 幂等去重，
 *      避免同一张咨询单重复点击分班造出两个学生。
 *
 * ⚠️ up()/down() 都先判存在再改，保证可重复执行；down() 可回滚，不破坏 migrate:rollback --all。
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
  const hasSys = await knex.schema.hasColumn('t_class_student', 'source_system');
  const hasId = await knex.schema.hasColumn('t_class_student', 'source_id');

  if (!hasSys || !hasId) {
    await knex.schema.alterTable('t_class_student', (t) => {
      if (!hasSys) {
        t.string('source_system', 32).defaultTo('manual').comment('来源系统 manual/consult/upgrade');
      }
      if (!hasId) {
        t.string('source_id', 64).comment('来源侧业务主键（咨询单号 / 来源学生ID）');
      }
    });
  }

  if (!(await hasIndex(knex, 't_class_student', 'idx_source'))) {
    await knex.schema.alterTable('t_class_student', (t) => {
      t.index(['source_system', 'source_id'], 'idx_source');
    });
  }
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  if (await hasIndex(knex, 't_class_student', 'idx_source')) {
    await knex.schema.alterTable('t_class_student', (t) => {
      t.dropIndex(['source_system', 'source_id'], 'idx_source');
    });
  }
  if (await knex.schema.hasColumn('t_class_student', 'source_id')) {
    await knex.schema.alterTable('t_class_student', (t) => {
      t.dropColumn('source_id');
    });
  }
  if (await knex.schema.hasColumn('t_class_student', 'source_system')) {
    await knex.schema.alterTable('t_class_student', (t) => {
      t.dropColumn('source_system');
    });
  }
};
