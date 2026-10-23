/**
 * 迁移：大学催费副本补「已转交财务」两列（老表 + 统一表各一份）
 * ============================================================
 * ★ 2026-10-22：催费「批量上传到财务」从「只有初高」扩到三个部门。
 *
 * 加的列：
 *   finance_fee_id         转交后财务侧的缴费单 id（有值 = 已转交，用来判重）
 *   finance_transfer_time  转交时间
 *
 * 【为什么不复用 source_system / source_id】
 *   `t_class_urge_sync` 的这两列是**同步来源**：
 *     source_system='finance' → 这张单本来就在财务（财务推来的副本）
 *     source_system='edu'     → 这张单是就业催费单推过来的副本
 *   拿它当「已转交标记」会和同步语义打架 —— 同一列两种含义，判重必然出错。
 *
 * 【为什么统一表也要加】
 *   催缴仓储走 `teaching/shared/uniTable.ts` 的路由层：
 *   `TEACHING_UNI_TABLE=1` 时 `t_class_urge_sync` 映射成 `t_uni_urge`。
 *   只给老表加列的话，一切到统一表模式，这两列会被 `uniUpdCols()`
 *   （按目标表现有列过滤）**静默丢掉** —— 界面看着转交成功、库里没写、下次又重复转交。
 *
 * ⚠️ up()/down() 都先判表/列存在再改：可重复执行、可回滚。
 */

const TABLES = ['t_class_urge_sync', 't_uni_urge'];

const COLS = [
  ['finance_fee_id', (t) => t.string('finance_fee_id', 36).comment('已转交财务的缴费单id（有值=已转交）')],
  ['finance_transfer_time', (t) => t.datetime('finance_transfer_time').comment('转交财务时间')],
];

/**
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  for (const table of TABLES) {
    // 统一表可能还没建（老环境）→ 没有表就跳过，别把迁移卡死
    // eslint-disable-next-line no-await-in-loop
    if (!(await knex.schema.hasTable(table))) continue;

    const pending = [];
    for (const [name, def] of COLS) {
      // eslint-disable-next-line no-await-in-loop
      if (!(await knex.schema.hasColumn(table, name))) pending.push(def);
    }
    if (!pending.length) continue;
    // eslint-disable-next-line no-await-in-loop
    await knex.schema.alterTable(table, (t) => {
      for (const def of pending) def(t);
    });
  }
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  for (const table of TABLES) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await knex.schema.hasTable(table))) continue;

    const exist = [];
    for (const [name] of COLS) {
      // eslint-disable-next-line no-await-in-loop
      if (await knex.schema.hasColumn(table, name)) exist.push(name);
    }
    if (!exist.length) continue;
    // eslint-disable-next-line no-await-in-loop
    await knex.schema.alterTable(table, (t) => {
      for (const name of exist.reverse()) t.dropColumn(name);
    });
  }
};
