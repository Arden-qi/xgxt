/**
 * 迁移：t_job_fee_call（就业催费单）增加「已转交财务」两列
 * ============================================================
 * ★ 2026-10-22 用户要求：催费页的「批量上传到财务」原来只服务初高
 *   （后端 `class-jh/routes/fee.route.ts` 的 transfer 硬判断 dept_code=1，
 *    前端按钮也只在 初高/全部部门 时显示）。现在大学部、就业部也要能转交。
 *
 * 【为什么要新列，而不是复用 source_system / source_id】
 *   初高 `t_class_fee` 那两列能用，是因为它自己就是台账；
 *   但大学 `t_class_urge_sync` 的 source_system/source_id 是**同步来源**
 *   （'finance' = 财务推来的副本、'edu' = 就业推来的），语义已经占用了；
 *   就业这张表干脆没有这两列。
 *   所以三张表统一新增独立的「转交财务」标记，判重逻辑才不会有歧义。
 *
 *   finance_fee_id         转交后财务侧的缴费单 id（有值 = 已转交，用来判重）
 *   finance_transfer_time  转交时间（留痕，财务核对时对账用）
 *
 * ⚠️ up()/down() 都先判存在再改：可重复执行、可回滚（项目铁律：down 必须能用）。
 */

const TABLE = 't_job_fee_call';

/** 列名 → 建列函数（顺序即加列顺序） */
const COLS = [
  ['finance_fee_id', (t) => t.string('finance_fee_id', 36).comment('已转交财务的缴费单id（有值=已转交）')],
  ['finance_transfer_time', (t) => t.datetime('finance_transfer_time').comment('转交财务时间')],
];

/**
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  /* ★ 2026-10-23 补守卫：本迁移给【老表】加列，而 P8 归一后部分环境的老表已 DROP
     （统一表 t_uni_fee 已自带这两列，功能不受影响）。
     表不存在 → 直接跳过，migrate 不再因此失败。 */
  if (!(await knex.schema.hasTable(TABLE))) return;
  const pending = [];
  for (const [name, def] of COLS) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await knex.schema.hasColumn(TABLE, name))) pending.push(def);
  }
  if (!pending.length) return;
  await knex.schema.alterTable(TABLE, (t) => {
    for (const def of pending) def(t);
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  if (!(await knex.schema.hasTable(TABLE))) return;
  const exist = [];
  for (const [name] of COLS) {
    // eslint-disable-next-line no-await-in-loop
    if (await knex.schema.hasColumn(TABLE, name)) exist.push(name);
  }
  if (!exist.length) return;
  await knex.schema.alterTable(TABLE, (t) => {
    for (const name of exist.reverse()) t.dropColumn(name);
  });
};
