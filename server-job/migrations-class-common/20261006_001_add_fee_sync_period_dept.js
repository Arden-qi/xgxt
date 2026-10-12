/**
 * 迁移：t_class_fee_sync 增加「费用周期 / 部门」两列（★ 2026-10-06 缴费口径统一）
 *
 *   period     费用周期，财务侧原样带过来，如 2026-09
 *   dept_code  部门：1 初高部（财务页面显示为「二三期」）/ 2 大学部
 *
 * 用途：让「大学部 · 班级管理 · 缴费情况」与「初高 · 学生详情 · 缴费情况」
 *      「实训 · 学员档案 · 缴费记录」三处展示同一套字段（含费用周期与部门），
 *      避免同一笔钱在三个页面显示口径不一致。
 *
 * ⚠️ 只加列，不动原有同步机制（用户 2026-10-06 定：大学部保持现状）。
 * ⚠️ up()/down() 都先判存在再改，保证可重复执行、可回滚。
 */

/**
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  const hasPeriod = await knex.schema.hasColumn('t_class_fee_sync', 'period');
  const hasDept = await knex.schema.hasColumn('t_class_fee_sync', 'dept_code');

  if (!hasPeriod || !hasDept) {
    await knex.schema.alterTable('t_class_fee_sync', (t) => {
      if (!hasPeriod) {
        t.string('period', 32).comment('费用周期（源：财务，如 2026-09）');
      }
      if (!hasDept) {
        t.integer('dept_code').comment('部门 1初高部(二三期) 2大学部');
      }
    });
  }
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  if (await knex.schema.hasColumn('t_class_fee_sync', 'dept_code')) {
    await knex.schema.alterTable('t_class_fee_sync', (t) => {
      t.dropColumn('dept_code');
    });
  }
  if (await knex.schema.hasColumn('t_class_fee_sync', 'period')) {
    await knex.schema.alterTable('t_class_fee_sync', (t) => {
      t.dropColumn('period');
    });
  }
};
