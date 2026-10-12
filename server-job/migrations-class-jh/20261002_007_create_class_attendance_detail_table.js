/**
 * 迁移：出勤明细 t_class_attendance_detail
 *
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('t_class_attendance_detail', (table) => {
    // ---- 公共字段 ----
    table.string('id', 36).primary().comment('主键UUID');
    table.datetime('create_time').notNullable().comment('创建时间');
    table.string('create_by', 36).comment('创建人ID');
    table.datetime('update_time').comment('修改时间');
    table.string('update_by', 36).comment('修改人ID');
    table.boolean('is_deleted').notNullable().defaultTo(false).comment('逻辑删除');

    // ---- 业务字段 ----
    table.string('attendance_id', 36).notNullable().comment('关联出勤台账ID');
    table.string('class_id', 36).notNullable().comment('班级ID');
    table.date('attendance_date').notNullable().comment('考勤日期');
    table.string('student_id', 36).notNullable().comment('学生ID');
    table.string('student_no', 32).notNullable().comment('学号');
    table.string('student_name', 50).notNullable().comment('学生姓名');
    table.string('phone', 20).comment('手机号');
    table.string('parent_phone', 20).comment('家长手机号');
    table.integer('attendance_status').notNullable().comment('出勤状态 1出勤2迟到3病假4事假5缺勤');
    table.string('absent_reason', 255).comment('缺勤/异常原因');

    // ---- 索引 ----
    table.index(['attendance_id'], 'idx_attendance_id');
    table.index(['student_id'], 'idx_student_id');

    table.comment('出勤明细表');
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('t_class_attendance_detail');
};
