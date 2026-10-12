/**
 * 迁移：流程表 t_class_flow 增加「退费信息」与「末班通知」字段
 *
 * 背景：
 *   - F-01 退学审批通过后需自动生成退费单 → 退学流程要携带退费类型与金额。
 *   - F-02 末班改走审批流 → 末班流程要携带「被通知班主任 / 是否已通知」。
 *
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('t_class_flow', (table) => {
    // 退费（退学流程专用）
    table.integer('refund_fee_type').comment('退费类型 1学费2住宿费3餐费4保险费（退学流程用）');
    table.integer('refund_amount').comment('退费金额（分，退学流程用）');
    // 末班通知（末班流程专用）
    table.string('notify_user_id', 36).comment('末班通知对象ID（班主任，末班流程用）');
    table.boolean('is_notified').defaultTo(false).comment('末班是否已通知（末班流程用）');
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  await knex.schema.alterTable('t_class_flow', (table) => {
    table.dropColumn('refund_fee_type');
    table.dropColumn('refund_amount');
    table.dropColumn('notify_user_id');
    table.dropColumn('is_notified');
  });
};
