/**
 * 创建审批流程相关表：休学/退学申请、退费申请、升学申请、审批日志、站内通知、催费流水
 * 负责人：学管模块（班级管理 8003）
 * 数据库：sms_class
 *
 * 流程（依据需求 + 用户确认）：
 *   休学：班主任申请 → 学管（教质/学术经理）审批 → 通知班主任；驳回也通知
 *   退学：班主任申请 → 学管初步审批 → 校长审批 → 通知班主任和学管；驳回也通知
 *   退费：走 RefundStatus 五级链（经理 → 教务核算 → 财务出款 → 校长）
 *   升学：初高部班主任发起 → 本模块（学管）接收并落库
 */

function base(t) {
  t.string('id', 36).primary().comment('主键UUID');
  t.datetime('create_time').notNullable().comment('创建时间');
  t.string('create_by', 36).comment('创建人ID');
  t.datetime('update_time').comment('最后修改时间');
  t.string('update_by', 36).comment('最后修改人ID');
  t.boolean('is_deleted').notNullable().defaultTo(false).comment('逻辑删除标记');
}

exports.up = async function up(knex) {
  // ---------- 休学 / 退学申请 ----------
  await knex.schema.createTable('t_class_suspend_apply', (t) => {
    base(t);
    t.string('apply_no', 40).notNullable().comment('申请单号');
    t.integer('apply_type').notNullable().comment('1休学（两级）2退学（三级）');
    t.string('student_id', 36).notNullable().comment('学生ID');
    t.string('student_no', 32).notNullable().comment('学号');
    t.string('student_name', 50).notNullable().comment('学生姓名');
    t.string('class_id', 36).comment('班级ID');
    t.string('class_name', 50).comment('班级名称');
    t.integer('dept_code').comment('部门');
    t.string('id_card', 32).comment('身份证号');
    t.string('parent_phone', 32).comment('家长联系电话');
    t.string('apply_reason', 500).notNullable().comment('申请原因');
    t.date('effect_date').comment('休学开始日期 / 退学申请日期');
    t.date('expect_resume_date').comment('预计复学日期（休学专用）');
    /** 金额单位：分 */
    t.bigInteger('occurred_amount').comment('已产生费用（分）');
    t.bigInteger('refundable_amount').comment('应退费用（分）');
    t.integer('apply_status').notNullable().defaultTo(1)
      .comment('状态 1待提交2待经理审批3待校长审批4已同意5已驳回');
    t.string('applicant_id', 36).comment('申请人（班主任）ID');
    t.string('applicant_name', 50).comment('申请人姓名');
    t.datetime('apply_time').notNullable().comment('申请时间');
    t.string('manager_approver_id', 36).comment('学管审批人ID');
    t.string('manager_approver_name', 50).comment('学管审批人姓名');
    t.datetime('manager_approve_time').comment('学管审批时间');
    t.string('manager_opinion', 500).comment('学管审批意见');
    t.string('principal_approver_id', 36).comment('校长审批人ID');
    t.string('principal_approver_name', 50).comment('校长审批人姓名');
    t.datetime('principal_approve_time').comment('校长审批时间');
    t.string('principal_opinion', 500).comment('校长审批意见');
    t.string('reject_reason', 500).comment('驳回原因（驳回时必填，回传班主任）');
    t.index('apply_no', 'idx_sa_no');
    t.index('student_id', 'idx_sa_student');
    t.index(['apply_type', 'apply_status'], 'idx_sa_type_status');
    t.comment('休学/退学申请表');
  });

  // ---------- 退费申请 ----------
  await knex.schema.createTable('t_class_refund_apply', (t) => {
    base(t);
    t.string('apply_no', 40).notNullable().comment('申请单号');
    t.string('student_id', 36).notNullable().comment('学生ID');
    t.string('student_no', 32).notNullable().comment('学号');
    t.string('student_name', 50).notNullable().comment('学生姓名');
    t.string('class_id', 36).comment('班级ID');
    t.string('class_name', 50).comment('班级名称');
    t.integer('dept_code').comment('部门');
    /** 金额单位：分 */
    t.bigInteger('refund_amount').notNullable().comment('退费总金额（分）');
    t.string('refund_reason', 500).notNullable().comment('退费原因');
    t.integer('refund_status').notNullable().defaultTo(1)
      .comment('退费状态 1待提交2待经理审批3待教务核算4待财务出款5待校长审批6已退费7已驳回');
    t.boolean('is_need_principal').notNullable().defaultTo(true).comment('是否需要校长审批（超阈值）');
    t.string('applicant_id', 36).comment('申请人（班主任）ID');
    t.string('applicant_name', 50).comment('申请人姓名');
    t.datetime('apply_time').notNullable().comment('申请时间');
    t.string('current_handler_role', 50).comment('当前处理人角色');
    t.string('reject_reason', 500).comment('最近一次驳回原因');
    t.index('apply_no', 'idx_ra_no');
    t.index('student_id', 'idx_ra_student');
    t.index('refund_status', 'idx_ra_status');
    t.comment('退费申请表');
  });

  await knex.schema.createTable('t_class_refund_item', (t) => {
    base(t);
    t.string('refund_id', 36).notNullable().comment('退费申请ID');
    t.integer('fee_type').notNullable().comment('退费项目 1学费2住宿费3餐费4保险费5试学费');
    /** 金额单位：分 */
    t.bigInteger('amount').notNullable().comment('该项退费金额（分）');
    t.index('refund_id', 'idx_ri_refund');
    t.comment('退费申请项表（可多选，试学费独立不并入学费）');
  });

  // ---------- 升学申请 ----------
  await knex.schema.createTable('t_class_upgrade_apply', (t) => {
    base(t);
    t.string('apply_no', 40).notNullable().comment('申请单号');
    t.string('student_id', 36).notNullable().comment('学生ID');
    t.string('student_no', 32).notNullable().comment('学号');
    t.string('student_name', 50).notNullable().comment('学生姓名');
    t.integer('from_dept_code').notNullable().comment('原部门');
    t.integer('from_stage').notNullable().comment('原学习阶段');
    t.string('from_class_id', 36).comment('原班级ID');
    t.string('from_class_name', 50).comment('原班级名称');
    t.integer('to_dept_code').notNullable().comment('目标部门');
    t.integer('to_stage').notNullable().comment('目标学习阶段');
    t.string('to_class_id', 36).comment('目标班级ID');
    t.string('to_class_name', 50).comment('目标班级名称');
    t.decimal('exam_score', 6, 2).comment('升学考试成绩');
    t.text('grade_snapshot').comment('升学时成绩明细快照（JSON，随档案一并保存）');
    t.integer('apply_status').notNullable().defaultTo(1).comment('状态 1待接收2已接收3已驳回');
    t.string('applicant_id', 36).comment('发起人（初高部班主任）ID');
    t.string('applicant_name', 50).comment('发起人姓名');
    t.datetime('apply_time').notNullable().comment('申请时间');
    t.datetime('receive_time').comment('接收时间');
    t.string('receiver_id', 36).comment('接收人ID');
    t.string('receiver_name', 50).comment('接收人姓名');
    t.string('reject_reason', 255).comment('驳回原因');
    t.index('apply_no', 'idx_ua_no');
    t.index('student_id', 'idx_ua_student');
    t.index('apply_status', 'idx_ua_status');
    t.comment('升学申请表（初高部班主任发起，本模块接收）');
  });

  // ---------- 审批日志 ----------
  await knex.schema.createTable('t_class_approval_log', (t) => {
    base(t);
    t.integer('apply_type').notNullable().comment('1休学2退学3退费4升学');
    t.string('apply_no', 40).notNullable().comment('业务单号');
    t.string('biz_id', 36).notNullable().comment('业务主键');
    t.string('action', 20).notNullable().comment('submit / approve / reject');
    t.integer('from_status').notNullable().comment('动作前状态');
    t.integer('to_status').notNullable().comment('动作后状态');
    t.string('operator_id', 36).comment('操作人ID');
    t.string('operator_name', 50).comment('操作人姓名');
    t.string('operator_role', 80).comment('操作人角色');
    t.string('opinion', 500).comment('审批意见');
    t.datetime('operate_time').notNullable().comment('操作时间');
    t.index(['apply_type', 'biz_id'], 'idx_al_biz');
    t.index('apply_no', 'idx_al_no');
    t.comment('审批日志表（所有审批动作都留痕）');
  });

  // ---------- 站内通知 ----------
  await knex.schema.createTable('t_class_notify', (t) => {
    base(t);
    t.integer('notify_type').notNullable().comment('1审批通过2审批驳回3待办提醒');
    t.integer('apply_type').comment('关联业务类型 1休学2退学3退费4升学');
    t.string('biz_id', 36).comment('关联业务主键');
    t.string('apply_no', 40).comment('关联业务单号');
    t.string('title', 200).notNullable().comment('标题');
    t.string('content', 1000).notNullable().comment('正文');
    t.string('receiver_id', 36).notNullable().comment('接收人ID');
    t.string('receiver_name', 50).comment('接收人姓名');
    t.boolean('is_read').notNullable().defaultTo(false).comment('是否已读');
    t.datetime('read_time').comment('已读时间');
    t.string('link_path', 200).comment('前端跳转路径');
    t.index(['receiver_id', 'is_read'], 'idx_nt_receiver_read');
    t.index('notify_type', 'idx_nt_type');
    t.comment('站内通知表（审批结果通知 + 未读角标）');
  });

  // ---------- 催费流水（本模块执行催收动作的记录）----------
  await knex.schema.createTable('t_class_urge_log', (t) => {
    base(t);
    t.string('student_id', 36).notNullable().comment('学生ID');
    t.string('student_no', 32).notNullable().comment('学号');
    t.string('student_name', 50).notNullable().comment('学生姓名');
    t.bigInteger('amount').comment('催收金额（分）');
    t.string('channel', 20).notNullable().defaultTo('phone').comment('催收渠道 phone/sms/wechat');
    t.string('remark', 500).comment('催收备注');
    t.string('operator_id', 36).comment('操作人ID');
    t.string('operator_name', 50).comment('操作人姓名');
    t.datetime('urge_time').notNullable().comment('催收时间');
    t.index('student_id', 'idx_ul_student');
    t.comment('催费流水表（催费记录本身同步自教务管理，这里只记本模块的催收动作）');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('t_class_urge_log');
  await knex.schema.dropTableIfExists('t_class_notify');
  await knex.schema.dropTableIfExists('t_class_approval_log');
  await knex.schema.dropTableIfExists('t_class_upgrade_apply');
  await knex.schema.dropTableIfExists('t_class_refund_item');
  await knex.schema.dropTableIfExists('t_class_refund_apply');
  await knex.schema.dropTableIfExists('t_class_suspend_apply');
};
