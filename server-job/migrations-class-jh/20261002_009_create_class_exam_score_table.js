/**
 * 迁移：考试成绩 t_class_exam_score
 *
 * 说明：质素考核各评分老师各记一条，学生最终分取平均（展示计算，保留原始分）。
 *
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('t_class_exam_score', (table) => {
    // ---- 公共字段 ----
    table.string('id', 36).primary().comment('主键UUID');
    table.datetime('create_time').notNullable().comment('创建时间');
    table.string('create_by', 36).comment('创建人ID');
    table.datetime('update_time').comment('修改时间');
    table.string('update_by', 36).comment('修改人ID');
    table.boolean('is_deleted').notNullable().defaultTo(false).comment('逻辑删除');

    // ---- 业务字段 ----
    table.string('exam_id', 36).notNullable().comment('考试ID');
    table.integer('exam_type').comment('考试类型（冗余便于查询）');
    table.date('exam_date').comment('考试日期（冗余便于查询）');
    table.string('class_id', 36).comment('班级ID');
    table.string('student_id', 36).notNullable().comment('学生ID');
    table.string('student_no', 32).notNullable().comment('学号');
    table.string('student_name', 50).notNullable().comment('学生姓名');
    table.decimal('score_written', 6, 2).comment('笔试得分');
    table.decimal('score_machine', 6, 2).comment('机试得分');
    table.decimal('score_interview', 6, 2).comment('面试得分');
    table.decimal('score_other', 6, 2).comment('其他得分');
    table.decimal('score_total', 6, 2).comment('总分');
    table.string('score_teacher_id', 36).comment('评分老师ID（一位一条）');
    table.string('score_teacher_name', 50).comment('评分老师姓名');
    table.integer('exam_result').comment('考试结果 1通过 2未通过');
    table.boolean('is_passed').comment('结业考试是否通过（经理决定）');
    table.json('custom_values').comment('自定义字段值');
    table.string('remark', 500).comment('备注');

    // ---- 索引 ----
    table.index(['exam_id'], 'idx_exam_id');
    table.index(['student_id'], 'idx_student_id');
    table.index(['exam_date'], 'idx_exam_date');

    table.comment('考试成绩表');
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('t_class_exam_score');
};
