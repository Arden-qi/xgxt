/**
 * 迁移：系统设置（KV）t_class_setting
 *
 * 预置键：attendanceTargetRate(90)、attendanceScope(JSON)、feeRemindDays(7)、
 *        refundThresholdAmount(500000)、closedClassIntakeTypes(JSON [1,2])、allowStudentAdd(false)。
 *
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('t_class_setting', (table) => {
    // ---- 公共字段 ----
    table.string('id', 36).primary().comment('主键UUID');
    table.datetime('create_time').notNullable().comment('创建时间');
    table.string('create_by', 36).comment('创建人ID');
    table.datetime('update_time').comment('修改时间');
    table.string('update_by', 36).comment('修改人ID');
    table.boolean('is_deleted').notNullable().defaultTo(false).comment('逻辑删除');

    // ---- 业务字段 ----
    table.string('setting_key', 64).notNullable().comment('键名');
    table.string('setting_name', 100).comment('中文名');
    table.string('setting_value', 1000).comment('值（数字/JSON 字符串）');
    table.string('remark', 500).comment('说明');

    // ---- 索引 ----
    table.unique(['setting_key'], { indexName: 'uk_setting_key' });

    table.comment('系统设置表（KV）');
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('t_class_setting');
};
