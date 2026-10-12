/**
 * 迁移：出勤台账（按班按日）t_class_attendance
 *
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('t_class_attendance', (table) => {
    // ---- 公共字段 ----
    table.string('id', 36).primary().comment('主键UUID');
    table.datetime('create_time').notNullable().comment('创建时间');
    table.string('create_by', 36).comment('创建人ID');
    table.datetime('update_time').comment('修改时间');
    table.string('update_by', 36).comment('修改人ID');
    table.boolean('is_deleted').notNullable().defaultTo(false).comment('逻辑删除');

    // ---- 业务字段 ----
    table.string('class_id', 36).notNullable().comment('班级ID');
    table.string('class_name', 50).notNullable().comment('班级名称');
    table.date('attendance_date').notNullable().comment('考勤日期');
    table.decimal('attendance_rate', 5, 2).comment('当日出勤率');
    table.integer('should_count').defaultTo(0).comment('应到人数');
    table.integer('actual_count').defaultTo(0).comment('已到人数');
    table.integer('month_unqualified_count').defaultTo(0).comment('当月未达标数');
    table.string('teacher_id', 36).comment('教员ID');
    table.string('teacher_name', 50).comment('教员姓名');
    table.string('head_teacher_id', 36).comment('班主任ID');
    table.string('head_teacher_name', 50).comment('班主任姓名');
    table.string('file_url', 255).comment('出勤表文件地址');
    table.string('remark', 500).comment('备注');

    // ---- 索引 ----
    table.unique(['class_id', 'attendance_date'], { indexName: 'uk_class_date' });
    table.index(['attendance_date'], 'idx_attendance_date');

    table.comment('出勤台账表（按班按日）');
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('t_class_attendance');
};
