/**
 * 迁移：房间 t_class_room
 *
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('t_class_room', (table) => {
    // ---- 公共字段 ----
    table.string('id', 36).primary().comment('主键UUID');
    table.datetime('create_time').notNullable().comment('创建时间');
    table.string('create_by', 36).comment('创建人ID');
    table.datetime('update_time').comment('修改时间');
    table.string('update_by', 36).comment('修改人ID');
    table.boolean('is_deleted').notNullable().defaultTo(false).comment('逻辑删除');

    // ---- 业务字段 ----
    table.string('building_id', 36).notNullable().comment('楼栋ID');
    table.string('building_name', 50).notNullable().comment('楼栋名称');
    table.integer('floor_no').comment('楼层');
    table.string('room_no', 50).notNullable().comment('房间号 3-201');
    table.integer('dorm_type').notNullable().comment('宿舍类型 1男寝 2女寝');
    table.integer('bed_count').notNullable().defaultTo(0).comment('床位数');
    table.integer('occupied_count').defaultTo(0).comment('已入住（动态）');
    table.decimal('occupancy_rate', 5, 2).comment('入住率');
    table.string('owner_name', 50).comment('负责人');
    table.string('data_source', 50).comment('数据来源');
    table.string('room_status', 20).defaultTo('使用中').comment('状态 使用中/空置/维修/停用');
    table.string('class_id', 36).comment('所属班级ID（混班留空）');
    table.string('class_name', 50).comment('所属班级名称');

    // ---- 索引 ----
    table.unique(['room_no'], { indexName: 'uk_room_no' });
    table.index(['building_id'], 'idx_building_id');
    table.index(['dorm_type'], 'idx_dorm_type');

    table.comment('宿舍房间表');
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('t_class_room');
};
