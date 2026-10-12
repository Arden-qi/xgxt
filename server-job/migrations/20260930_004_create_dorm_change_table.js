/**
 * 迁移脚本：创建宿舍调换/退宿申请单 t_job_dorm_change
 *
 * 归属模块：就业管理 > 实训阶段（马志斌）
 * 字段依据：斌哥 2026-09-30 拍板「调换宿舍 + 退宿，都走审批（教务老师审批）」
 *
 * ============================================================
 * 【为什么调换、退宿共用一张表】
 * ============================================================
 *   和休学/退学一个道理：这两个的字段**完全一样**
 *   （学生 / 原宿舍 / 新宿舍 / 原因 / 申请人 / 审批），
 *   只是"类型"不同、通过后的动作不同。
 *
 *   所以：
 *     表 = 一张（biz_type 区分 1调换宿舍 / 2退宿）
 *     审批链 = 配置在 shared-types/src/approval.ts（dormChange 一条链）
 *     通过后动作 = 路由里按 biz_type 分支
 *
 * ============================================================
 * 【审批链】（斌哥 2026-09-30 拍板）
 * ============================================================
 *   班主任发起 → 教务老师审批 → 通过
 *   （1 步审批，教务老师 = ROLE_EDU_ADMIN）
 *
 * ============================================================
 * 【通过后的动作】
 * ============================================================
 *   调换宿舍：
 *     ① 旧床位释放（bed_status=1，清 student_*）
 *     ② 新床位占用（bed_status=2，写 student_*）
 *     ③ 学生主档 dorm_id / dorm_no 改成新宿舍
 *   退宿：
 *     ① 当前床位释放
 *     ② 学生主档 dorm_id / dorm_no 置空
 *   ⚠️ 两步都在同一个事务里，要么都成，要么都不动。
 *
 * ⚠️ 铁律：逻辑删除，禁物理删除。
 */

/**
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('t_job_dorm_change', (table) => {
    // ---- 主键与公共字段 ----
    table.string('id', 36).primary().comment('主键UUID');
    table.datetime('create_time').notNullable().comment('创建时间');
    table.string('create_by', 36).comment('创建人ID');
    table.datetime('update_time').comment('修改时间');
    table.string('update_by', 36).comment('修改人ID');
    table.boolean('is_deleted').notNullable().defaultTo(false).comment('逻辑删除');

    // ---- 业务单号 ----
    table.string('change_no', 32).notNullable()
      .comment('单号，如 DH20260930001（调换）/ TS20260930001（退宿）');

    // ---- 类型：调换 or 退宿 ----
    table.integer('biz_type').notNullable()
      .comment('业务类型 1调换宿舍 2退宿（同一张表，用这个区分）');

    // ---- 学生信息（快照）----
    table.string('student_id', 36).notNullable().comment('学生ID');
    table.string('student_no', 32).comment('学号（快照）');
    table.string('student_name', 50).comment('姓名（快照）');
    table.integer('gender').comment('性别 1男 2女（快照）');
    table.string('phone', 20).comment('联系电话（快照）');

    table.string('class_id', 36).comment('班级ID');
    table.string('class_name', 50).comment('班级名称（快照）');
    table.integer('dept_code').comment('部门码 1初高部 2大学部');
    table.string('head_teacher_id', 36).comment('班主任ID');
    table.string('head_teacher_name', 50).comment('班主任姓名（快照）');

    // ---- 原宿舍（调换、退宿都要记）----
    table.string('old_dorm_id', 36).comment('原宿舍ID');
    table.string('old_dorm_no', 20).comment('原宿舍编号（快照）');
    table.string('old_bed_id', 36).comment('原床位ID');
    table.integer('old_bed_no').comment('原床位号');

    // ---- 新宿舍（仅调换宿舍时有值）----
    table.string('new_dorm_id', 36).comment('新宿舍ID（退宿为空）');
    table.string('new_dorm_no', 20).comment('新宿舍编号（退宿为空）');
    table.string('new_bed_id', 36).comment('新床位ID（退宿为空）');
    table.integer('new_bed_no').comment('新床位号（退宿为空）');

    // ---- 业务字段 ----
    table.date('change_date').notNullable().comment('调换/退宿日期');
    table.string('change_reason', 500).notNullable().comment('原因（班主任必填）');
    table.string('head_teacher_opinion', 500).comment('班主任意见');

    // ---- 审批关联 ----
    table.string('approval_id', 36).comment('关联审批单ID（t_job_approval.id）');
    table.integer('approval_status').notNullable().defaultTo(1)
      .comment('审批状态（冗余自审批单）1待提交 2待教务审批 4已通过 5已驳回 6已撤销');

    table.string('remark', 500).comment('备注');

    // ---- 索引 ----
    table.unique(['change_no'], { indexName: 'uk_change_no' });
    table.index(['biz_type'], 'idx_change_biz_type');
    table.index(['student_id'], 'idx_change_student');
    table.index(['class_id'], 'idx_change_class');
    table.index(['head_teacher_id'], 'idx_change_head_teacher');
    table.index(['approval_status'], 'idx_change_status');
    table.index(['approval_id'], 'idx_change_approval');
    table.index(['change_date'], 'idx_change_date');
    table.index(['is_deleted'], 'idx_change_is_deleted');

    table.comment('宿舍调换/退宿申请单（就业管理-实训）');
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('t_job_dorm_change');
};
