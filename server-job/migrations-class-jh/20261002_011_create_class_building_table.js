/**
 * 迁移：楼栋（镜像）t_class_building
 *
 * 说明：宿舍总账在教务（8002）；本模块建镜像表 + 查询/分派，仅种子数据留痕。
 *
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('t_class_building', (table) => {
    // ---- 公共字段 ----
    table.string('id', 36).primary().comment('主键UUID');
    table.datetime('create_time').notNullable().comment('创建时间');
    table.string('create_by', 36).comment('创建人ID');
    table.datetime('update_time').comment('修改时间');
    table.string('update_by', 36).comment('修改人ID');
    table.boolean('is_deleted').notNullable().defaultTo(false).comment('逻辑删除');

    // ---- 业务字段 ----
    table.string('building_name', 50).notNullable().comment('楼栋名称');
    table.string('building_type', 20).comment('楼栋类型 男/女/混宿');
    table.string('campus_name', 50).comment('所属校区');
    table.integer('floor_count').comment('楼层数');
    table.string('manager_name', 50).comment('楼管姓名');
    table.string('manager_phone', 20).comment('楼管电话');
    table.string('dept_name', 50).comment('对接部门');
    table.string('building_status', 20).defaultTo('使用中').comment('状态 使用中/停用');
    table.string('data_source', 50).comment('数据来源');

    // ---- 索引 ----
    table.unique(['building_name'], { indexName: 'uk_building_name' });

    table.comment('宿舍楼栋表（镜像）');
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('t_class_building');
};
