/**
 * 迁移：t_job_student_leave 增加「复学班」两列
 *
 * ============================================================
 * 【为什么加这两列】（斌哥 2026-10-01 修正流程）
 * ============================================================
 *   复学流程 = 学生回来了 → **班主任提申请** → **学管审批（并选定复学班级）**
 *             → 通过后系统自动改回「实训中」+ 按复学班重新入班
 *
 *   也就是说：**复学班级不是班主任选的，是学管在审批那一刻定的。**
 *
 *   所以单据上要同时能表达两个班：
 *     class_id / class_name           = 学生【原班】（建单时快照，当"从哪休学的"）
 *     new_class_id / new_class_name   = 【复学班】（★ 学管审批时写入）
 *
 *   ⚠️ 这两列**只有复学单**会用到；休学/退学恒为 NULL。
 *      将来若还有别的"要换班"的业务（如转班申请），也可以复用。
 *
 * ⚠️ 铁律：不许直接连数据库改表结构，一切变更走脚本！
 */

/**
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('t_job_student_leave', (table) => {
    table.string('new_class_id', 36).nullable().comment('复学班ID（学管审批时选定；仅复学单有值）');
    table.string('new_class_name', 50).nullable().comment('复学班名称（快照）');
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  await knex.schema.alterTable('t_job_student_leave', (table) => {
    table.dropColumn('new_class_id');
    table.dropColumn('new_class_name');
  });
};
