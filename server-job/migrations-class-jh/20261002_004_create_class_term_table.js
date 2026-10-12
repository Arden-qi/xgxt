/**
 * 迁移：学期 t_class_term（P1）
 *
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('t_class_term', (table) => {
    // ---- 公共字段 ----
    table.string('id', 36).primary().comment('主键UUID');
    table.datetime('create_time').notNullable().comment('创建时间');
    table.string('create_by', 36).comment('创建人ID');
    table.datetime('update_time').comment('修改时间');
    table.string('update_by', 36).comment('修改人ID');
    table.boolean('is_deleted').notNullable().defaultTo(false).comment('逻辑删除');

    // ---- 业务字段 ----
    table.string('class_id', 36).notNullable().comment('班级ID');
    table.string('class_name', 50).comment('班级名称');
    table.string('term_name', 50).notNullable().comment('学期名称');
    table.date('start_date').comment('学期开始日期');
    table.date('end_date').comment('学期结束日期');
    table.string('remark', 500).comment('备注');

    // ---- 索引 ----
    table.index(['class_id'], 'idx_class_id');

    table.comment('学期表');
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('t_class_term');
};
