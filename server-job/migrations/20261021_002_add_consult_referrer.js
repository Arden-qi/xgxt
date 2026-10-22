/**
 * 迁移：t_consult_student 增加「转介绍招生老师」两列（★ 补 2026-10-15 漏掉的迁移）
 *
 * 背景（E2E 实测发现的真实缺陷）：
 *   2026-10-15 咨询模块加了「来源=转介绍时填招生老师」功能，
 *   代码（consult 模块 student.route.ts 的 /add）开始写 referrer_name / referrer_phone，
 *   建库 SQL（sql/init/sms_consult.sql）也加了这两列 ——
 *   但【没有对应的 knex 迁移】。旧库升级后「新增咨询学员」直接撞
 *   50002「数据库字段不存在」。
 *
 * ★★ 2026-10-22 重要修正 —— 这个文件曾经把整台机器的安装跑挂：
 *
 *   它原来没有 hasTable 判断，直接 hasColumn('t_consult_student', ...)。
 *   而它所在的主目录 `migrations/` 跑的是 **sms_job**，那边根本没有这张表，
 *   knex 的 hasColumn 会执行 `show columns from t_consult_student` 并抛：
 *       Table 'sms_job.t_consult_student' doesn't exist
 *
 *   而 `npm run migrate` 以前是 `&&` 串联 —— 第一个库（sms_job）就失败，
 *   后面 edu / class / class-common / class-jh 四个库【一个都没跑】。
 *   新机器上的表现就是：
 *       ① 新建班级 → 「数据库字段不存在」（class_code 等列不存在）
 *       ② 无法新增学生
 *
 *   修法分两半：
 *     a) 本文件加 hasTable 保护 —— 在没有这张表的库（sms_job）上纯空转，
 *        不会再让整个迁移链断掉；
 *     b) 真正给 sms_consult 补列由 `npm run fix:consult` 负责
 *        （scripts/fix-consult-columns.mjs）。
 *        为什么不给 consult 单开一个 knex 迁移目录：
 *        sms_consult.knex_migrations 里记着 8 条早已删除的一次性迁移，
 *        knex 会判「migration directory is corrupt」，反而跑不动。
 *
 *   ⚠️ 保留本文件（而不是删掉）还有一个原因：万一某个环境已经把这条迁移
 *      记进 knex_migrations，文件缺失会让 knex 报 corrupt。
 *      留着 + 空转最稳。
 */

const TABLE = 't_consult_student';

/**
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  // 没有这张表 = 当前连的不是咨询库（比如 sms_job），直接空转
  if (!(await knex.schema.hasTable(TABLE))) return;
  const hasName = await knex.schema.hasColumn(TABLE, 'referrer_name');
  const hasPhone = await knex.schema.hasColumn(TABLE, 'referrer_phone');
  if (!hasName || !hasPhone) {
    await knex.schema.alterTable(TABLE, (t) => {
      if (!hasName) t.string('referrer_name', 50).comment('转介绍招生老师姓名（来源=转介绍时填）');
      if (!hasPhone) t.string('referrer_phone', 20).comment('转介绍招生老师电话');
    });
  }
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  if (!(await knex.schema.hasTable(TABLE))) return;
  const hasName = await knex.schema.hasColumn(TABLE, 'referrer_name');
  const hasPhone = await knex.schema.hasColumn(TABLE, 'referrer_phone');
  if (hasName || hasPhone) {
    await knex.schema.alterTable(TABLE, (t) => {
      if (hasPhone) t.dropColumn('referrer_phone');
      if (hasName) t.dropColumn('referrer_name');
    });
  }
};
