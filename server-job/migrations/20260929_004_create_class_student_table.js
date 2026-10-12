/**
 * 迁移脚本：创建班级花名册表 t_job_class_student
 *
 * 归属模块：就业管理 > 实训阶段（马志斌）
 * 字段依据：docs/班级信息+出勤-字段定稿.md 第二节
 * 执行：npm run migrate
 *
 * 设计要点：
 *   学生换班后，旧记录【要留着】（改成 status=2已离班），这样能查完整履历。
 *   唯一索引带 status：允许「同一学生先后两次进同一个班」，
 *   但不允许「同时两次都在班」（因为 status=1 的那条唯一）。
 *
 * ⚠️ 铁律：不许直接连数据库改表结构，一切变更走脚本！
 */

/**
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('t_job_class_student', (table) => {
    // ---- 主键与公共字段 ----
    table.string('id', 36).primary().comment('主键UUID');
    table.datetime('create_time').notNullable().comment('创建时间');
    table.string('create_by', 36).comment('创建人ID');
    table.datetime('update_time').comment('修改时间');
    table.string('update_by', 36).comment('修改人ID');
    table.boolean('is_deleted').notNullable().defaultTo(false).comment('逻辑删除');

    // ---- 业务字段 ----
    table.string('class_id', 36).notNullable().comment('班级ID');
    table.string('class_name', 50).comment('班级名称（快照）');
    table.string('student_id', 36).notNullable().comment('学生ID');
    table.string('student_no', 32).comment('学号（快照）');
    table.string('student_name', 50).comment('姓名（快照）');

    table.date('join_date').notNullable().comment('入班日期');
    table.integer('join_type').notNullable().defaultTo(1)
      .comment('入班方式 1新生入班 2换班转入 3末班转入 4休学复学');

    table.date('leave_date').comment('离班日期，状态改「已离班」时必填');
    table.integer('leave_type').comment('离班方式 1换班转出 2末班转出 3休学 4退学 5结业');
    table.string('leave_reason', 200).comment('离班原因');

    table.integer('status').notNullable().defaultTo(1).comment('在班状态 1在班 2已离班');
    table.string('remark', 200).comment('备注');

    // ---- 索引 ----
    // 同一学生在同一个班，只允许有一条「在班」记录
    table.unique(['class_id', 'student_id', 'status'], { indexName: 'uk_cs_class_student_status' });
    table.index(['class_id'], 'idx_cs_class_id');
    table.index(['student_id'], 'idx_cs_student_id');
    table.index(['status'], 'idx_cs_status');
    table.index(['is_deleted'], 'idx_cs_is_deleted');

    table.comment('班级花名册表（就业管理-实训）');
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('t_job_class_student');
};
