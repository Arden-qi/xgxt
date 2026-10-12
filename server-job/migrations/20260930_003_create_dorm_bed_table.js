/**
 * 迁移脚本：创建床位表 t_job_dorm_bed
 *
 * 归属模块：就业管理 > 实训阶段（马志斌）
 *
 * ============================================================
 * 【床位表干什么用】
 * ============================================================
 *   一人一床。这张表记录"哪个床位住着哪个学生"。
 *
 *   为什么不让 t_student_base.dorm_id 直接指向宿舍？
 *     因为一间宿舍住 4 个人，一个 dorm_id 没法表达"住哪个床位"。
 *     本表把【宿舍】拆到【床位】粒度：
 *       宿舍(A-301) ──► 床位(A-301-1 / A-301-2 / A-301-3 / A-301-4)
 *                       每个床位最多住 1 人
 *
 *   关系：
 *     t_student_base.dorm_id / dorm_no  = 学生"现在住哪"
 *     t_job_dorm_bed.student_id         = 床位"住的是谁"
 *   两张表靠 student_id 对应，改床位时两边一起改（同一事务）。
 *
 * ============================================================
 * 【占用状态】
 * ============================================================
 *   1 空闲  —— 没人住，可分配
 *   2 已占用 —— 有 student_id
 *   3 停用  —— 床坏了/不启用，不可分配
 *
 * ⚠️ 铁律：逻辑删除，禁物理删除。
 */

/**
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('t_job_dorm_bed', (table) => {
    // ---- 主键与公共字段 ----
    table.string('id', 36).primary().comment('主键UUID');
    table.datetime('create_time').notNullable().comment('创建时间');
    table.string('create_by', 36).comment('创建人ID');
    table.datetime('update_time').comment('修改时间');
    table.string('update_by', 36).comment('修改人ID');
    table.boolean('is_deleted').notNullable().defaultTo(false).comment('逻辑删除');

    // ---- 归属宿舍 ----
    table.string('dorm_id', 36).notNullable().comment('所属宿舍ID');
    table.string('dorm_no', 20).notNullable().comment('宿舍编号（快照，方便查询）');
    table.integer('bed_no').notNullable().comment('床位号，如 1 / 2 / 3 / 4');

    // ---- 占用情况 ----
    table.integer('bed_status').notNullable().defaultTo(1)
      .comment('床位状态 1空闲 2已占用 3停用');

    // 住的学生（占用时必填，空闲时为 null）
    table.string('student_id', 36).comment('入住学生ID（空闲为 null）');
    table.string('student_no', 32).comment('学号（快照）');
    table.string('student_name', 50).comment('姓名（快照）');
    table.integer('student_gender').comment('学生性别 1男 2女（快照）');

    // ---- 入住信息 ----
    table.date('check_in_date').comment('入住日期');
    table.string('remark', 500).comment('备注');

    // ---- 索引 ----
    table.index(['dorm_id'], 'idx_bed_dorm');
    table.index(['dorm_no'], 'idx_bed_dorm_no');
    table.index(['bed_status'], 'idx_bed_status');
    table.index(['student_id'], 'idx_bed_student');
    table.index(['is_deleted'], 'idx_bed_is_deleted');
    // 同一宿舍内床位号不重复
    table.unique(['dorm_id', 'bed_no'], { indexName: 'uk_bed_dorm_bedno' });

    table.comment('宿舍床位表（就业管理-实训）');
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('t_job_dorm_bed');
};
