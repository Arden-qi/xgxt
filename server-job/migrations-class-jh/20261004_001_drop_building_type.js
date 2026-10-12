/**
 * 迁移：删除楼栋「类型（男/女/混宿）」字段
 *
 * 背景：楼栋不分男女——性别只体现在「房间」上（t_class_room.dorm_type）。
 *      t_class_building.building_type 语义与现状冲突，按产品口径彻底移除。
 *
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  const has = await knex.schema.hasColumn('t_class_building', 'building_type');
  if (!has) return;
  await knex.schema.alterTable('t_class_building', (table) => {
    table.dropColumn('building_type');
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  const has = await knex.schema.hasColumn('t_class_building', 'building_type');
  if (has) return;
  await knex.schema.alterTable('t_class_building', (table) => {
    table.string('building_type', 20).comment('楼栋类型 男/女/混宿');
  });
};
