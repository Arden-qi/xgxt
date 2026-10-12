/**
 * 迁移脚本：创建通知表 t_job_notice
 *
 * 归属模块：就业管理 > 实训阶段（马志斌）
 * 创建原因：末班要「给该班主任发送通知」（2026-09-29 斌哥要求）
 *
 * 【设计说明】
 *   本表是【站内信】—— 通知落在系统里，收件人登录后能看到未读红点。
 *   不依赖任何外部服务（短信/微信都没接）。
 *
 * 【为什么表名不叫 t_job_repeat_notice】
 *   因为「信息通知」将来也是一块独立功能（实训第 4 块）。
 *   通知表设计成通用的 —— 末班只是其中一种 notice_type。
 *   将来信息通知模块直接复用这张表，不重复建。
 *
 * ⚠️ 铁律：不许直接连数据库改表结构，一切变更走脚本！
 */

/**
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('t_job_notice', (table) => {
    // ---- 主键与公共字段 ----
    table.string('id', 36).primary().comment('主键UUID');
    table.datetime('create_time').notNullable().comment('创建时间');
    table.string('create_by', 36).comment('创建人ID');
    table.boolean('is_deleted').notNullable().defaultTo(false).comment('逻辑删除');

    // ---- 通知类型与内容 ----
    table.integer('notice_type').notNullable()
      .comment('通知类型 1末班通知 2班级交接 3考勤异常 4系统通知 5审批通知 9其他');
    table.string('title', 100).notNullable().comment('通知标题');
    table.string('content', 500).comment('通知正文');

    // ---- 收件人 ----
    table.string('receiver_id', 36).notNullable().comment('收件人ID（用户/老师ID）');
    table.string('receiver_name', 50).comment('收件人姓名（快照）');
    table.string('receiver_role', 50).comment('收件人角色码，如 ROLE_HEAD_TEACHER');

    // ---- 发件人 ----
    table.string('sender_id', 36).comment('发件人ID');
    table.string('sender_name', 50).comment('发件人姓名（快照）');

    // ---- 关联业务 ----
    table.string('biz_type', 32).comment('关联业务类型，如 classTransfer / repeat');
    table.string('biz_id', 36).comment('关联业务ID（如末班成绩记录ID / 交接记录ID）');
    table.string('class_id', 36).comment('相关班级ID');
    table.string('class_name', 50).comment('相关班级名称（快照）');
    table.string('student_id', 36).comment('相关学生ID');
    table.string('student_name', 50).comment('相关学生姓名（快照）');

    // ---- 状态 ----
    table.boolean('is_read').notNullable().defaultTo(false).comment('是否已读');
    table.datetime('read_time').comment('阅读时间');

    // ---- 索引 ----
    table.index(['receiver_id', 'is_read'], 'idx_notice_receiver_read');
    table.index(['notice_type'], 'idx_notice_type');
    table.index(['biz_type', 'biz_id'], 'idx_notice_biz');
    table.index(['create_time'], 'idx_notice_create_time');
    table.index(['is_deleted'], 'idx_notice_is_deleted');

    table.comment('通知表（站内信，就业管理-实训）');
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('t_job_notice');
};
