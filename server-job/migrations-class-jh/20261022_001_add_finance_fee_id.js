/**
 * 迁移：t_class_fee（初高催费台账）增加「已转交财务」两列
 * ============================================================
 * ★ 2026-10-22：催费「批量上传到财务」从「只有初高」扩到三个部门，
 *   三张表统一用一对独立列记「转交财务」这件事，判重逻辑才不会歧义。
 *
 *   初高原来靠 `source_system='finance' + source_id` 判重，那套继续兼容；
 *   新增这两列后**新代码统一看 finance_fee_id**（老数据也会被回填）。
 *
 *   finance_fee_id         转交后财务侧的缴费单 id（有值 = 已转交）
 *   finance_transfer_time  转交时间
 *
 * ⚠️ up()/down() 都先判存在再改：可重复执行、可回滚。
 */

const TABLE = 't_class_fee';

const COLS = [
  ['finance_fee_id', (t) => t.string('finance_fee_id', 36).comment('已转交财务的缴费单id（有值=已转交）')],
  ['finance_transfer_time', (t) => t.datetime('finance_transfer_time').comment('转交财务时间')],
];

/**
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
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
