/**
 * 迁移脚本：创建班级 ↔ 宿舍分派表
 *
 * 需求：宿舍管理新增「分派宿舍」子页面，给不同班级分派已有宿舍，
 *       一个班级可以分到多间宿舍。
 *
 * 表设计要点：
 *   1. 一张关系表 t_dorm_assignment：一行 = 「某班级 分到 某间宿舍」。
 *      一间宿舍同时只能归属一个班，所以 room_id 上加了唯一约束；
 *      但因为本项目统一用 is_deleted 软删除，唯一键会把「删掉的行」也算进去，
 *      所以重复校验放在应用层做（见 dorm.route.ts /assign）。
 *   2. building / room / category 冗余一份快照：列表展示不必每次 join，
 *      宿舍改名时由应用层同步更新（见 PUT /room/info）。
 *   3. 床位数 / 入住人数【不落库】，查询时按 t_dorm_room.capacity
 *      和 t_dorm_bed 现算，避免出现「额定改了但分派页数字没变」。
 */

const TABLE = 't_dorm_assignment';

const COMMON = (table) => {
  table.string('id', 36).primary().comment('主键UUID');
  table.datetime('create_time').notNullable().comment('创建时间');
  table.string('create_by', 36).comment('创建人ID');
  table.datetime('update_time').comment('修改时间');
  table.string('update_by', 36).comment('修改人ID');
  table.boolean('is_deleted').notNullable().defaultTo(false).comment('逻辑删除');
};

/**
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable(TABLE, (table) => {
    COMMON(table);

    // ===== 业务字段 =====
    table.string('class_name', 50).notNullable().comment('班级');
    table.string('head_teacher_name', 50).comment('班主任');
    table.string('room_id', 36).notNullable().comment('宿舍ID → t_dorm_room.id');

    // 冗余快照（展示用）
    table.string('building', 20).comment('宿舍楼');
    table.string('room', 20).comment('宿舍号');
    table.integer('category').comment('宿舍类别：1=男寝 2=女寝');

    table.string('remark', 200).comment('备注');

    // ===== 索引 =====
    table.index(['is_deleted', 'class_name'], 'idx_assign_class');
    table.index(['is_deleted', 'room_id'], 'idx_assign_room');
    table.unique(['room_id'], { indexName: 'uk_assign_room' });
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists(TABLE);
};
