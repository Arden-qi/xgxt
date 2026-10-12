/**
 * 迁移脚本示例：创建学生表
 *
 * ⚠️ 使用方式：
 *    1. 复制这个文件到 migrations/ 目录
 *    2. 改文件名：YYYYMMDD_序号_动作描述.js（例：20260928_001_create_student_table.js）
 *    3. 改表名和字段
 *    4. 执行：npm run migrate
 *
 * ⚠️ 铁律：不许直接连数据库改表结构，一切变更走脚本！
 */

/**
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('t_student_base', (table) => {
    // ---- 主键与基础字段（每张表都要有）----
    table.string('id', 36).primary().comment('主键UUID');
    table.datetime('create_time').notNullable().comment('创建时间');
    table.string('create_by', 36).comment('创建人ID');
    table.datetime('update_time').comment('修改时间');
    table.string('update_by', 36).comment('修改人ID');
    table.boolean('is_deleted').notNullable().defaultTo(false).comment('逻辑删除');

    // ---- 业务字段 ----
    table.string('student_no', 32).notNullable().comment('学号 S20260001');
    table.string('student_name', 50).notNullable().comment('姓名');
    table.integer('gender').notNullable().comment('性别 1男 2女');
    table.integer('age').comment('年龄');
    table.integer('dept_code').notNullable().comment('部门 1初高部 2大学部');
    table.string('class_id', 36).comment('班级ID');
    table.string('class_name', 50).comment('班级名称');
    table.string('head_teacher_id', 36).comment('班主任ID');
    table.string('head_teacher_name', 50).comment('班主任姓名');
    table.string('teacher_id', 36).comment('教员ID');
    table.string('teacher_name', 50).comment('教员姓名');
    table.string('assistant_id', 36).comment('助教ID');
    table.string('assistant_name', 50).comment('助教姓名');
    table.integer('student_status').notNullable().defaultTo(1)
      .comment('学生状态 1待咨询2咨询中3试学中4预在读5正式在读6休学7退学8实训中9待就业10已就业11流失');
    table.integer('stage').comment('学习阶段');
    table.string('phone', 20).comment('学生手机号');
    table.string('parent_phone', 20).comment('家长手机号');
    table.string('dorm_id', 36).comment('宿舍ID');
    table.string('dorm_no', 20).comment('宿舍号');
    table.string('education', 50).comment('学历');
    table.date('enroll_date').comment('入学时间');
    table.decimal('attendance_rate', 5, 2).comment('出勤率');
    table.integer('repeat_count').defaultTo(0).comment('末班次数');
    table.string('remark', 500).comment('备注');

    // ---- 索引 ----
    table.unique(['student_no'], { indexName: 'uk_student_no' });
    table.index(['class_id'], 'idx_class_id');
    table.index(['student_status'], 'idx_student_status');
    table.index(['dept_code', 'student_status'], 'idx_dept_status');

    table.comment('学生基础信息表');
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('t_student_base');
};
