/**
 * 迁移脚本：创建学生休学/退学申请表 t_job_student_leave
 *
 * 归属模块：就业管理 > 实训阶段（马志斌）
 * 字段依据：`D:\产品经理\就业模块.xmind`「休学/退学审批」+ 斌哥 2026-09-30 确认
 *
 * ============================================================
 * 【为什么休学、退学共用一张表】
 * ============================================================
 *   xmind 里这两个的字段**完全一样**（学号/姓名/性别/…/原因/班主任意见），
 *   只是"类型"不同、审批链不同、通过后的动作不同。
 *
 *   所以：
 *     表 = 一张（用 biz_type 区分 1休学 / 2退学）
 *     审批链 = 配置在 shared-types/src/approval.ts（各是各的链）
 *     通过后动作 = 在路由里按 biz_type 分支
 *
 *   ⚠️ 好处：加"转学""停课"这类新类型，只是多一个枚举值，不用建新表。
 *
 * ============================================================
 * 【审批链】（斌哥 2026-09-29 拍板）
 * ============================================================
 *   休学：班主任发起 → 学管审批 → 通过（★ 不走校长）→ 财务冻结费用
 *   退学：班主任发起 → 学管审批 → 校长审批 → 通过 → 财务退费
 *
 * ============================================================
 * 【字段来源说明（★ 重要设计）】
 * ============================================================
 *   xmind 要求：学号/姓名/性别/身份证号/联系电话/通讯地址/班级/已上课时
 *
 *   其中【大部分是学生主档里的东西】，不该让班主任重填 ——
 *   建单时从 t_student_base「抄一份快照」存进来，防止学生转班后历史单子变样。
 *
 *   ⚠️ 例外：身份证号 / 通讯地址 —— 学生主档当前没有这两个字段，
 *      本表【先留位】，等学生主档补上后自动带；现在允许班主任手填。
 *
 *   ⚠️ 已上课时（attended_hours）—— 从 t_job_attendance 按 student_id
 *      数"实际出勤的天数"算出来，不是手填。
 *
 * ⚠️ 铁律：逻辑删除，禁物理删除。
 * ⚠️ 铁律：不许直接连数据库改表结构，一切变更走脚本！
 */

/**
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('t_job_student_leave', (table) => {
    // ---- 主键与公共字段 ----
    table.string('id', 36).primary().comment('主键UUID');
    table.datetime('create_time').notNullable().comment('创建时间');
    table.string('create_by', 36).comment('创建人ID');
    table.datetime('update_time').comment('修改时间');
    table.string('update_by', 36).comment('修改人ID');
    table.boolean('is_deleted').notNullable().defaultTo(false).comment('逻辑删除');

    // ---- 业务单号 ----
    table.string('leave_no', 32).notNullable().comment('单号，如 XX20260930001 / TX...');

    // ---- 类型：休学 or 退学 ----
    table.integer('biz_type').notNullable()
      .comment('业务类型 1休学 2退学（同一张表，用这个区分）');

    // ---- 学生信息（快照，防学生转班后历史单子变样）----
    table.string('student_id', 36).notNullable().comment('学生ID');
    table.string('student_no', 32).comment('学号（快照）');
    table.string('student_name', 50).comment('姓名（快照）');
    table.integer('gender').comment('性别 1男 2女（快照）');
    table.string('id_card', 32).comment('身份证号（★ 主档暂无此字段，先允许手填）');
    table.string('phone', 20).comment('联系电话（快照）');
    table.string('parent_phone', 20).comment('家长电话（快照）');
    table.string('address', 200).comment('通讯地址（★ 主档暂无此字段，先允许手填）');

    table.string('class_id', 36).comment('班级ID');
    table.string('class_name', 50).comment('班级名称（快照）');
    table.string('dept_name', 20).comment('部门名 初高部/大学部');
    table.integer('dept_code').comment('部门码 1初高部 2大学部');

    table.string('head_teacher_id', 36).comment('班主任ID');
    table.string('head_teacher_name', 50).comment('班主任姓名（快照）');

    // ---- 业务字段 ----
    table.integer('attended_hours').comment('已上课时（系统算：该生实际出勤天数）');
    table.date('leave_date').notNullable().comment('休学/退学日期');
    table.string('leave_reason', 500).notNullable().comment('休学/退学原因（班主任必填）');
    table.string('head_teacher_opinion', 500).comment('班主任意见');

    // ---- 审批关联 ----
    table.string('approval_id', 36).comment('关联审批单ID（t_job_approval.id）');
    table.integer('approval_status').notNullable().defaultTo(1)
      .comment('审批状态（冗余自审批单）1待提交 2待学管审批 3待校长审批 4已通过 5已驳回 6已撤销');

    // ---- 关联退费单（xmind：查看退费表 → 按学号查同学生的申请）----
    table.string('related_refund_no', 500)
      .comment('关联退费单号（多个逗号分隔，审批通过后由财务/系统回填）');

    // ---- 备注 ----
    table.string('remark', 500).comment('备注');

    // ---- 索引 ----
    table.unique(['leave_no'], { indexName: 'uk_leave_no' });
    table.index(['biz_type'], 'idx_leave_biz_type');
    table.index(['student_id'], 'idx_leave_student');
    table.index(['class_id'], 'idx_leave_class');
    table.index(['head_teacher_id'], 'idx_leave_head_teacher');
    table.index(['approval_status'], 'idx_leave_status');
    table.index(['approval_id'], 'idx_leave_approval');
    table.index(['leave_date'], 'idx_leave_date');
    table.index(['is_deleted'], 'idx_leave_is_deleted');

    table.comment('学生休学/退学申请表（就业管理-实训）');
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('t_job_student_leave');
};
