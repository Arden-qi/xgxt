/**
 * 迁移：退费审批日志 t_class_refund_log
 *
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('t_class_refund_log', (table) => {
    // ---- 公共字段 ----
    table.string('id', 36).primary().comment('主键UUID');
    table.datetime('create_time').notNullable().comment('创建时间');
    table.string('create_by', 36).comment('创建人ID');
    table.datetime('update_time').comment('修改时间');
    table.string('update_by', 36).comment('修改人ID');
    table.boolean('is_deleted').notNullable().defaultTo(false).comment('逻辑删除');

    // ---- 业务字段 ----
    table.string('refund_id', 36).notNullable().comment('退费单ID');
    table.integer('node_status').notNullable().comment('该节点状态 2/3/4/5');
    table.string('approve_user_id', 36).comment('处理人ID');
    table.string('approve_user_name', 50).comment('处理人姓名');
    table.datetime('approve_time').notNullable().comment('处理时间');
    table.integer('approve_result').notNullable().comment('处理结果 1同意 2驳回');
    table.string('reject_reason', 500).comment('驳回原因');
    table.string('remark', 500).comment('备注');

    // ---- 索引 ----
    table.index(['refund_id'], 'idx_refund_id');

    table.comment('退费审批日志表');
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('t_class_refund_log');
};
