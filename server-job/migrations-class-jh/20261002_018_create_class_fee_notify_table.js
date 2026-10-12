/**
 * 迁移：催费记录 t_class_fee_notify
 *
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('t_class_fee_notify', (table) => {
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
    table.integer('fee_type').comment('缴费类型（快照）');
    table.integer('fee_amount').comment('金额（分，快照）');
    table.date('expire_date').comment('到期日期（快照）');
    table.integer('share_channel').notNullable().defaultTo(1).comment('触达渠道 1站内消息2微信3短信');
    table.string('notify_user_id', 36).comment('推送人ID');
    table.string('notify_user_name', 50).comment('推送人姓名');
    table.datetime('notify_time').notNullable().comment('推送时间');
    table.string('remark', 500).comment('备注');

    // ---- 索引 ----
    table.index(['student_id'], 'idx_student_id');
    table.index(['notify_time'], 'idx_notify_time');

    table.comment('催费记录表');
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('t_class_fee_notify');
};
