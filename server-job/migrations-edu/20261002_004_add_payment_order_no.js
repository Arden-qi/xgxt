/**
 * 缴费记录：新增「订单号」
 *
 * 背景：即将到期页上传凭证时，教务要上传缴费截图，系统自动识别截图上的
 *       缴费金额和订单号并填入。金额沿用已有的 amount 列，订单号是新列。
 *
 * 说明：
 *   - 订单号可为空（老数据、批量上传的记录都没有）
 *   - 加索引方便按订单号反查
 */

exports.up = async function (knex) {
  const has = await knex.schema.hasColumn('t_payment', 'order_no');
  if (!has) {
    await knex.schema.alterTable('t_payment', (t) => {
      t.string('order_no', 64).nullable().comment('支付订单号（截图识别填入）');
      t.index(['order_no'], 'idx_payment_order_no');
    });
  }
};

exports.down = async function (knex) {
  const has = await knex.schema.hasColumn('t_payment', 'order_no');
  if (has) {
    await knex.schema.alterTable('t_payment', (t) => {
      t.dropIndex(['order_no'], 'idx_payment_order_no');
      t.dropColumn('order_no');
    });
  }
};
