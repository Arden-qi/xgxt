/**
 * v1.5：换班转入 + 末班记录带成绩 + 学生换班留痕
 * 负责人：学管模块（班级管理 8003）
 * 数据库：sms_class
 *
 * 背景（需求 v1.5）：
 *   ① 班级信息管理「功能」列新增「换班」：弹出学生信息 + 选择班级 + 换班原因，
 *     确认后信息进入目标班级班主任的「待接收学员」（复用 t_class_consult_push，
 *     用 source_system='transfer' 与「末班重修」「咨询新生」区分）。
 *   ② 详情「末班」页签要同步成绩管理「末班」时的成绩 + 转班记录（from→to 班级），
 *     所以给 t_class_repeat 补成绩快照字段。
 *   ③ 学生跨班换班需要留痕：新增 t_class_student_transfer（学生换班记录）。
 */

function addColumnSafe(knex, table, col, builder) {
  return knex.schema.hasColumn(table, col).then((exists) => {
    if (exists) return null;
    return knex.schema.alterTable(table, builder);
  });
}

exports.up = async function up(knex) {
  // ---------- 咨询推送单：补换班原因 ----------
  await addColumnSafe(knex, 't_class_consult_push', 'transfer_reason', (t) => {
    t.string('transfer_reason', 500).comment('换班原因（source_system=transfer 时必填）');
  });

  // ---------- 末班记录：补成绩快照（详情「末班」页签展示） ----------
  await addColumnSafe(knex, 't_class_repeat', 'exam_name', (t) => {
    t.string('exam_name', 100).comment('触发末班的那次考试名称');
  });
  await addColumnSafe(knex, 't_class_repeat', 'written_score', (t) => {
    t.decimal('written_score', 6, 2).comment('末班时笔试成绩');
  });
  await addColumnSafe(knex, 't_class_repeat', 'interview_score', (t) => {
    t.decimal('interview_score', 6, 2).comment('末班时面试成绩');
  });
  await addColumnSafe(knex, 't_class_repeat', 'comp_score', (t) => {
    t.decimal('comp_score', 6, 2).comment('末班时综合成绩');
  });

  // ---------- 学生换班记录 ----------
  await knex.schema.createTable('t_class_student_transfer', (t) => {
    t.string('id', 36).primary().comment('主键UUID');
    t.datetime('create_time').notNullable().comment('创建时间');
    t.string('create_by', 36).comment('创建人ID');
    t.datetime('update_time').comment('最后修改时间');
    t.string('update_by', 36).comment('最后修改人ID');
    t.boolean('is_deleted').notNullable().defaultTo(false).comment('逻辑删除标记');
    t.string('student_id', 36).notNullable().comment('学生ID');
    t.string('student_no', 32).notNullable().comment('学号');
    t.string('student_name', 50).notNullable().comment('学生姓名');
    t.string('from_class_id', 36).comment('原班级ID');
    t.string('from_class_name', 50).comment('原班级名称');
    t.string('to_class_id', 36).comment('换入班级ID');
    t.string('to_class_name', 50).comment('换入班级名称');
    t.string('transfer_reason', 500).notNullable().comment('换班原因');
    t.string('consult_no', 40).comment('关联换班申请单号');
    t.datetime('transfer_time').notNullable().comment('换班时间');
    t.index('student_id', 'idx_stf_student');
    t.index('transfer_time', 'idx_stf_time');
    t.comment('学生换班记录表（班级信息管理「换班」→ 待接收 → 接收后留痕）');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('t_class_student_transfer');
  await knex.schema.alterTable('t_class_repeat', (t) => {
    t.dropColumn('comp_score');
    t.dropColumn('interview_score');
    t.dropColumn('written_score');
    t.dropColumn('exam_name');
  });
  await knex.schema.alterTable('t_class_consult_push', (t) => {
    t.dropColumn('transfer_reason');
  });
};
