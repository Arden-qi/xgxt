/**
 * 迁移脚本：创建成绩表 t_job_exam_score
 *
 * 归属模块：就业管理 > 实训阶段（马志斌）
 * 字段依据：docs/考试成绩-字段定稿.md 第六节
 * 执行：npm run migrate
 *
 * ⚠️ 铁律：不许直接连数据库改表结构，一切变更走脚本！
 */

/**
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('t_job_exam_score', (table) => {
    // ---- 主键与公共字段（每张表都要有）----
    table.string('id', 36).primary().comment('主键UUID');
    table.datetime('create_time').notNullable().comment('创建时间');
    table.string('create_by', 36).comment('创建人ID');
    table.datetime('update_time').comment('修改时间');
    table.string('update_by', 36).comment('修改人ID');
    table.boolean('is_deleted').notNullable().defaultTo(false).comment('逻辑删除 false未删 true已删');

    // ---- 关联字段（建考试时自动写入）----
    table.string('exam_id', 36).notNullable().comment('考试ID，关联 t_job_exam.id');
    table.string('exam_name', 100).notNullable().comment('考试名称（冗余，便于查询显示）');

    // ---- 学生字段（建考试时自动带出）----
    table.string('student_id', 36).notNullable().comment('学生ID，关联 t_student_base.id');
    table.string('student_no', 32).notNullable().comment('学号（冗余，便于显示）');
    table.string('student_name', 50).notNullable().comment('姓名（冗余，便于显示）');

    // ---- 班级快照（考试当时所在班，不被后来转班影响）----
    table.string('class_id', 36).comment('班级ID（快照）');
    table.string('class_name', 50).comment('班级名称（快照）');

    // ---- 分数：三项录入 + 两项自动算 ----
    table.decimal('paper_score', 5, 2).comment('卷面成绩 0-100（老师填）');
    table.decimal('machine_score', 5, 2).comment('机试成绩 0-100（老师填）');
    table.decimal('written_avg', 5, 2)
      .comment('笔试部分均分 = 卷面×50%+机试×50%（系统算，缺一项则为空）');
    table.decimal('interview_score', 5, 2).comment('面试成绩 0-100（老师填）');
    table.decimal('total_score', 5, 2)
      .comment('综合成绩 = 笔试均分×50%+面试×50%（系统算，三项都有才算）');

    // ---- 结果与留痕 ----
    table.integer('exam_result')
      .comment('考试结果 1通过 2未通过(末班)；NULL=未判断');
    table.string('remark', 500).comment('备注');
    table.string('entry_by', 36).comment('录入人ID');
    table.string('entry_by_name', 50).comment('录入人姓名');
    table.datetime('entry_time').comment('录入时间');

    // ---- 索引 ----
    // ⚠️ 唯一约束：同一场考试，一个学生只能有一条记录
    table.unique(['exam_id', 'student_id'], { indexName: 'uk_exam_student' });
    table.index(['exam_id'], 'idx_score_exam_id');
    table.index(['student_id'], 'idx_score_student_id');
    table.index(['class_id'], 'idx_score_class_id');
    table.index(['exam_result'], 'idx_score_exam_result');

    table.comment('考试成绩表（就业管理-实训）');
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('t_job_exam_score');
};
