/**
 * 迁移：初高退费补「费用项子表」（对齐大学部）
 * ============================================================
 * ★ 2026-10-22 用户要求：「退费，所有内容和大学统一」
 *
 * 【三部门改造前的差异】
 *   大学 sms_class.t_class_refund_apply  + 子表 t_class_refund_item  ← 标杆
 *        一笔退费可以选**多个费用项**（学费 + 住宿费…），各自金额
 *   初高 sms_class_jh.t_class_refund    只有单值 fee_type（无子表）
 *        一笔只能退**一个**费用项
 *   就业 sms_job.t_job_refund           三个金额列（学费/住宿/餐费）
 *        最多只能表达这三项，加新费用类型就得改表
 *
 * 【本次做法：表各自保留，结构对齐】
 *   不改老表结构（避免动存量数据），给初高补一张与大学**同名同结构**的子表：
 *     t_class_refund_item(id, refund_id, fee_type, amount)
 *   写入时：主表照旧写 fee_type（第一项，兼容老读法）+ 子表写全部项；
 *   读取时：**子表优先**，子表没有（老数据）再回落主表单值。
 *
 * ⚠️ up()/down() 都先判存在再改：可重复执行、可回滚。
 */

const TABLE = 't_class_refund_item';

/**
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  if (await knex.schema.hasTable(TABLE)) return;
  await knex.schema.createTable(TABLE, (t) => {
    t.string('id', 36).primary().comment('主键UUID');
    t.datetime('create_time').notNullable().comment('创建时间');
    t.string('create_by', 36).comment('创建人ID');
    t.datetime('update_time').comment('修改时间');
    t.string('update_by', 36).comment('修改人ID');
    t.boolean('is_deleted').notNullable().defaultTo(false).comment('逻辑删除');
    t.string('refund_id', 36).notNullable().comment('退费单ID');
    t.integer('fee_type').notNullable().comment('费用类型 1学费2住宿费3餐费4保险费5试学费');
    t.bigint('amount').notNullable().defaultTo(0).comment('该项退费金额（分）');
    t.index(['refund_id'], 'idx_refund_item_refund');
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  if (await knex.schema.hasTable(TABLE)) await knex.schema.dropTable(TABLE);
};
