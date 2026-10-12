/**
 * 迁移脚本：创建班级每日出勤汇总表 t_job_attendance_summary
 *
 * 归属模块：就业管理 > 实训阶段（马志斌）
 * 字段依据：docs/班级信息+出勤-字段定稿.md 第四节
 * 执行：npm run migrate
 *
 * 为什么要这张表？
 *   班级列表要显示「今日班级整体出勤率」，每次都去 t_job_attendance 里
 *   GROUP BY 算一遍太慢。登记完当天考勤时顺手算好存这张表。
 *
 * ⚠️ 铁律：不许直接连数据库改表结构，一切变更走脚本！
 */

/**
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('t_job_attendance_summary', (table) => {
    // ---- 主键与公共字段 ----
    table.string('id', 36).primary().comment('主键UUID');
    table.datetime('create_time').notNullable().comment('创建时间');
    table.string('create_by', 36).comment('创建人ID');
    table.datetime('update_time').comment('修改时间');
    table.string('update_by', 36).comment('修改人ID');
    table.boolean('is_deleted').notNullable().defaultTo(false).comment('逻辑删除');

    // ---- 业务字段 ----
    table.string('class_id', 36).notNullable().comment('班级ID');
    table.string('class_name', 50).comment('班级名称（快照）');
    table.date('attend_date').notNullable().comment('日期');

    table.integer('should_count').notNullable().defaultTo(0)
      .comment('应到人数（全部在班学生，含请假的 —— 口径A）');
    table.integer('actual_count').notNullable().defaultTo(0)
      .comment('实到人数（出勤+迟到+早退）');
    table.integer('absent_count').notNullable().defaultTo(0)
      .comment('未到人数（缺勤+请假+事假+病假）');
    table.decimal('attendance_rate', 5, 2).notNullable().defaultTo(0)
      .comment('当日出勤率（%）= 实到 ÷ 应到 × 100');

    table.string('head_teacher_name', 50).comment('班主任姓名（快照）');
    table.string('teacher_name', 50).comment('教员姓名（快照）');

    // ---- 索引 ----
    table.unique(['class_id', 'attend_date'], { indexName: 'uk_sum_class_date' });
    table.index(['attend_date'], 'idx_sum_attend_date');
    table.index(['is_deleted'], 'idx_sum_is_deleted');

    table.comment('班级每日出勤汇总表（就业管理-实训）');
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('t_job_attendance_summary');
};
