/**
 * 新增两张表：阶段推进日志、升实训交接单
 * 负责人：学管模块（班级管理 8003）
 * 数据库：sms_class
 *
 * 背景（需求 v1.2）：
 *   ① 学习阶段与班级阶段一致，一~六阶段；学管可「推进阶段」（逐级 +1，同步班内学员）。
 *   ② 班级处于第六阶段（206）时才可「升实训」；确认后把班级与班内学员交接到「实训模块」，
 *      班级状态与学员学生状态同时置为「实训中」，并生成一张交接单。
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
  // ---------- 阶段推进日志 ----------
  await knex.schema.createTable('t_class_stage_log', (t) => {
    base(t);
    t.string('class_id', 36).notNullable().comment('班级ID');
    t.string('class_name', 50).notNullable().comment('班级名称');
    t.integer('from_stage').notNullable().comment('推进前阶段值（如 201）');
    t.string('from_stage_name', 32).comment('推进前阶段名（如 一阶段）');
    t.integer('to_stage').notNullable().comment('推进后阶段值');
    t.string('to_stage_name', 32).comment('推进后阶段名');
    t.integer('student_count').notNullable().defaultTo(0).comment('同步更新的学员数');
    t.datetime('operate_time').notNullable().comment('推进时间');
    t.string('operator_id', 36).comment('操作人ID');
    t.string('operator_name', 50).comment('操作人姓名');
    t.string('reason', 200).comment('推进说明');
    t.index('class_id', 'idx_sl_class');
    t.index('operate_time', 'idx_sl_time');
    t.comment('班级阶段推进日志（学管推进阶段时写入）');
  });

  // ---------- 升实训交接单 ----------
  await knex.schema.createTable('t_class_training_handoff', (t) => {
    base(t);
    t.string('handoff_no', 40).notNullable().comment('交接单号');
    t.string('class_id', 36).notNullable().comment('班级ID');
    t.string('class_name', 50).notNullable().comment('班级名称');
    t.integer('dept_code').comment('部门');
    t.integer('stage').notNullable().comment('交接时阶段值（应为 206 六阶段）');
    t.string('stage_name', 32).comment('交接时阶段名');
    t.string('head_teacher_id', 36).comment('班主任ID');
    t.string('head_teacher_name', 50).comment('班主任姓名');
    t.string('teacher_id', 36).comment('教员ID');
    t.string('teacher_name', 50).comment('教员姓名');
    t.integer('student_count').notNullable().defaultTo(0).comment('受影响学员数');
    /** 学员 ID 列表，JSON 字符串 */
    t.text('student_ids').comment('受影响学员ID列表(JSON)');
    t.string('to_module', 50).notNullable().defaultTo('实训模块').comment('交接到哪个模块');
    t.integer('handoff_status').notNullable().defaultTo(1).comment('1已交接 2实训模块已接收');
    t.datetime('handoff_time').notNullable().comment('交接时间');
    t.string('operator_id', 36).comment('操作人ID（学管/校长）');
    t.string('operator_name', 50).comment('操作人姓名');
    t.string('remark', 500).comment('备注');
    t.index('class_id', 'idx_th_class');
    t.index('handoff_no', 'idx_th_no');
    t.comment('升实训交接单（第六阶段班级升实训时生成，交付实训模块）');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('t_class_training_handoff');
  await knex.schema.dropTableIfExists('t_class_stage_log');
};
