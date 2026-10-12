/**
 * 迁移：床位 t_class_bed
 *
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('t_class_bed', (table) => {
    // ---- 公共字段 ----
    table.string('id', 36).primary().comment('主键UUID');
    table.datetime('create_time').notNullable().comment('创建时间');
    table.string('create_by', 36).comment('创建人ID');
    table.datetime('update_time').comment('修改时间');
    table.string('update_by', 36).comment('修改人ID');
    table.boolean('is_deleted').notNullable().defaultTo(false).comment('逻辑删除');

    // ---- 业务字段 ----
    table.string('room_id', 36).notNullable().comment('房间ID');
    table.string('room_no', 50).notNullable().comment('房间号');
    table.string('building_id', 36).notNullable().comment('楼栋ID');
    table.string('bed_no', 20).notNullable().comment('床位号');
    table.integer('dorm_type').comment('宿舍类型 1男寝 2女寝');
    table.string('bed_status', 20).defaultTo('空闲').comment('床位状态 空闲/已占用/维修');
    table.string('student_id', 36).comment('当前占用学生ID');

    // ---- 索引 ----
    table.unique(['room_id', 'bed_no'], { indexName: 'uk_room_bed' });
    table.index(['room_id'], 'idx_room_id');
    table.index(['student_id'], 'idx_student_id');

    table.comment('宿舍床位表');
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('t_class_bed');
};
