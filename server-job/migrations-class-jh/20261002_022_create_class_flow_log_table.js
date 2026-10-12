/**
 * 迁移：流程审批日志 t_class_flow_log
 *
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('t_class_flow_log', (table) => {
    // ---- 公共字段 ----
    table.string('id', 36).primary().comment('主键UUID');
    table.datetime('create_time').notNullable().comment('创建时间');
    table.string('create_by', 36).comment('创建人ID');
    table.datetime('update_time').comment('修改时间');
    table.string('update_by', 36).comment('修改人ID');
    table.boolean('is_deleted').notNullable().defaultTo(false).comment('逻辑删除');

    // ---- 业务字段 ----
    table.string('flow_id', 36).notNullable().comment('流程ID');
    table.string('node_name', 50).comment('节点名称');
    table.string('approve_user_id', 36).comment('处理人ID');
    table.string('approve_user_name', 50).comment('处理人姓名');
    table.datetime('approve_time').notNullable().comment('处理时间');
    table.integer('approve_result').notNullable().comment('处理结果 1同意 2驳回');
    table.string('reject_reason', 500).comment('驳回原因');
    table.string('remark', 500).comment('备注');

    // ---- 索引 ----
    table.index(['flow_id'], 'idx_flow_id');

    table.comment('流程审批日志表');
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('t_class_flow_log');
};
