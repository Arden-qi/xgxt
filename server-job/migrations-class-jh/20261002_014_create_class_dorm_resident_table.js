/**
 * 迁移：宿舍入住 t_class_dorm_resident
 *
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('t_class_dorm_resident', (table) => {
    // ---- 公共字段 ----
    table.string('id', 36).primary().comment('主键UUID');
    table.datetime('create_time').notNullable().comment('创建时间');
    table.string('create_by', 36).comment('创建人ID');
    table.datetime('update_time').comment('修改时间');
    table.string('update_by', 36).comment('修改人ID');
    table.boolean('is_deleted').notNullable().defaultTo(false).comment('逻辑删除');

    // ---- 业务字段 ----
    table.string('student_id', 36).notNullable().comment('学生ID');
    table.string('student_no', 32).notNullable().comment('学号');
    table.string('student_name', 50).notNullable().comment('学生姓名');
    table.string('class_id', 36).comment('班级ID');
    table.string('class_name', 50).comment('班级名称');
    table.integer('gender').comment('性别');
    table.string('building_id', 36).notNullable().comment('楼栋ID');
    table.string('room_id', 36).notNullable().comment('房间ID');
    table.string('room_no', 50).notNullable().comment('房间号');
    table.string('bed_id', 36).notNullable().comment('床位ID');
    table.string('bed_no', 20).notNullable().comment('床位号');
    table.date('check_in_date').notNullable().comment('入住时间');
    table.string('owner_name', 50).comment('房间负责人');
    table.boolean('is_active').notNullable().defaultTo(true).comment('是否在住');

    // ---- 索引 ----
    table.index(['student_id'], 'idx_student_id');
    table.index(['room_id'], 'idx_room_id');
    table.index(['is_active'], 'idx_is_active');

    table.comment('宿舍入住表');
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('t_class_dorm_resident');
};
