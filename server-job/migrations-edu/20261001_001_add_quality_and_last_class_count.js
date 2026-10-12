/**
 * 迁移脚本：学生表补充「综合素养」「末班次数」两个字段
 *
 * 来源：教务管理原型（学生档案页）
 *   - 初高中部需要展示「综合素养」「出勤率」
 *   - 大学部需要展示「综合素质」「末班次数」
 *
 * ⚠️ 铁律：不许直接连数据库改表结构，一切变更走脚本！
 */

/**
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  const hasQuality = await knex.schema.hasColumn('t_student_base', 'quality');
  const hasLastClassCount = await knex.schema.hasColumn('t_student_base', 'last_class_count');

  await knex.schema.alterTable('t_student_base', (table) => {
    if (!hasQuality) {
      table.string('quality', 500).comment('综合素养（长文本评价）');
    }
    if (!hasLastClassCount) {
      table.integer('last_class_count').defaultTo(0).comment('末班次数（大学部用）');
    }
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  await knex.schema.alterTable('t_student_base', (table) => {
    table.dropColumn('quality');
    table.dropColumn('last_class_count');
  });
};
