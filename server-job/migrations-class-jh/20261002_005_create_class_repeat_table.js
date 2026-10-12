/**
 * 迁移：末班记录 t_class_repeat
 *
 * 说明：末班是「事件」而非学生状态；末班后学生仍为 5 正式在读，
 *      仅改 class_id/stage，并累计 repeat_count。
 *
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('t_class_repeat', (table) => {
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
    table.string('from_class_id', 36).comment('原班级ID');
    table.string('from_class_name', 50).comment('原班级名称');
    table.integer('from_stage').comment('原学习阶段');
    table.string('to_class_id', 36).notNullable().comment('转入班级ID（更低阶段）');
    table.string('to_class_name', 50).notNullable().comment('转入班级名称');
    table.integer('to_stage').comment('转入学习阶段');
    table.string('repeat_reason', 500).notNullable().comment('末班原因');
    table.datetime('repeat_time').notNullable().comment('末班时间');
    table.integer('repeat_count').notNullable().defaultTo(1).comment('累计次数（不设上限）');
    table.string('notify_user_id', 36).comment('被通知班主任ID');
    table.boolean('is_notified').defaultTo(false).comment('是否已通知');

    // ---- 索引 ----
    table.index(['student_id'], 'idx_student_id');
    table.index(['repeat_time'], 'idx_repeat_time');

    table.comment('末班记录表');
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('t_class_repeat');
};
