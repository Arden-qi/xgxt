/**
 * 迁移：就业「学籍异动」表补 `resume_class_id`（复学班级）
 * ============================================================
 * ★ 2026-10-22 用户要求：「复学填哪个班级 —— 所有部门统一用 resume_class_id」
 *
 * 【三部门现状（改造前）】
 *   初高 sms_class_jh.t_class_flow.resume_class_id        ← 本来就叫这个
 *   大学 sms_class.t_class_suspend_apply.new_class_id     ← 名字不一样
 *   就业 sms_job.t_job_student_leave.new_class_id         ← 名字不一样
 *
 *   对外接口和前端早就统一用 `newClassId` 了，只是**底层列名**三套。
 *   按列名统一后，写报表/对数/排查时不用再逐个翻译。
 *
 * 【为什么保留 new_class_id 不删】
 *   · 存量数据要能回滚；
 *   · 万一还有老代码/老脚本在读它，删掉会直接报 Unknown column。
 *   所以本次是「加新列 + 回填 + 新代码只读新列、读不到再回落老列」。
 *
 * ⚠️ up()/down() 都先判表/列存在再改：可重复执行、可回滚。
 */

const TABLES = ["t_job_student_leave"];

const COLS = [
  ['resume_class_id', (t) => t.string('resume_class_id', 36).comment('复学班级ID（三部门统一，替代 new_class_id）')],
];

/**
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  for (const table of TABLES) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await knex.schema.hasTable(table))) continue;

    const pending = [];
    for (const [name, def] of COLS) {
      // eslint-disable-next-line no-await-in-loop
      if (!(await knex.schema.hasColumn(table, name))) pending.push(def);
    }
    if (pending.length) {
      // eslint-disable-next-line no-await-in-loop
      await knex.schema.alterTable(table, (t) => {
        for (const def of pending) def(t);
      });
    }

    /**
     * 回填：把老的 new_class_id 搬到新列
     * ⚠️ 只填新列为空的那些行 —— 重复执行不会覆盖后续在新列上改过的值。
     */
    // eslint-disable-next-line no-await-in-loop
    if (await knex.schema.hasColumn(table, 'new_class_id')) {
      // eslint-disable-next-line no-await-in-loop
      await knex.raw(
        `UPDATE ?? SET resume_class_id = new_class_id
         WHERE resume_class_id IS NULL AND new_class_id IS NOT NULL`,
        [table],
      );
    }
  }
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  for (const table of TABLES) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await knex.schema.hasTable(table))) continue;
    // eslint-disable-next-line no-await-in-loop
    if (!(await knex.schema.hasColumn(table, 'resume_class_id'))) continue;
    // eslint-disable-next-line no-await-in-loop
    await knex.schema.alterTable(table, (t) => t.dropColumn('resume_class_id'));
  }
};
