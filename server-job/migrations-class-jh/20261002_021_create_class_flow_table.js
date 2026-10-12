/**
 * 迁移：统一流程申请 t_class_flow
 *
 * 说明：flow_type 1休学/2复学/3升班转班/4换人/5退学/6就业协议/7末班。
 *      flow_status 复用 SuspendStatus 1~4（休/复/退）；转班/换人用 1/2/3。
 *
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('t_class_flow', (table) => {
    // ---- 公共字段 ----
    table.string('id', 36).primary().comment('主键UUID');
    table.datetime('create_time').notNullable().comment('创建时间');
    table.string('create_by', 36).comment('创建人ID');
    table.datetime('update_time').comment('修改时间');
    table.string('update_by', 36).comment('修改人ID');
    table.boolean('is_deleted').notNullable().defaultTo(false).comment('逻辑删除');

    // ---- 业务字段 ----
    table.integer('flow_type').notNullable().comment('流程类型 1休学2复学3升班转班4换人5退学6就业协议7末班');
    table.string('student_id', 36).comment('学生ID');
    table.string('student_no', 32).comment('学号');
    table.string('student_name', 50).comment('学生姓名');
    table.string('class_id', 36).comment('班级ID');
    table.string('class_name', 50).comment('班级名称');
    table.string('apply_user_id', 36).comment('发起人ID');
    table.string('apply_user_name', 50).comment('发起人姓名');
    table.datetime('apply_time').comment('申请时间');
    table.string('apply_reason', 500).comment('申请原因');
    table.integer('flow_status').notNullable().defaultTo(1).comment('流程状态 1待提交2待经理审批3已同意4已驳回');
    table.string('current_node_name', 50).comment('当前节点名称');
    table.string('approve_user_id', 36).comment('处理人ID');
    table.string('approve_user_name', 50).comment('处理人姓名');
    table.datetime('approve_time').comment('处理时间');
    table.string('reject_reason', 500).comment('驳回原因');
    table.integer('suspend_status').comment('休/退状态（同 flow_status，冗余便于按字典查询）');
    table.date('suspend_start_date').comment('计划休学开始日');
    table.date('expect_resume_date').comment('预计复学时间');
    table.string('suspend_reason', 500).comment('休/退原因');
    table.string('id_card_no', 32).comment('身份证号（审批表展示）');
    table.string('phone', 20).comment('电话（审批表展示）');
    table.integer('attended_hours').comment('已上课时（审批表展示）');
    table.string('resume_class_id', 36).comment('复学班级ID');
    table.date('resume_date').comment('复学日期');
    table.boolean('is_meal_dorm_restored').defaultTo(false).comment('是否恢复餐宿费');
    table.string('from_class_id', 36).comment('转班原班级ID');
    table.string('to_class_id', 36).comment('转班新班级ID');
    table.integer('from_stage').comment('原学习阶段');
    table.integer('to_stage').comment('新学习阶段');
    table.string('transfer_reason', 500).comment('转班调整原因');
    table.integer('handover_role').comment('交接岗位 1班主任 2教员');
    table.string('from_user_id', 36).comment('原任ID');
    table.string('to_user_id', 36).comment('接管人ID');
    table.string('handover_reason', 500).comment('交接原因');
    table.string('handover_content', 1000).comment('交接内容');
    table.datetime('handover_time').comment('交接时间');
    table.string('arrange_user_id', 36).comment('安排人ID');
    table.integer('agreement_status').comment('就业协议状态 1未签订2意向待签3已签订');
    table.date('sign_date').comment('签订日期');
    table.string('agreement_file_url', 255).comment('协议文件地址');

    // ---- 索引 ----
    table.index(['flow_type'], 'idx_flow_type');
    table.index(['student_id'], 'idx_student_id');
    table.index(['apply_user_id'], 'idx_apply_user');
    table.index(['apply_time'], 'idx_apply_time');
    table.index(['flow_status'], 'idx_flow_status');

    table.comment('统一流程申请表');
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('t_class_flow');
};
