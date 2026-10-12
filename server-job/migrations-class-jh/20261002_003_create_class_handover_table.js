/**
 * 迁移：师资交接 t_class_handover
 *
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('t_class_handover', (table) => {
    // ---- 公共字段 ----
    table.string('id', 36).primary().comment('主键UUID');
    table.datetime('create_time').notNullable().comment('创建时间');
    table.string('create_by', 36).comment('创建人ID');
    table.datetime('update_time').comment('修改时间');
    table.string('update_by', 36).comment('修改人ID');
    table.boolean('is_deleted').notNullable().defaultTo(false).comment('逻辑删除');

    // ---- 业务字段 ----
    table.string('class_id', 36).notNullable().comment('班级ID');
    table.string('class_name', 50).notNullable().comment('班级名称');
    table.integer('handover_role').notNullable().comment('交接岗位 1班主任 2教员');
    table.string('from_user_id', 36).comment('原任ID');
    table.string('from_user_name', 50).comment('原任姓名');
    table.string('to_user_id', 36).notNullable().comment('接管人ID');
    table.string('to_user_name', 50).notNullable().comment('接管人姓名');
    table.string('handover_reason', 500).comment('交接原因');
    table.string('handover_content', 1000).notNullable().comment('交接内容');
    table.datetime('handover_time').notNullable().comment('交接时间');
    table.string('arrange_user_id', 36).comment('安排人ID（教质/学术经理）');
    table.string('arrange_user_name', 50).comment('安排人姓名');

    // ---- 索引 ----
    table.index(['class_id'], 'idx_class_id');
    table.index(['handover_time'], 'idx_handover_time');

    table.comment('师资交接表');
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('t_class_handover');
};
