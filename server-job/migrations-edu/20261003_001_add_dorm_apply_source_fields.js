/**
 * 迁移脚本：给教务「宿舍申请单」加同步字段
 *
 * 归属：教务 ↔ 就业 合并（2026-10-03）
 *
 * ============================================================
 * 【为什么要加这几列】
 * ============================================================
 *   合并后，实训学生在「就业管理 → 宿舍管理」里发起的**换宿/退宿申请**，
 *   要同步到「教务管理 → 宿舍管理 → 申请审批」里，由教务审批。
 *
 *   于是教务这两张申请表里会同时存在两种来源的记录：
 *     · source = 'edu' → 教务自己发的（初高中部）
 *     · source = 'job' → 就业/实训侧同步过来的
 *
 *   为了能"认得出、回写得了"，需要三列：
 *     source      来源标记（edu / job）
 *     source_id   就业侧申请单 ID（t_job_dorm_change.id），用于审批后回写
 *     student_no  学号（原表只有姓名+班级，关联太弱）
 *
 * ⚠️ 只在 sms_edu 库执行（knexfile 的 edu 环境，迁移目录 migrations-edu）
 * ⚠️ 幂等：列已存在就跳过（迁移重跑不报错）
 */

/**
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  const TABLES = ['t_edu_dorm_change_apply', 't_edu_dorm_quit_apply'];

  for (const table of TABLES) {
    if (!(await knex.schema.hasTable(table))) {
      console.log(`[skip] ${table} 不存在`);
      continue;
    }

    if (!(await knex.schema.hasColumn(table, 'source'))) {
      await knex.schema.alterTable(table, (t) => {
        t.string('source', 10)
          .notNullable()
          .defaultTo('edu')
          .comment('来源：edu=教务自己发起 / job=就业实训同步');
      });
      console.log(`[ok] ${table}.source`);
    }

    if (!(await knex.schema.hasColumn(table, 'source_id'))) {
      await knex.schema.alterTable(table, (t) => {
        t.string('source_id', 36).comment('就业侧申请单ID（t_job_dorm_change.id）');
      });
      console.log(`[ok] ${table}.source_id`);
    }

    if (!(await knex.schema.hasColumn(table, 'student_no'))) {
      await knex.schema.alterTable(table, (t) => {
        t.string('student_no', 32).comment('学号');
      });
      console.log(`[ok] ${table}.student_no`);
    }
  }
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  const TABLES = ['t_edu_dorm_change_apply', 't_edu_dorm_quit_apply'];

  for (const table of TABLES) {
    if (!(await knex.schema.hasTable(table))) continue;
    for (const col of ['source', 'source_id', 'student_no']) {
      if (await knex.schema.hasColumn(table, col)) {
        await knex.schema.alterTable(table, (t) => t.dropColumn(col));
      }
    }
  }
};
