/**
 * 迁移脚本：删掉三个模块的「单号」字段
 *
 * 斌哥 2026-09-30 拍板：「催费单号 / 退学单号 / 宿舍单号」**连数据库字段一起删**
 *   —— 不只是界面上不显示。
 *
 * ⚠️ 「休学退学」是**同一张表**（t_job_student_leave，biz_type 1休学 / 2退学），
 *    所以删了 leave_no，**休学单也会一起没单号**（斌哥已确认可以）。
 *
 * ⚠️ **不可逆**：up() 里把列和唯一索引一起删掉，历史单号数据会丢失。
 *    down() 只能把列**结构**加回来（值补不回来），仅供回滚表结构用。
 *
 * ⚠️ 铁律：不许直接连数据库改表结构，一切变更走脚本！
 */

/**
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  // ---- ① 催费单：call_no ----
  await knex.schema.alterTable('t_job_fee_call', (t) => {
    t.dropUnique(['call_no'], 'uk_call_no');
  });
  await knex.schema.alterTable('t_job_fee_call', (t) => {
    t.dropColumn('call_no');
  });

  // ---- ② 休学/退学单：leave_no ----
  await knex.schema.alterTable('t_job_student_leave', (t) => {
    t.dropUnique(['leave_no'], 'uk_leave_no');
  });
  await knex.schema.alterTable('t_job_student_leave', (t) => {
    t.dropColumn('leave_no');
  });

  // ---- ③ 宿舍调换/退宿单：change_no ----
  await knex.schema.alterTable('t_job_dorm_change', (t) => {
    t.dropUnique(['change_no'], 'uk_change_no');
  });
  await knex.schema.alterTable('t_job_dorm_change', (t) => {
    t.dropColumn('change_no');
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  // 回滚：只恢复**列结构**（原来的单号值已经丢了，补不回来）
  await knex.schema.alterTable('t_job_fee_call', (t) => {
    t.string('call_no', 32).nullable().comment('催费单号（2026-09-30 已废弃）');
  });
  await knex.schema.alterTable('t_job_student_leave', (t) => {
    t.string('leave_no', 32).nullable().comment('单号（2026-09-30 已废弃）');
  });
  await knex.schema.alterTable('t_job_dorm_change', (t) => {
    t.string('change_no', 32).nullable().comment('单号（2026-09-30 已废弃）');
  });
};
