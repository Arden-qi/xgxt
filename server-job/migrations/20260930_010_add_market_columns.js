/**
 * 迁移脚本：学生主档补 4 个「市场信息」字段
 *
 * 起因（斌哥 2026-09-30 定稿）：
 *   学生的「招生老师 / 咨询老师」信息，之前是【实时调咨询模块 8001】拿的。
 *   后经确认，改成【升阶时由大学部（8003）搬过来】——
 *   升阶时把学生完整档案（含市场信息）一次性写进实训库，之后本模块**读自己库**，
 *   不再实时调 8001。
 *
 * 为什么放学生主档：
 *   招生老师 / 咨询老师是学生「入学时就定、之后基本不变」的静态属性，
 *   和「姓名 / 学历」同一层级，放同一张表最省事。
 *
 * ⚠️ 全部 nullable —— 历史数据（已存在的学生）这 4 个字段都是空的，
 *    给 NOT NULL 会直接把迁移跑挂。
 *
 * ⚠️ 铁律：不许直接连数据库改表结构，一切变更走脚本！
 */

/**
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('t_student_base', (t) => {
    t.string('admission_teacher', 64).nullable().comment('招生老师姓名');
    t.string('admission_teacher_phone', 32).nullable().comment('招生老师电话');
    t.string('consult_teacher', 64).nullable().comment('咨询老师姓名');
    t.string('consult_teacher_phone', 32).nullable().comment('咨询老师电话');
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  await knex.schema.alterTable('t_student_base', (t) => {
    t.dropColumn('admission_teacher');
    t.dropColumn('admission_teacher_phone');
    t.dropColumn('consult_teacher');
    t.dropColumn('consult_teacher_phone');
  });
};
