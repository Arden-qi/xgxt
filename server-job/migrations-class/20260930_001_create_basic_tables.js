/**
 * 创建班级基础表：班级档案、班级交接、末班记录
 * 负责人：学管模块（班级管理 8003）
 * 数据库：sms_class
 */

/** 全局公共字段（所有表都要有，见数据字典第三节） */
function base(table) {
  table.string('id', 36).primary().comment('主键UUID');
  table.datetime('create_time').notNullable().comment('创建时间');
  table.string('create_by', 36).comment('创建人ID');
  table.datetime('update_time').comment('最后修改时间');
  table.string('update_by', 36).comment('最后修改人ID');
  table.boolean('is_deleted').notNullable().defaultTo(false).comment('逻辑删除标记，禁止物理删除');
}

exports.up = async function up(knex) {
  // ---------- 班级档案 ----------
  await knex.schema.createTable('t_class_info', (t) => {
    base(t);
    t.string('class_name', 50).notNullable().comment('班级名称，如 G104 / Q17');
    t.integer('dept_code').notNullable().comment('部门 1初高部 2大学部');
    t.integer('stage').notNullable().comment('学习阶段，见数据字典4.4');
    t.string('head_teacher_id', 36).comment('班主任ID');
    t.string('head_teacher_name', 50).comment('班主任姓名');
    t.string('teacher_id', 36).comment('教员ID');
    t.string('teacher_name', 50).comment('教员姓名');
    t.string('assistant_id', 36).comment('助教ID');
    t.string('assistant_name', 50).comment('助教姓名');
    t.string('room', 64).comment('教室');
    t.date('open_date').comment('开班日期');
    t.integer('student_count').notNullable().defaultTo(0).comment('班级人数');
    t.integer('class_status').notNullable().defaultTo(1).comment('班级状态 1开放2封班3待结业4已结业');
    t.decimal('attendance_rate', 5, 2).comment('出勤率（百分比）');
    t.index('class_name', 'idx_class_name');
    t.index(['dept_code', 'stage'], 'idx_dept_stage');
    t.index('head_teacher_id', 'idx_head_teacher');
    t.index('class_status', 'idx_class_status');
    t.comment('班级档案表');
  });

  // ---------- 班级交接记录 ----------
  await knex.schema.createTable('t_class_transfer', (t) => {
    base(t);
    t.string('class_id', 36).notNullable().comment('班级ID');
    t.string('class_name', 50).notNullable().comment('班级名称');
    t.string('transfer_type', 20).notNullable().comment('交接类型 headTeacher/teacher/assistant');
    t.string('from_user_id', 36).comment('原负责人ID');
    t.string('from_user_name', 50).comment('原负责人姓名');
    t.string('to_user_id', 36).comment('新负责人ID');
    t.string('to_user_name', 50).comment('新负责人姓名');
    t.datetime('transfer_time').notNullable().comment('交接时间');
    t.string('reason', 255).comment('交接原因');
    t.index('class_id', 'idx_tr_class');
    t.index('to_user_id', 'idx_tr_to_user');
    t.comment('班级交接记录表（详情→班级信息→历史信息）');
  });

  // ---------- 末班记录 ----------
  await knex.schema.createTable('t_class_repeat', (t) => {
    base(t);
    t.string('student_id', 36).notNullable().comment('学生ID');
    t.string('student_no', 32).notNullable().comment('学号');
    t.string('student_name', 50).notNullable().comment('学生姓名');
    t.datetime('repeat_time').notNullable().comment('末班时间');
    t.string('repeat_reason', 500).notNullable().comment('末班原因');
    t.string('from_class_id', 36).comment('原班级ID');
    t.string('from_class_name', 50).comment('原班级名称');
    t.string('to_class_id', 36).comment('末班转入班级ID');
    t.string('to_class_name', 50).comment('末班转入班级名称');
    t.integer('repeat_count').notNullable().defaultTo(1).comment('累计末班次数');
    t.index('student_id', 'idx_rp_student');
    t.index('repeat_time', 'idx_rp_time');
    t.comment('末班记录表（末班是事件，不是学生状态）');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('t_class_repeat');
  await knex.schema.dropTableIfExists('t_class_transfer');
  await knex.schema.dropTableIfExists('t_class_info');
};
