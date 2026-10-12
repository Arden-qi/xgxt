/**
 * 迁移：房间号唯一性由「全局唯一」改为「楼栋内唯一」
 *
 * 背景：原 uk_room_no 让 room_no 在整个学校范围内唯一，导致 A栋/B栋 不能都有「2-01」，
 *      与实际业务不符（房间号只需在同一栋楼内不重复）。
 *
 * 变更：uk_room_no(room_no)  →  uk_building_room_no(building_id, room_no)
 *
 * ⚠️ down() 必须「可回滚」：恢复全局唯一索引前要先判重——
 *    若数据里已存在跨楼栋同房间号（如 A栋/B栋 都有 2-01），直接加 uk_room_no 会失败，
 *    导致 migrate:rollback --all 中断、数据库复位失效（曾踩坑）。
 */

/** 判断索引是否存在 */
async function hasIndex(knex, table, indexName) {
  const res = await knex.raw(
    `SELECT COUNT(*) AS c FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?`,
    [table, indexName],
  );
  const rows = Array.isArray(res) ? res[0] : res;
  return Number(rows?.[0]?.c || 0) > 0;
}

/** 是否存在重复的 room_no（跨楼栋同名） */
async function hasDuplicateRoomNo(knex) {
  const dup = await knex('t_class_room').select('room_no').groupBy('room_no').havingRaw('COUNT(*) > 1').first();
  return !!dup;
}

/**
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  if (await hasIndex(knex, 't_class_room', 'uk_room_no')) {
    await knex.schema.alterTable('t_class_room', (table) => {
      table.dropUnique(['room_no'], 'uk_room_no');
    });
  }
  if (!(await hasIndex(knex, 't_class_room', 'uk_building_room_no'))) {
    await knex.schema.alterTable('t_class_room', (table) => {
      table.unique(['building_id', 'room_no'], { indexName: 'uk_building_room_no' });
    });
  }
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  if (await hasIndex(knex, 't_class_room', 'uk_building_room_no')) {
    await knex.schema.alterTable('t_class_room', (table) => {
      table.dropUnique(['building_id', 'room_no'], 'uk_building_room_no');
    });
  }
  // 仅当 room_no 全局无重复时才恢复「全局唯一」索引，否则回滚会因重复数据失败
  if (!(await hasIndex(knex, 't_class_room', 'uk_room_no')) && !(await hasDuplicateRoomNo(knex))) {
    await knex.schema.alterTable('t_class_room', (table) => {
      table.unique(['room_no'], { indexName: 'uk_room_no' });
    });
  }
};
