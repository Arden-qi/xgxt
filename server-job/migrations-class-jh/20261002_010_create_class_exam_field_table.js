/**
 * 迁移：考试自定义字段 t_class_exam_field
 *
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('t_class_exam_field', (table) => {
    // ---- 公共字段 ----
    table.string('id', 36).primary().comment('主键UUID');
    table.datetime('create_time').notNullable().comment('创建时间');
    table.string('create_by', 36).comment('创建人ID');
    table.datetime('update_time').comment('修改时间');
    table.string('update_by', 36).comment('修改人ID');
    table.boolean('is_deleted').notNullable().defaultTo(false).comment('逻辑删除');

    // ---- 业务字段 ----
    table.string('exam_id', 36).notNullable().comment('考试ID');
    table.string('field_name', 50).notNullable().comment('字段名');
    table.integer('field_type').notNullable().defaultTo(1).comment('字段类型 1纯文字 2数字');
    table.integer('sort_no').defaultTo(0).comment('排序');

    // ---- 索引 ----
    table.index(['exam_id'], 'idx_exam_id');

    table.comment('考试自定义字段表');
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('t_class_exam_field');
};
