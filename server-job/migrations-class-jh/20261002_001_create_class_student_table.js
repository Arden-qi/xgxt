/**
 * 迁移：学生主档 t_class_student（教学管理初高）
 *
 * 说明：本表替代骨架示例表 t_student_base（旧表保留不动，互不影响）。
 *      公共字段：id/create_time/create_by/update_time/update_by/is_deleted。
 *
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('t_class_student', (table) => {
    // ---- 公共字段 ----
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
    table.date('birth_date').comment('出生日期');
    table.integer('age').comment('年龄（由出生日期重算）');
    table.string('native_place', 100).comment('籍贯');
    table.integer('dept_code').notNullable().defaultTo(1).comment('部门 1初高部 2大学部');
    table.string('class_id', 36).comment('班级ID');
    table.string('class_name', 50).comment('班级名称（冗余）');
    table.integer('stage').comment('学习阶段 101~107 / 201~204');
    table.string('head_teacher_id', 36).comment('班主任ID');
    table.string('head_teacher_name', 50).comment('班主任姓名');
    table.string('teacher_id', 36).comment('教员ID');
    table.string('teacher_name', 50).comment('教员姓名');
    table.string('assistant_id', 36).comment('助教ID');
    table.string('assistant_name', 50).comment('助教姓名');
    table.integer('student_status').notNullable().defaultTo(5)
      .comment('学生状态 1待咨询2咨询中3试学中4预在读5正式在读6休学7退学8实训中9待就业10已就业11流失');
    table.integer('pending_flow_type').comment('审批中流程类型 1休学2复学3升班转班4换人5退学6就业协议7末班');
    table.string('education', 50).comment('学历');
    table.string('graduate_school', 100).comment('毕业院校');
    table.date('enroll_date').comment('入学时间');
    table.string('phone', 20).comment('学生手机号');
    table.string('parent_phone', 20).comment('家长手机号');
    table.string('home_address', 255).comment('家庭住址');
    table.string('id_card_no', 32).comment('身份证号');
    table.integer('agreement_status').defaultTo(1).comment('就业协议 1未签订 2意向待签 3已签订');
    table.string('id_photo_url', 255).comment('证件照');
    table.string('household_photo_url', 255).comment('户口本照片');
    table.string('net_account', 64).comment('校园网账号');
    table.string('net_init_password', 64).comment('校园网初始密码');
    table.string('recruit_teacher_name', 50).comment('招生老师姓名');
    table.string('recruit_teacher_phone', 20).comment('招生老师电话');
    table.string('consult_teacher_name', 50).comment('咨询老师姓名');
    table.string('consult_teacher_phone', 20).comment('咨询老师电话');
    table.string('dorm_id', 36).comment('宿舍ID');
    table.string('dorm_no', 20).comment('宿舍号');
    table.string('bed_no', 20).comment('床位号');
    table.decimal('attendance_rate', 5, 2).comment('出勤率（回流）');
    table.integer('repeat_count').defaultTo(0).comment('末班累计次数');
    table.string('remark', 500).comment('备注');
    table.string('literacy_desc', 2000).comment('综合素养（自由文本）');

    // ---- 索引 ----
    table.unique(['student_no'], { indexName: 'uk_student_no' });
    table.index(['student_name'], 'idx_student_name');
    table.index(['dept_code', 'student_status'], 'idx_dept_status');
    table.index(['class_id'], 'idx_class_id');
    table.index(['stage'], 'idx_stage');
    table.index(['student_status'], 'idx_student_status');
    table.index(['dorm_id'], 'idx_dorm_id');

    table.comment('学生主档表（教学管理初高）');
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('t_class_student');
};
