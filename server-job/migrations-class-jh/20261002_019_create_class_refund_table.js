/**
 * 迁移：退费申请 t_class_refund
 *
 * 说明：退费审批链 refund_status 1待提交→2待经理→3待教务→(5待校长 超阈值)→4待财务→6已退费；7已驳回。
 *
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('t_class_refund', (table) => {
    // ---- 公共字段 ----
    table.string('id', 36).primary().comment('主键UUID');
    table.datetime('create_time').notNullable().comment('创建时间');
    table.string('create_by', 36).comment('创建人ID');
    table.datetime('update_time').comment('修改时间');
    table.string('update_by', 36).comment('修改人ID');
    table.boolean('is_deleted').notNullable().defaultTo(false).comment('逻辑删除');

    // ---- 业务字段 ----
    table.string('student_id', 36).notNullable().comment('学生ID（须 7 退学）');
    table.string('student_no', 32).notNullable().comment('学号');
    table.string('student_name', 50).notNullable().comment('学生姓名');
    table.string('class_id', 36).comment('班级ID');
    table.string('class_name', 50).comment('班级名称');
    table.integer('dept_code').defaultTo(1).comment('部门 1初高部 2大学部');
    table.integer('fee_type').notNullable().comment('退费类型 1~4');
    table.integer('refund_amount').notNullable().comment('退费金额（分）');
    table.string('refund_reason', 500).notNullable().comment('退费原因');
    table.string('head_teacher_opinion', 500).comment('班主任意见');
    table.date('apply_date').notNullable().comment('申请日期');
    table.boolean('is_fee_used_up').defaultTo(false).comment('费用是否用完');
    table.integer('refund_status').notNullable().defaultTo(1).comment('退费状态 1~7 审批链');
    table.string('current_handler_name', 50).comment('当前处理人（推导）');
    table.string('apply_user_id', 36).comment('发起人ID');
    table.string('apply_user_name', 50).comment('发起人姓名');
    table.string('approve_user_id', 36).comment('当前节点处理人ID');
    table.string('approve_user_name', 50).comment('当前节点处理人姓名');
    table.datetime('approve_time').comment('当前节点处理时间');
    table.string('reject_reason', 500).comment('驳回原因');
    table.integer('threshold_amount').comment('申请时阈值快照（分）');
    table.datetime('pay_out_time').comment('财务出款时间');
    table.string('pay_out_voucher_no', 64).comment('出款凭证号');

    // ---- 索引 ----
    table.index(['student_id'], 'idx_student_id');
    table.index(['refund_amount'], 'idx_refund_amount');
    table.index(['apply_date'], 'idx_apply_date');
    table.index(['refund_status'], 'idx_refund_status');

    table.comment('退费申请表');
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('t_class_refund');
};
