/**
 * 迁移脚本：创建催费管理表 t_job_fee_call
 *
 * 归属模块：就业管理 > 实训阶段（马志斌）
 * 字段依据：斌哥 2026-09-30 拍板
 *   「类别只有 住宿费/保险费/餐费（没有学费）；教务老师发起，推给班主任"
 *
 * ============================================================
 * 【这个模块干什么】
 * ============================================================
 *   教务老师发现某学生某项费用到期没交 → 在系统里发起一条"催缴" →
 *   推给该学生的班主任 → 班主任去催 → 催完标记结果。
 *
 *   ⚠️ 注意：这个模块**不收款、不记账**，只是"催办工单"。
 *      真正的收费/账目在财务模块（8005），本模块只负责"提醒班主任去催"。
 *
 * ============================================================
 * 【为什么催缴不涉及学费】
 * ============================================================
 *   斌哥拍板：学费由教务单独一条线管（跟报名/入学绑定），
 *   这里只管【住宿费 / 保险费 / 餐费】这三类"日常性费用"。
 *
 * ============================================================
 * 【谁发起 / 谁看】
 * ============================================================
 *   发起：教务老师（ROLE_EDU_ADMIN）
 *   接收：班主任（推站内信）
 *   数据范围：班主任**只看自己的班**
 *
 * ⚠️ 铁律：逻辑删除，禁物理删除。
 * ⚠️ 铁律：金额一律存「分」（整数），防浮点误差。
 */

/**
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('t_job_fee_call', (table) => {
    // ---- 主键与公共字段 ----
    table.string('id', 36).primary().comment('主键UUID');
    table.datetime('create_time').notNullable().comment('创建时间');
    table.string('create_by', 36).comment('创建人ID');
    table.datetime('update_time').comment('修改时间');
    table.string('update_by', 36).comment('修改人ID');
    table.boolean('is_deleted').notNullable().defaultTo(false).comment('逻辑删除');

    // ---- 业务单号 ----
    table.string('call_no', 32).notNullable().comment('催费单号，如 CF20260930001');

    // ---- 费用类别（2住宿费 4保险费 3餐费，无学费）----
    table.integer('fee_type').notNullable()
      .comment('费用类别 2住宿费 4保险费 3餐费（★ 没有学费；编码与 RefundType 对齐）');

    // ---- 学生信息（快照）----
    table.string('student_id', 36).notNullable().comment('学生ID');
    table.string('student_no', 32).comment('学号（快照）');
    table.string('student_name', 50).comment('姓名（快照）');
    table.string('phone', 20).comment('联系电话（快照）');
    table.string('parent_phone', 20).comment('家长电话（快照，催费主要打这个）');

    // ---- 班级 / 班主任（决定推给谁）----
    table.string('class_id', 36).comment('班级ID');
    table.string('class_name', 50).comment('班级名称（快照）');
    table.integer('dept_code').comment('部门码 1初高部 2大学部');
    table.string('head_teacher_id', 36).comment('班主任ID（就是推给他的）');
    table.string('head_teacher_name', 50).comment('班主任姓名（快照）');

    // ---- 催费内容 ----
    table.bigInteger('fee_amount').comment('应缴金额（单位「分」，可空）');
    table.date('due_date').notNullable().comment('到期时间（费用应缴截止日）');
    table.string('call_reason', 500).comment('催缴说明');
    table.string('remark', 500).comment('备注');

    // ---- 处理状态 ----
    table.integer('call_status').notNullable().defaultTo(1)
      .comment('催缴状态 1待催缴 2催缴中 3已缴清（复用 FeeCallStatus 枚举）');
    table.datetime('handle_time').comment('班主任处理时间');
    table.string('handle_remark', 500).comment('班主任处理说明');

    // ---- 发起人 ----
    table.string('applicant_id', 36).comment('发起人ID（教务老师）');
    table.string('applicant_name', 50).comment('发起人姓名（快照）');

    // ---- 索引 ----
    table.unique(['call_no'], { indexName: 'uk_call_no' });
    table.index(['fee_type'], 'idx_call_fee_type');
    table.index(['student_id'], 'idx_call_student');
    table.index(['class_id'], 'idx_call_class');
    table.index(['head_teacher_id'], 'idx_call_head_teacher');
    table.index(['call_status'], 'idx_call_status');
    table.index(['due_date'], 'idx_call_due_date');
    table.index(['is_deleted'], 'idx_call_is_deleted');

    table.comment('催费管理表（就业管理-实训）');
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('t_job_fee_call');
};
