/**
 * 迁移脚本：删掉退费单的「退费单号」字段
 *
 * 斌哥 2026-09-30：退费单号一并删除（口径与催费单号 / 休学退学单号 / 宿舍单号一致）。
 *
 * ⚠️ 不可逆：列和唯一索引一起删掉，历史单号数据会丢失。
 *    down() 只能把列**结构**加回来（值补不回来）。
 *
 * ⚠️ 铁律：不许直接连数据库改表结构，一切变更走脚本！
 */

/**
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('t_job_refund', (t) => {
    t.dropUnique(['refund_no'], 'uk_refund_no');
  });
  await knex.schema.alterTable('t_job_refund', (t) => {
    t.dropColumn('refund_no');
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  await knex.schema.alterTable('t_job_refund', (t) => {
    t.string('refund_no', 32).nullable().comment('退费单号（2026-09-30 已废弃）');
  });
};
