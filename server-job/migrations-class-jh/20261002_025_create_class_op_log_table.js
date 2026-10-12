/**
 * 迁移：操作日志 t_class_op_log
 *
 * 敏感操作（休学/退学/末班/交接/调宿/退费/班级状态变更）统一写本表。
 *
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('t_class_op_log', (table) => {
    // ---- 公共字段 ----
    table.string('id', 36).primary().comment('主键UUID');
    table.datetime('create_time').notNullable().comment('创建时间');
    table.string('create_by', 36).comment('创建人ID');
    table.datetime('update_time').comment('修改时间');
    table.string('update_by', 36).comment('修改人ID');
    table.boolean('is_deleted').notNullable().defaultTo(false).comment('逻辑删除');

    // ---- 业务字段 ----
    table.string('module', 50).comment('子模块');
    table.string('biz_type', 50).notNullable().comment('业务类型 休学/退学/末班/交接/调宿/退费');
    table.string('biz_id', 36).comment('业务主键');
    table.string('student_id', 36).comment('关联学生ID');
    table.string('class_id', 36).comment('关联班级ID');
    table.string('op_user_id', 36).comment('操作人ID');
    table.string('op_user_name', 50).comment('操作人姓名');
    table.datetime('op_time').notNullable().comment('操作时间');
    table.string('op_desc', 500).comment('操作描述');
    table.json('before_value').comment('操作前值');
    table.json('after_value').comment('操作后值');

    // ---- 索引 ----
    table.index(['biz_type'], 'idx_biz_type');
    table.index(['student_id'], 'idx_student_id');
    table.index(['op_time'], 'idx_op_time');

    table.comment('操作日志表');
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('t_class_op_log');
};
