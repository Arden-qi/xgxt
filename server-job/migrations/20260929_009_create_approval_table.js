/**
 * 迁移脚本：创建审批单主表 t_job_approval
 *
 * 归属模块：就业管理 > 实训阶段（马志斌）
 * 创建原因：退费 / 休学 / 退学 三个业务都要走审批，抽成一张通用表（2026-09-29 斌哥拍板）
 *
 * ============================================================
 * 【设计思路：为什么要做成"通用审批"】
 * ============================================================
 *   退费、休学、退学，三件事的"审批"部分长得一模一样：
 *     有人发起 → 一审 → 二审(可能) → 通过/驳回
 *   区别只是：
 *     - 走的节点不同（休学不用校长，退学要校长）
 *     - 通过后干的事不同（退费是给财务派活，休学是改学生状态）
 *
 *   所以把"审批"抽成一张通用表 ——
 *   将来业务规则变了（斌哥说"休学退学暂定后续可能改"），
 *   只要**改配置**，不用**改代码**。
 *
 * 【怎么用】
 *   1. 业务表（如 t_job_refund）存自己的业务字段，并记一个 approval_id
 *   2. 本表存"流程状态"：现在轮到谁审、走到第几步
 *   3. 轨迹表（t_job_approval_log）存每一步谁批的、什么意见
 *
 * 【要不要把业务字段也塞进这张表？】
 *   ❌ 不塞。业务字段千差万别（退费有金额、休学有已上课时），
 *      硬塞进来会变成一堆"这个字段只有那个业务用"的空列。
 *   本表只管**流程**，业务字段各回各家。
 *   两边用 biz_type + biz_id 关联。
 *
 * ⚠️ 铁律：不许直接连数据库改表结构，一切变更走脚本！
 */

/**
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('t_job_approval', (table) => {
    // ---- 主键与公共字段 ----
    table.string('id', 36).primary().comment('主键UUID');
    table.datetime('create_time').notNullable().comment('创建时间');
    table.string('create_by', 36).comment('创建人ID');
    table.datetime('update_time').comment('修改时间');
    table.string('update_by', 36).comment('修改人ID');
    table.boolean('is_deleted').notNullable().defaultTo(false).comment('逻辑删除');

    // ---- 业务归属 ----
    table.string('biz_type', 32).notNullable()
      .comment('业务类型 refund退费 suspend休学 quit退学');
    table.string('biz_id', 36).notNullable()
      .comment('业务记录ID（指向 t_job_refund / t_job_suspend 等）');
    table.string('biz_no', 32).comment('业务单号（展示用，如 TK20260929001）');

    // ---- 流程状态 ----
    table.integer('status').notNullable().defaultTo(1)
      .comment('审批状态 1待提交 2待学管审批 3待校长审批 4已通过 5已驳回 6已撤销');
    table.integer('current_step').notNullable().defaultTo(0)
      .comment('当前审批环节序号，0=未提交，1=第一审，2=第二审…');

    // ---- 当前处理人（"现在轮到谁"—— 催办、待办列表靠它）----
    table.string('current_handler_role', 50)
      .comment('当前应处理人角色码，如 ROLE_QUALITY_MGR / ROLE_PRINCIPAL');
    table.string('current_handler_hint', 100)
      .comment('当前处理人提示文字，如「待学管审批」（前端直接显示）');

    // ---- 申请人 ----
    table.string('applicant_id', 36).comment('申请人ID');
    table.string('applicant_name', 50).comment('申请人姓名（快照）');
    table.string('applicant_role', 50).comment('申请人角色码');

    // ---- 业务冗余字段（为了列表查询不用反复连表）----
    table.string('student_id', 36).comment('学生ID');
    table.string('student_no', 32).comment('学号（快照）');
    table.string('student_name', 50).comment('学生姓名（快照）');
    table.string('class_id', 36).comment('班级ID');
    table.string('class_name', 50).comment('班级名（快照）');
    table.integer('dept_code').comment('部门 1初高部 2大学部（用于数据范围过滤）');

    // ---- 完结信息 ----
    table.datetime('submit_time').comment('提交时间');
    table.datetime('finish_time').comment('审批结束时间（通过或驳回）');
    table.string('reject_reason', 500).comment('驳回原因（驳回时必填，会通知申请人）');

    // ---- 索引 ----
    table.index(['biz_type', 'biz_id'], 'idx_approval_biz');
    table.index(['status'], 'idx_approval_status');
    table.index(['current_handler_role', 'status'], 'idx_approval_handler');
    table.index(['applicant_id'], 'idx_approval_applicant');
    table.index(['student_id'], 'idx_approval_student');
    table.index(['class_id'], 'idx_approval_class');
    table.index(['create_time'], 'idx_approval_create_time');
    table.index(['is_deleted'], 'idx_approval_is_deleted');

    table.comment('审批单主表（退费/休学/退学通用，就业管理-实训）');
  });

  // ============================================================
  // 审批轨迹表：每一步谁批的、什么意见
  // ============================================================
  await knex.schema.createTable('t_job_approval_log', (table) => {
    table.string('id', 36).primary().comment('主键UUID');
    table.datetime('create_time').notNullable().comment('创建时间');
    table.boolean('is_deleted').notNullable().defaultTo(false).comment('逻辑删除');

    table.string('approval_id', 36).notNullable().comment('关联审批单ID');
    table.string('biz_type', 32).comment('业务类型（冗余，方便查）');
    table.string('biz_id', 36).comment('业务ID（冗余）');

    table.integer('step').notNullable().comment('环节序号 1第一审 2第二审…');
    table.string('node_name', 50).comment('环节名称，如「学管审批」「校长审批」');

    table.string('operator_id', 36).comment('操作人ID');
    table.string('operator_name', 50).comment('操作人姓名（快照）');
    table.string('operator_role', 50).comment('操作人角色码');

    table.integer('action').notNullable()
      .comment('动作 1提交 2同意 3驳回 4撤回');
    table.string('action_name', 20).comment('动作名称（双返回用）');
    table.string('comment', 500).comment('审批意见');

    table.index(['approval_id'], 'idx_apprlog_approval');
    table.index(['biz_type', 'biz_id'], 'idx_apprlog_biz');
    table.index(['create_time'], 'idx_apprlog_create_time');

    table.comment('审批轨迹表（每一步留痕，就业管理-实训）');
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('t_job_approval_log');
  await knex.schema.dropTableIfExists('t_job_approval');
};
