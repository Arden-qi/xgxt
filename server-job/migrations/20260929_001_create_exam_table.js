/**
 * 迁移脚本：创建考试表 t_job_exam
 *
 * 归属模块：就业管理 > 实训阶段（马志斌）
 * 字段依据：docs/考试成绩-字段定稿.md 第五节
 * 执行：npm run migrate
 *
 * ⚠️ 铁律：不许直接连数据库改表结构，一切变更走脚本！
 */

/**
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('t_job_exam', (table) => {
    // ---- 主键与公共字段（每张表都要有）----
    table.string('id', 36).primary().comment('主键UUID');
    table.datetime('create_time').notNullable().comment('创建时间');
    table.string('create_by', 36).comment('创建人ID');
    table.datetime('update_time').comment('修改时间');
    table.string('update_by', 36).comment('修改人ID');
    table.boolean('is_deleted').notNullable().defaultTo(false).comment('逻辑删除 false未删 true已删');

    // ---- 业务字段 ----
    table.string('exam_name', 100).notNullable().comment('考试名称，如「一期月考」');
    table.integer('exam_type').notNullable()
      .comment('考试类型 1月考 2质素考核 3阶段考核 4结业考试 5其他');
    table.datetime('exam_time').notNullable().comment('考试时间');
    table.string('class_ids', 500).notNullable()
      .comment('考试班级ID，英文逗号拼接，如 C001,C002（可跨班）');
    table.string('class_names', 500).notNullable()
      .comment('考试班级名快照，与 class_ids 顺序一一对应，如 一班,二班');
    table.string('content_types', 100).notNullable()
      .comment('考试内容，英文逗号拼接。本期固定 1,2,3（笔试+机试+面试）');
    table.string('creator_id', 36).comment('创建人ID（当前登录账号）');
    table.string('creator_name', 50).comment('创建人姓名');
    table.string('remark', 500).comment('备注');

    // ---- 索引 ----
    table.index(['exam_time'], 'idx_exam_time');
    table.index(['exam_type'], 'idx_exam_type');
    table.index(['is_deleted'], 'idx_exam_is_deleted');

    table.comment('考试表（就业管理-实训）');
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('t_job_exam');
};
