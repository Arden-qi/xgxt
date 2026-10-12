/**
 * 迁移：考试 t_class_exam
 *
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('t_class_exam', (table) => {
    // ---- 公共字段 ----
    table.string('id', 36).primary().comment('主键UUID');
    table.datetime('create_time').notNullable().comment('创建时间');
    table.string('create_by', 36).comment('创建人ID');
    table.datetime('update_time').comment('修改时间');
    table.string('update_by', 36).comment('修改人ID');
    table.boolean('is_deleted').notNullable().defaultTo(false).comment('逻辑删除');

    // ---- 业务字段 ----
    table.string('exam_name', 100).notNullable().comment('考试名称');
    table.integer('exam_type').notNullable().comment('考试类型 1月考2质素考核3阶段考核4结业考试5其他');
    table.date('exam_date').notNullable().comment('考试日期');
    table.string('class_id', 36).notNullable().comment('考试班级ID');
    table.string('class_name', 50).notNullable().comment('考试班级名称');
    table.json('exam_content_types').notNullable().comment('内容项数组 [1,2,3,4]');
    table.json('content_full_score').comment('各内容项默认满分');
    table.integer('exam_status').notNullable().defaultTo(1).comment('考试状态 1草稿 2已提交');
    table.json('score_teacher_ids').comment('评分老师（质素考核）');
    table.json('judge_ids').comment('评委（阶段考核）');
    table.string('create_by_name', 50).comment('创建人姓名（按账号）');
    table.string('remark', 500).comment('备注');

    // ---- 索引 ----
    table.index(['exam_type'], 'idx_exam_type');
    table.index(['exam_date'], 'idx_exam_date');
    table.index(['class_id'], 'idx_class_id');
    table.index(['exam_status'], 'idx_exam_status');

    table.comment('考试表');
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('t_class_exam');
};
