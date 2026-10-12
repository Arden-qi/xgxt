/**
 * 咨询推送单扩展：支持「成绩管理 → 末班 → 待接收学员」的末班 / 重修入班
 * 负责人：学管模块（班级管理 8003）
 * 数据库：sms_class
 *
 * 背景（需求 v1.3）：
 *   成绩管理里对「未通过」的学生点「末班」，该生信息进入对应班主任的「待接收学员」
 *   （复用 t_class_consult_push 作为统一的接收工作台）。班主任「同意」后，学生回到目标班级。
 *   与咨询新生不同，末班是**已建档学生**的重读，接收时需要：
 *     - 记住源学生（origin_student_id）
 *     - 记住原班级（from_class_id / from_class_name）
 *     - 标记「末班 / 重修转入」（is_repeat_in），封班班级也放行
 */

function addColumnSafe(knex, table, col, builder) {
  return knex.schema.hasColumn(table, col).then((exists) => {
    if (exists) return null;
    return knex.schema.alterTable(table, builder);
  });
}

exports.up = async function up(knex) {
  await addColumnSafe(knex, 't_class_consult_push', 'origin_student_id', (t) => {
    t.string('origin_student_id', 36).comment('末班来源学生ID（已建档学生重读）');
  });
  await addColumnSafe(knex, 't_class_consult_push', 'from_class_id', (t) => {
    t.string('from_class_id', 36).comment('末班来源班级ID');
  });
  await addColumnSafe(knex, 't_class_consult_push', 'from_class_name', (t) => {
    t.string('from_class_name', 50).comment('末班来源班级名称');
  });
  await addColumnSafe(knex, 't_class_consult_push', 'is_repeat_in', (t) => {
    t.boolean('is_repeat_in').notNullable().defaultTo(false).comment('是否末班/重修转入（封班班级也放行）');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('t_class_consult_push', (t) => {
    t.dropColumn('origin_student_id');
    t.dropColumn('from_class_id');
    t.dropColumn('from_class_name');
    t.dropColumn('is_repeat_in');
  });
};
