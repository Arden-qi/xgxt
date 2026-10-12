/**
 * 创建学生表（学管侧学生档案）
 * 负责人：学管模块（班级管理 8003）
 * 数据库：sms_class
 *
 * 字段来源（依据需求一）：
 *  - 同步自市场咨询：student_no / student_name / gender / dept_code / phone / parent_phone
 *                    + 市场信息（招生老师、咨询老师）
 *  - 班主任补充：班级、班主任/教员/助教、学历、入学时间、身份证号、
 *                档案类字段（出生日期/籍贯/毕业院校/家庭住址/照片）、综合素质
 *  - 班主任新建：整条记录由班主任创建（source_system = manual）
 */

function base(t) {
  t.string('id', 36).primary().comment('主键UUID');
  t.datetime('create_time').notNullable().comment('创建时间');
  t.string('create_by', 36).comment('创建人ID');
  t.datetime('update_time').comment('最后修改时间');
  t.string('update_by', 36).comment('最后修改人ID');
  t.boolean('is_deleted').notNullable().defaultTo(false).comment('逻辑删除标记');
}

exports.up = async function up(knex) {
  await knex.schema.createTable('t_class_student', (t) => {
    base(t);

    // ---- 同步元信息（幂等键：source_system + source_id）----
    t.string('source_system', 20).notNullable().defaultTo('manual')
      .comment('数据来源 consult市场咨询 / manual班主任新建');
    t.string('source_id', 64).comment('上游主键，用于幂等更新');
    t.datetime('source_update_time').comment('上游数据最后变更时间');
    t.integer('sync_status').notNullable().defaultTo(2).comment('同步状态 1待同步2已同步3同步失败');

    // ---- 学籍基础信息 ----
    t.string('student_no', 32).notNullable().comment('学号 S20260001');
    t.string('student_name', 50).notNullable().comment('姓名');
    t.integer('gender').notNullable().comment('性别 1男 2女');
    t.integer('age').comment('年龄');
    t.integer('dept_code').notNullable().comment('部门 1初高部 2大学部');
    t.integer('student_status').notNullable().defaultTo(5).comment('学生状态，见数据字典4.1');
    t.integer('stage').comment('学习阶段，见数据字典4.4');
    t.string('id_card', 32).comment('身份证号（休学/退学申请表用）');
    t.string('phone', 32).comment('学生手机号');
    t.string('parent_phone', 32).comment('家长手机号');
    t.string('education', 32).comment('学历');
    t.date('enroll_date').comment('入学时间');
    t.integer('repeat_count').notNullable().defaultTo(0).comment('末班次数');
    t.decimal('attendance_rate', 5, 2).comment('出勤率（百分比）');
    t.string('remark', 500).comment('备注（心理 / 违纪 / 家庭变故）');

    // ---- 班级归属（班主任维护）----
    t.string('class_id', 36).comment('班级ID');
    t.string('class_name', 50).comment('班级名称');
    t.string('head_teacher_id', 36).comment('班主任ID');
    t.string('head_teacher_name', 50).comment('班主任姓名');
    t.string('teacher_id', 36).comment('教员ID');
    t.string('teacher_name', 50).comment('教员姓名');
    t.string('assistant_id', 36).comment('助教ID');
    t.string('assistant_name', 50).comment('助教姓名');

    // ---- 宿舍（同步自教务管理）----
    t.string('dorm_id', 36).comment('宿舍ID');
    t.string('dorm_no', 64).comment('宿舍号，如 A栋-301');

    // ---- 学生档案补充信息 ----
    t.date('birth_date').comment('出生日期');
    t.string('origin', 100).comment('籍贯');
    t.string('graduate_school', 150).comment('毕业院校');
    t.string('home_address', 255).comment('家庭住址');
    t.string('id_photo_url', 255).comment('身份证照片URL');
    t.string('household_photo_url', 255).comment('户口本照片URL');

    // ---- 市场信息（同步自市场咨询，本模块只读）----
    t.string('recruit_teacher_id', 36).comment('招生老师ID');
    t.string('recruit_teacher_name', 50).comment('招生老师姓名');
    t.string('recruit_phone', 32).comment('招生老师电话');
    t.string('consult_teacher_id', 36).comment('咨询老师ID');
    t.string('consult_teacher_name', 50).comment('咨询老师姓名');
    t.string('consult_phone', 32).comment('咨询老师电话');

    // ---- 综合素质（班主任评价）----
    t.string('quality_study', 32).comment('学习状况');
    t.string('quality_discipline', 32).comment('自律程度');
    t.string('quality_ability', 32).comment('学习能力');
    t.string('quality_comprehension', 32).comment('理解能力');
    t.string('quality_expression', 32).comment('表达能力');
    t.string('quality_social', 32).comment('交际能力');
    t.string('quality_note', 500).comment('能力说明');

    // ---- 索引 ----
    t.unique(['student_no'], { indexName: 'uk_student_no' });
    t.index(['source_system', 'source_id'], 'idx_source');
    t.index('class_id', 'idx_class_id');
    t.index(['dept_code', 'student_status'], 'idx_dept_status');
    t.index('head_teacher_id', 'idx_head_teacher');
    t.index('dorm_id', 'idx_dorm_id');
    t.index(['recruit_teacher_id'], 'idx_recruit_teacher');
    t.index(['consult_teacher_id'], 'idx_consult_teacher');
    t.index(['class_name', 'stage'], 'idx_class_stage');

    t.comment('学生表（学管侧档案：市场咨询同步 + 班主任补充）');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('t_class_student');
};
