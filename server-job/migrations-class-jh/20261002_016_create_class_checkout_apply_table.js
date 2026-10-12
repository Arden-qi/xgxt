/**
 * 迁移：退宿申请 t_class_checkout_apply
 *
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('t_class_checkout_apply', (table) => {
    // ---- 公共字段 ----
    table.string('id', 36).primary().comment('主键UUID');
    table.datetime('create_time').notNullable().comment('创建时间');
    table.string('create_by', 36).comment('创建人ID');
    table.datetime('update_time').comment('修改时间');
    table.string('update_by', 36).comment('修改人ID');
    table.boolean('is_deleted').notNullable().defaultTo(false).comment('逻辑删除');

    // ---- 业务字段 ----
    table.string('student_id', 36).notNullable().comment('学生ID');
    table.string('student_no', 32).notNullable().comment('学号');
    table.string('student_name', 50).notNullable().comment('学生姓名');
    table.string('class_id', 36).comment('班级ID');
    table.string('class_name', 50).comment('班级名称');
    table.string('room_id', 36).notNullable().comment('房间ID');
    table.string('room_no', 50).notNullable().comment('房间号');
    table.string('bed_id', 36).notNullable().comment('床位ID');
    table.string('bed_no', 20).notNullable().comment('床位号');
    table.string('checkout_reason', 500).comment('退宿原因');
    table.string('apply_user_id', 36).comment('发起人ID');
    table.string('apply_user_name', 50).comment('发起人姓名');
    table.datetime('apply_time').comment('申请时间');
    table.integer('apply_status').notNullable().defaultTo(1).comment('申请状态 1待审核 2已同意 3已驳回');
    table.string('approve_user_id', 36).comment('审批人ID');
    table.string('approve_user_name', 50).comment('审批人姓名');
    table.datetime('approve_time').comment('审批时间');
    table.string('reject_reason', 500).comment('驳回原因');

    // ---- 索引 ----
    table.index(['student_id'], 'idx_student_id');
    table.index(['apply_status'], 'idx_apply_status');

    table.comment('退宿申请表');
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('t_class_checkout_apply');
};
