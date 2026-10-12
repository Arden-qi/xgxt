/**
 * 迁移：学习阶段字典 t_class_stage（P2）
 *
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('t_class_stage', (table) => {
    // ---- 公共字段 ----
    table.string('id', 36).primary().comment('主键UUID');
    table.datetime('create_time').notNullable().comment('创建时间');
    table.string('create_by', 36).comment('创建人ID');
    table.datetime('update_time').comment('修改时间');
    table.string('update_by', 36).comment('修改人ID');
    table.boolean('is_deleted').notNullable().defaultTo(false).comment('逻辑删除');

    // ---- 业务字段 ----
    table.integer('stage_code').notNullable().comment('阶段编码 101~107 / 201~204');
    table.string('stage_name', 50).notNullable().comment('阶段名称');
    table.integer('dept_code').notNullable().comment('部门 1初高部 2大学部');
    table.integer('study_months').comment('学制月数');
    table.integer('sort_no').defaultTo(0).comment('排序');

    // ---- 索引 ----
    table.unique(['stage_code', 'dept_code'], { indexName: 'uk_stage_dept' });

    table.comment('学习阶段字典表');
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('t_class_stage');
};
