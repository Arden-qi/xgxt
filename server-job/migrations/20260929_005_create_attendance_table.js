/**
 * 迁移脚本：创建出勤记录表 t_job_attendance
 *
 * 归属模块：就业管理 > 实训阶段（马志斌）
 * 字段依据：docs/班级信息+出勤-字段定稿.md 第三节
 * 执行：npm run migrate
 *
 * 设计要点：
 *   一个学生一天只能有一条记录（uk_date_student 唯一约束）。
 *   出勤率口径 A：应到 = 全部在班学生（含请假的）。
 *
 * ⚠️ 铁律：不许直接连数据库改表结构，一切变更走脚本！
 */

/**
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('t_job_attendance', (table) => {
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
    table.string('student_id', 36).notNullable().comment('学生ID');
    table.string('student_no', 32).comment('学号（快照）');
    table.string('student_name', 50).comment('姓名（快照）');

    table.date('attend_date').notNullable().comment('出勤日期');
    table.integer('attend_status').notNullable()
      .comment('出勤状态 1出勤 2缺勤 3迟到 4早退 5请假 6事假 7病假');
    table.integer('attend_type').comment('请假类型 1事假 2病假（状态为6/7时有意义）');
    table.string('reason', 200).comment('原因，缺勤/请假时必填');
    table.string('remark', 200).comment('备注');

    table.string('registrar_id', 36).comment('登记人ID');
    table.string('registrar_name', 50).comment('登记人姓名');

    // ---- 索引 ----
    // 一天一个学生只能有一条
    table.unique(['attend_date', 'student_id'], { indexName: 'uk_date_student' });
    table.index(['class_id', 'attend_date'], 'idx_att_class_date');
    table.index(['student_id'], 'idx_att_student_id');
    table.index(['attend_status'], 'idx_att_status');
    table.index(['is_deleted'], 'idx_att_is_deleted');

    table.comment('出勤记录表（就业管理-实训）');
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('t_job_attendance');
};
