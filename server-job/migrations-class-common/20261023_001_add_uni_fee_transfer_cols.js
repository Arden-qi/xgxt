/**
 * 迁移：统一缴费表补「已转交财务」两列（sms_common.t_uni_fee）
 * ============================================================
 * ★ 2026-10-23 · 修「登记缴费后操作列不变成重新登记/查看」
 *
 * 【这批列是干嘛的】
 *   finance_fee_id         转交后财务侧的缴费单 id（有值 = 已转交，用来判重）
 *   finance_transfer_time  转交时间（留痕，财务对账用）
 *
 * 【为什么表结构上会漏】
 *   2026-10-22 把「批量上传到财务」从只有初高扩到三部门时，
 *   两个同名迁移都叫 `20261022_001_add_finance_fee_id.js`：
 *     · `migrations/`             → `sms_job.t_job_fee_call`（就业老表）
 *     · `migrations-class-common/` → `t_class_urge_sync` + `t_uni_urge`（大学）
 *   而初高 `t_class_fee` 和就业 `t_job_fee_call` 在统一表模式下**都映射到
 *   `sms_common.t_uni_fee`** —— 这张表被漏掉了。
 *
 * 【漏了会怎样（不是"少了两个字段"这么轻）】
 *   转交回写走 `uniUpdCols()`，它按**目标表现有列**过滤：
 *   统一表没有这两列 → 两个值被静默剔除 → 接口返回「转交成功」，
 *   库里 `finance_fee_id` 仍是 NULL → 刷新又变回「未转交」→ 再点一次
 *   财务里就重复记一笔。全程无报错，属于最难查的一类。
 *
 * ⚠️ 老表 `sms_class_jh.t_class_fee` / `sms_job.t_job_fee_call` 已有这两列，
 *   本迁移只负责统一表；up()/down() 都先判表/列存在，可重复执行、可回滚。
 */

const TABLES = ['t_uni_fee'];

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
