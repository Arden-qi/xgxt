/**
 * 迁移脚本：升实训交接（大学 8003 → 我们 8004）
 *
 * 归属：大学模块衔接（2026-10-04）
 * 数据库：sms_job
 *
 * ============================================================
 * 【背景】
 * ============================================================
 *   大学部班级在「班级管理」(8003) 里读完第六阶段（206）后，学管点「升实训」，
 *   会把班级 + 班内学员交接到实训模块（就是这个包）。
 *
 *   8003 那边已经做了一半：写好交接单 `t_class_training_handoff`（handoff_status=1 已交接），
 *   但**没有通知我们**，交接单里也只存了 student_ids（没有学生详情）。
 *
 *   所以我们在自己这边落一条副本：记录收到什么、处理结果如何，
 *   既做幂等（同一个 handoff_no 不重复处理），也做留痕（出问题能查）。
 *
 * ============================================================
 * 【本次改两件事】
 * ============================================================
 *   1. 新建 t_job_training_handoff —— 交接单副本（含逐条处理结果）
 *   2. t_student_base 加 id_card 列 —— 班级那边的学生档案有身份证，
 *      升实训要「全带」，我们这边原来没这列
 *
 * ⚠️ 只加表 / 加列，不动任何现有数据
 */

function base(t) {
  t.string('id', 36).primary().comment('主键UUID');
  t.datetime('create_time').notNullable().comment('创建时间');
  t.string('create_by', 36).comment('创建人ID');
  t.datetime('update_time').comment('最后修改时间');
  t.string('update_by', 36).comment('最后修改人ID');
  t.boolean('is_deleted').notNullable().defaultTo(false).comment('逻辑删除标记');
}

exports.up = async function up(knex) {
  // ---------- 1. 升实训交接单副本 ----------
  const hasTable = await knex.schema.hasTable('t_job_training_handoff');
  if (!hasTable) {
    await knex.schema.createTable('t_job_training_handoff', (t) => {
      base(t);

      t.string('handoff_no', 40).notNullable().comment('来源交接单号（8003 的 STyyyymmddNNN）');
      t.string('source_system', 20).notNullable().defaultTo('class')
        .comment('来源系统 class=班级管理8003');
      t.string('source_class_id', 36).comment('来源班级ID（8003 的）');
      t.string('source_class_name', 50).comment('来源班级名称');
      t.integer('source_stage').comment('来源阶段值（8003 是 201~206）');
      t.string('source_head_teacher_id', 36).comment('来源班主任ID');
      t.string('source_head_teacher_name', 50).comment('来源班主任姓名');

      t.string('target_class_id', 36).comment('我们这边建的实训班级ID');
      t.string('target_class_name', 50).comment('实训班级名称');

      t.integer('student_count').notNullable().defaultTo(0).comment('交接学员数');
      t.text('student_nos').comment('学员学号列表(JSON)');

      // 1已接收 2部分失败 3已回执
      t.integer('receive_status').notNullable().defaultTo(1)
        .comment('接收状态 1已接收 2部分失败 3已回执');
      t.text('result_json').comment('逐条处理结果(JSON)：成功/跳过/失败原因');
      t.datetime('receive_time').comment('接收时间');
      t.string('operator_id', 36).comment('处理人ID（推送时为空=系统）');
      t.string('operator_name', 50).comment('处理人姓名');
      t.string('remark', 500).comment('备注');

      t.unique(['handoff_no'], { indexName: 'uk_handoff_no' });
      t.index(['source_class_id'], 'idx_th_source_class');
      t.index(['receive_time'], 'idx_th_receive_time');
      t.comment('升实训交接单副本（大学 8003 → 实训 8004）');
    });
    console.log('[ok] 建表 t_job_training_handoff');
  } else {
    console.log('[skip] t_job_training_handoff 已存在');
  }

  // ---------- 2. 学生表加身份证列 ----------
  const hasCol = await knex.schema.hasColumn('t_student_base', 'id_card');
  if (!hasCol) {
    await knex.schema.alterTable('t_student_base', (t) => {
      t.string('id_card', 32).comment('身份证号（大学升实训时随档案带过来）');
    });
    console.log('[ok] t_student_base.id_card');
  } else {
    console.log('[skip] t_student_base.id_card 已存在');
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('t_job_training_handoff');
  if (await knex.schema.hasColumn('t_student_base', 'id_card')) {
    await knex.schema.alterTable('t_student_base', (t) => t.dropColumn('id_card'));
  }
};
