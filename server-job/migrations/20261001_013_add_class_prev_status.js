/**
 * 迁移脚本：t_job_class 增加「结业前状态」字段
 *
 * 归属模块：就业管理 > 实训阶段（马志斌）
 * 背景：斌哥 2026-10-01 拍板「给校长留一个撤销结业的口子」
 *
 * ============================================================
 * 【为什么要这个字段】
 * ============================================================
 *   「撤销结业」要把班级恢复到**结业之前**的状态。
 *   但结业前可能是「开放(1)」也可能是「封班(2)」——
 *   如果撤销时一律写死 1，就会把「封班」的班变成「开放」，数据被悄悄改坏。
 *
 *   所以结业时先把原状态记在 prev_class_status，撤销时照着回填。
 *
 * ============================================================
 * 【为什么只有一个字段，不建「结业批次表」】
 * ============================================================
 *   一个班只会结业一次，撤销之后才会再次结业，不存在"多批次并存"。
 *   撤销时按「class_id + 离班方式=结业」就能精准捞回本批学生，够用。
 *
 * ⚠️ 铁律：不许直接连数据库改表结构，一切变更走脚本！
 * ⚠️ 幂等：列已存在就直接跳过（重复执行不报错）
 */

/**
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  const has = await knex.schema.hasColumn('t_job_class', 'prev_class_status');
  if (has) {
    console.log('[013] t_job_class.prev_class_status 已存在，跳过');
    return;
  }

  await knex.schema.alterTable('t_job_class', (table) => {
    table
      .integer('prev_class_status')
      .comment('结业前的班级状态（撤销结业时回滚用）1开放 2封班 3待结业');
  });

  console.log('[013] 已为 t_job_class 增加 prev_class_status');
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  const has = await knex.schema.hasColumn('t_job_class', 'prev_class_status');
  if (!has) return;

  await knex.schema.alterTable('t_job_class', (table) => {
    table.dropColumn('prev_class_status');
  });
};
