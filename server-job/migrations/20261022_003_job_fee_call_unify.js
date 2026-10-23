/**
 * 迁移：就业催费单（t_job_fee_call）对齐初高的三件事
 * ============================================================
 * ★ 2026-10-22 用户要求（原话）：
 *   「单子怎么来，就业同初高；状态字段所有部门对齐初高；
 *     逾期怎么判所有部门：未缴清 + 过了应缴日」
 *
 * 【本次加 3 列 + 1 索引】
 *
 *   ① pay_status  缴费状态：1待缴 2已缴 3已核对 4逾期 5冻结
 *      —— 与初高 `t_class_fee.pay_status`、大学 `t_class_urge_sync.pay_status` 同一套码。
 *      就业原来只有 `call_status`（1待催缴 2催缴中 3已缴清），是「催收进度」不是「缴费状态」，
 *      前端一直在做折算（待催缴/催缴中→待缴、已缴清→已缴），两套码并存容易对不上。
 *      现在库里直接存 pay_status，`call_status` 保留（历史数据、催收进度仍然有用）。
 *
 *   ② source_system / source_id
 *      财务缴费单 → 就业催费单 的幂等同步键（与初高 t_class_fee 同款，
 *      唯一索引 uk_job_fee_source）。没有它，「财务建单/回传凭证/核对」每次触发同步
 *      都会重复插一条催费单。
 *
 * 【回填口径】
 *   · pay_status：按 call_status 折算（1/2→1 待缴，3→2 已缴），
 *     **再按到期日补逾期**（未结清 且 due_date < 今天 → 4 逾期）。
 *     这正是用户要的「未缴清 + 过了应缴日」。
 *   · source_system：历史人工单填 'manual'，免得唯一索引里一堆 NULL 干扰判重。
 *
 * ⚠️ up()/down() 都先判存在再改：可重复执行、可回滚。
 */

const TABLE = 't_job_fee_call';
const IDX = 'uk_job_fee_source';

/**
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  if (!(await knex.schema.hasTable(TABLE))) return;

  /* ---------- 1. 加列 ---------- */
  const COLS = [
    ['pay_status', (t) => t.integer('pay_status').comment('缴费状态 1待缴2已缴3已核对4逾期5冻结（与初高同码）')],
    ['source_system', (t) => t.string('source_system', 20).comment('来源系统 finance=财务同步 manual=人工发起')],
    ['source_id', (t) => t.string('source_id', 64).comment('来源单据ID（财务缴费单id），同步幂等键')],
  ];

  const pending = [];
  for (const [name, def] of COLS) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await knex.schema.hasColumn(TABLE, name))) pending.push(def);
  }
  if (pending.length) {
    await knex.schema.alterTable(TABLE, (t) => {
      for (const def of pending) def(t);
    });
  }

  /* ---------- 2. 回填 pay_status（含逾期派生） ---------- */
  await knex.raw(
    `UPDATE ?? SET pay_status = CASE
        WHEN call_status = 3 THEN 2
        WHEN pay_status = 3 THEN 3
        WHEN pay_status = 5 THEN 5
        ELSE 1
     END
     WHERE pay_status IS NULL`,
    [TABLE],
  );
  await knex.raw(
    `UPDATE ?? SET pay_status = 4
     WHERE pay_status = 1 AND due_date IS NOT NULL AND due_date < CURDATE()`,
    [TABLE],
  );

  /* ---------- 3. 回填 source_system ---------- */
  await knex.raw(`UPDATE ?? SET source_system = 'manual' WHERE source_system IS NULL`, [TABLE]);

  /* ---------- 4. 唯一索引（幂等同步用） ---------- */
  const hasIdx = await knex.raw(
    `SELECT COUNT(*) AS c FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [TABLE, IDX],
  );
  if (!Number(hasIdx?.[0]?.[0]?.c ?? 0)) {
    await knex.raw(
      `ALTER TABLE ?? ADD UNIQUE KEY ?? (source_system, source_id)`,
      [TABLE, IDX],
    );
  }
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  if (!(await knex.schema.hasTable(TABLE))) return;

  const hasIdx = await knex.raw(
    `SELECT COUNT(*) AS c FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [TABLE, IDX],
  );
  if (Number(hasIdx?.[0]?.[0]?.c ?? 0)) {
    await knex.raw(`ALTER TABLE ?? DROP INDEX ??`, [TABLE, IDX]);
  }

  const exist = [];
  for (const name of ['pay_status', 'source_system', 'source_id']) {
    // eslint-disable-next-line no-await-in-loop
    if (await knex.schema.hasColumn(TABLE, name)) exist.push(name);
  }
  if (exist.length) {
    await knex.schema.alterTable(TABLE, (t) => {
      for (const name of exist.reverse()) t.dropColumn(name);
    });
  }
};
