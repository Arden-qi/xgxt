/**
 * 迁移脚本：给教务「宿舍申请单」加性别字段
 *
 * 归属：教务 ↔ 就业 合并（2026-10-04）
 *
 * ============================================================
 * 【为什么要加这一列】
 * ============================================================
 *   「教务管理 → 宿舍管理 → 申请审批」的字段，要和
 *   「就业管理 → 宿舍管理 → 调换/退宿申请」保持一致。
 *
 *   就业侧列表的「学生」列显示的是：姓名 + 性别 + 学号，
 *   而教务这两张申请表只有 student_name / student_no，**没有性别**，
 *   同步时也没带过来 → 教务这边显示不出性别。
 *
 *   所以加一列 gender，由 dormBridge 同步时从就业侧申请单带过来。
 *
 *   取值跟全项目一致：1=男 / 2=女（见 shared-types 的 Gender 枚举）。
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

    if (!(await knex.schema.hasColumn(table, 'gender'))) {
      await knex.schema.alterTable(table, (t) => {
        t.integer('gender').nullable().comment('性别：1=男 / 2=女（列表显示用）');
      });
      console.log(`[ok] ${table}.gender`);
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
    if (await knex.schema.hasColumn(table, 'gender')) {
      await knex.schema.alterTable(table, (t) => t.dropColumn('gender'));
    }
  }
};
