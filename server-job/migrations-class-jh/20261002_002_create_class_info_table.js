/**
 * 迁移：班级主档 t_class_info
 *
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('t_class_info', (table) => {
    // ---- 公共字段 ----
    table.string('id', 36).primary().comment('主键UUID');
    table.datetime('create_time').notNullable().comment('创建时间');
    table.string('create_by', 36).comment('创建人ID');
    table.datetime('update_time').comment('修改时间');
    table.string('update_by', 36).comment('修改人ID');
    table.boolean('is_deleted').notNullable().defaultTo(false).comment('逻辑删除');

    // ---- 业务字段 ----
    table.string('class_name', 50).notNullable().comment('班级名称 G104/J106');
    table.integer('stage').notNullable().comment('学习阶段 101~107 / 201~204');
    table.string('head_teacher_id', 36).notNullable().comment('班主任ID');
    table.string('head_teacher_name', 50).notNullable().comment('班主任姓名');
    table.string('teacher_id', 36).notNullable().comment('教员ID');
    table.string('teacher_name', 50).notNullable().comment('教员姓名');
    table.string('assistant_id', 36).comment('助教ID');
    table.string('assistant_name', 50).comment('助教姓名');
    table.string('classroom', 100).comment('教室');
    table.date('open_date').comment('开班日期');
    table.integer('dept_code').notNullable().defaultTo(1).comment('部门 1初高部 2大学部');
    table.integer('class_status').notNullable().defaultTo(1).comment('班级状态 1开放 2封班 3待结业 4已结业');
    table.integer('student_count').defaultTo(0).comment('班级人数（动态回写）');
    table.decimal('today_attendance_rate', 5, 2).comment('今日出勤率（回流）');
    table.string('remark', 500).comment('备注');

    // ---- 索引 ----
    table.unique(['class_name'], { indexName: 'uk_class_name' });
    table.index(['stage'], 'idx_stage');
    table.index(['head_teacher_id'], 'idx_head_teacher');
    table.index(['teacher_id'], 'idx_teacher');
    table.index(['class_status'], 'idx_class_status');

    table.comment('班级主档表');
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('t_class_info');
};
