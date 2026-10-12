/**
 * 迁移脚本：创建班级主档表 t_job_class
 *
 * 归属模块：就业管理 > 实训阶段（马志斌）
 * 字段依据：docs/班级信息+出勤-字段定稿.md 第一节
 * 执行：npm run migrate
 *
 * 说明：全系统还没有独立的班级表。经斌哥确认（方案A），实训模块自建班级表，
 *      班级数据由实训模块自己维护。将来与 8003（班级管理）需做字段对齐。
 *
 * ⚠️ 铁律：不许直接连数据库改表结构，一切变更走脚本！
 */

/**
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('t_job_class', (table) => {
    // ---- 主键与公共字段（每张表都要有）----
    table.string('id', 36).primary().comment('主键UUID');
    table.datetime('create_time').notNullable().comment('创建时间');
    table.string('create_by', 36).comment('创建人ID');
    table.datetime('update_time').comment('修改时间');
    table.string('update_by', 36).comment('修改人ID');
    table.boolean('is_deleted').notNullable().defaultTo(false).comment('逻辑删除 false未删 true已删');

    // ---- 业务字段 ----
    table.string('class_name', 50).notNullable().comment('班级名称，如「实训一期1班」');
    table.string('class_code', 32).notNullable().comment('班级编号，如 SX2026001');
    table.integer('dept_code').notNullable().comment('部门 1初高部 2大学部');
    table.integer('stage').notNullable().comment('阶段 1一阶段 2二阶段 3三阶段');

    table.string('head_teacher_id', 36).notNullable().comment('班主任ID');
    table.string('head_teacher_name', 50).comment('班主任姓名（快照）');
    table.string('teacher_id', 36).comment('教员ID');
    table.string('teacher_name', 50).comment('教员姓名（快照）');
    table.string('assistant_id', 36).comment('助教ID');
    table.string('assistant_name', 50).comment('助教姓名（快照）');

    table.string('classroom', 50).comment('教室地点，如「3号楼201」');
    table.date('open_date').notNullable().comment('开班日期');
    table.date('close_date').comment('结业日期，状态改「已结业」时必填');

    table.integer('student_count').notNullable().defaultTo(0)
      .comment('班级人数，由花名册在班人数实时统计，不手填');

    table.integer('class_status').notNullable().defaultTo(1)
      .comment('班级状态 1开放 2封班（只接受休学/末次班学生转入）3待结业 4已结业');

    table.decimal('attendance_rate', 5, 2).comment('班级累计出勤率（%），由出勤记录算出');

    table.string('remark', 500).comment('备注');

    // ---- 索引 ----
    table.unique(['class_code'], { indexName: 'uk_class_code' });
    table.index(['class_status'], 'idx_class_status');
    table.index(['head_teacher_id'], 'idx_class_head_teacher');
    table.index(['dept_code', 'stage'], 'idx_class_dept_stage');
    table.index(['is_deleted'], 'idx_class_is_deleted');

    table.comment('班级主档表（就业管理-实训）');
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('t_job_class');
};
