/**
 * 迁移脚本：创建宿舍主档 t_job_dorm
 *
 * 归属模块：就业管理 > 实训阶段（马志斌）
 * 字段依据：斌哥 2026-09-30 拍板「宿舍主档要建，本模块自建」
 *
 * ============================================================
 * 【为什么宿舍主档要建在这个模块】
 * ============================================================
 *   之前考虑过"复用教务的宿舍总名单"，但那样要跨模块等数据、跑不通。
 *   斌哥拍板：**本模块自建**（存在 sms_job 库），能独立跑通整条链路。
 *   将来如果教务也有宿舍总名单，再做数据同步/以一方为准。
 *
 * ============================================================
 * 【宿舍主档设计：一栋楼 → 一批房间 → 每房间 N 个床位】
 * ============================================================
 *   本表只存到【房间】这一级（楼栋 + 房间号 + 床位容量）。
 *   具体每个床位住谁 → 见 t_job_dorm_bed（一人一床）。
 *
 *   为什么床位要单独一张表？
 *     一张床是否被占用、住的是谁，要能**单独查、单独改**。
 *     塞进宿舍表里（比如 bed1_student_id / bed2_student_id...）没法扩展，
 *     4 人间就要 4 个字段，8 人间要 8 个，改布局还得改表结构。
 *
 * ⚠️ 铁律：逻辑删除，禁物理删除。
 * ⚠️ 铁律：表名 t_job_ 前缀；字段数据库用下划线。
 */

/**
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('t_job_dorm', (table) => {
    // ---- 主键与公共字段 ----
    table.string('id', 36).primary().comment('主键UUID');
    table.datetime('create_time').notNullable().comment('创建时间');
    table.string('create_by', 36).comment('创建人ID');
    table.datetime('update_time').comment('修改时间');
    table.string('update_by', 36).comment('修改人ID');
    table.boolean('is_deleted').notNullable().defaultTo(false).comment('逻辑删除');

    // ---- 宿舍标识 ----
    table.string('dorm_no', 20).notNullable().comment('宿舍编号，如 A-301（全局唯一）');
    table.string('building', 50).notNullable().comment('楼栋，如 A栋 / 男生公寓1号楼');
    table.string('room_no', 20).notNullable().comment('房间号，如 301');

    // ---- 容量与性别 ----
    table.integer('bed_count').notNullable().defaultTo(4).comment('床位总数（容量）');
    table.integer('used_count').notNullable().defaultTo(0)
      .comment('已住人数（冗余，改床位时同步维护，加速查询）');
    table.integer('dorm_gender').notNullable().defaultTo(0)
      .comment('宿舍性别限制 0不限 1男 2女');

    // ---- 部门归属（可选：某宿舍属于哪个部）----
    table.integer('dept_code').comment('所属部门码 1初高部 2大学部（可不填=通用）');

    // ---- 状态 ----
    table.integer('dorm_status').notNullable().defaultTo(1)
      .comment('宿舍状态 1正常 2停用（停用后不能再被选）');

    // ---- 设施/备注 ----
    table.string('facility', 200).comment('设施说明，如 独立卫浴/空调');
    table.string('remark', 500).comment('备注');

    // ---- 索引 ----
    table.unique(['dorm_no'], { indexName: 'uk_dorm_no' });
    table.index(['building'], 'idx_dorm_building');
    table.index(['dorm_status'], 'idx_dorm_status');
    table.index(['dept_code'], 'idx_dorm_dept');
    table.index(['is_deleted'], 'idx_dorm_is_deleted');

    table.comment('宿舍主档（就业管理-实训）');
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('t_job_dorm');
};
