/**
 * 迁移脚本：创建退费申请表 t_job_refund
 *
 * 归属模块：就业管理 > 实训阶段（马志斌）
 * 字段依据：`D:\产品经理\就业模块.xmind`「退费」+ 斌哥 2026-09-29 确认
 *
 * ============================================================
 * 【审批链】（斌哥 2026-09-29 拍板，覆盖旧口径）
 * ============================================================
 *   班主任发起 → 学管审批 → 校长审批 → 财务直接退费
 *
 *   ⚠️ 每笔都走校长，不设金额阈值。
 *   ⚠️ 页面是 班主任/学管/校长 三人共用；
 *      班主任只能发申请，看不到审批按钮（靠权限管理控制，后端也拦）。
 *
 * 【「学管」是哪个角色？】
 *   斌哥拍板方案 A：学管 = 教质经理 / 学术经理 的**另一种叫法**，
 *   不新增角色。系统里就用 ROLE_QUALITY_MGR / ROLE_ACADEMIC_MGR。
 *
 * ⚠️ 铁律：金额一律用「分」存整数，防浮点误差！
 * ⚠️ 铁律：不许直接连数据库改表结构，一切变更走脚本！
 */

/**
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('t_job_refund', (table) => {
    // ---- 主键与公共字段 ----
    table.string('id', 36).primary().comment('主键UUID');
    table.datetime('create_time').notNullable().comment('创建时间');
    table.string('create_by', 36).comment('创建人ID');
    table.datetime('update_time').comment('修改时间');
    table.string('update_by', 36).comment('修改人ID');
    table.boolean('is_deleted').notNullable().defaultTo(false).comment('逻辑删除');

    // ---- 业务单号 ----
    table.string('refund_no', 32).notNullable().comment('退费单号，如 TK20260929001');

    // ---- 学生信息（快照，防学生转班后历史单子变样）----
    table.string('student_id', 36).notNullable().comment('学生ID');
    table.string('student_no', 32).comment('学号（快照）');
    table.string('student_name', 50).comment('学生姓名（快照）');
    table.string('class_id', 36).comment('班级ID');
    table.string('class_name', 50).comment('班级名称（快照）');
    table.string('dept_name', 20).comment('部门名 初高部/大学部');
    table.integer('dept_code').comment('部门码 1初高部 2大学部');

    // ---- 班主任（xmind 要求有这列）----
    table.string('head_teacher_id', 36).comment('班主任ID');
    table.string('head_teacher_name', 50).comment('班主任姓名（快照）');

    // ---- 退费业务字段 ----
    table.integer('refund_type').notNullable()
      .comment('退费类型 1学费 2住宿费 3餐费 4保险费 5试学费 9其他');
    table.string('refund_type_name', 20).comment('退费类型名称（双返回用）');
    table.bigint('refund_amount').notNullable().defaultTo(0)
      .comment('退费金额（单位：分！班主任填写）');
    table.date('apply_date').notNullable().comment('申请日期');
    table.string('refund_reason', 500).notNullable().comment('退费原因（班主任必填）');

    // ---- 审批关联 ----
    table.string('approval_id', 36).comment('关联审批单ID（t_job_approval.id）');
    table.integer('approval_status').notNullable().defaultTo(1)
      .comment('审批状态（冗余自审批单，方便列表直查）1待提交 2待学管审批 3待校长审批 4已通过 5已驳回 6已撤销');

    // ---- 财务出款（财务办的活，我们只记录结果）----
    table.string('finance_remark', 500).comment('财务出款备注');
    table.datetime('refund_time').comment('实际退费时间');

    // ---- 备注 ----
    table.string('remark', 500).comment('备注');

    // ---- 索引 ----
    table.unique(['refund_no'], { indexName: 'uk_refund_no' });
    table.index(['student_id'], 'idx_refund_student');
    table.index(['class_id'], 'idx_refund_class');
    table.index(['head_teacher_id'], 'idx_refund_head_teacher');
    table.index(['approval_status'], 'idx_refund_status');
    table.index(['approval_id'], 'idx_refund_approval');
    table.index(['apply_date'], 'idx_refund_apply_date');
    table.index(['is_deleted'], 'idx_refund_is_deleted');

    table.comment('退费申请表（就业管理-实训）');
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('t_job_refund');
};
