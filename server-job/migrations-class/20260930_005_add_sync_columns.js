/**
 * 迁移 005：补齐「同步溯源」列
 * 负责人：学管模块（班级管理 8003）
 * 数据库：sms_class
 *
 * 背景：四条对接接口（学生 / 催费 / 缴费 / 宿舍）都按 (source_system + source_id) 幂等，
 *      并且需要留「批次号」以便对账追溯。
 *      - t_class_student 建表时已有 source_system/source_id，缺批次号
 *      - t_class_upgrade_apply 建表时是按「本模块发起」设计的，缺同步来源三列
 *
 * ⚠️ 纯新增列 + 索引，不改任何已有列类型，可安全在线执行。
 */

exports.up = async function up(knex) {
  // 学生表：补上游批次号
  await knex.schema.alterTable('t_class_student', (t) => {
    t.string('source_batch_no', 40).comment('上游同步批次号');
  });

  // 升学申请表：补同步来源（供 /api/class/student/upgrade/sync 幂等与追溯）
  await knex.schema.alterTable('t_class_upgrade_apply', (t) => {
    t.string('source_system', 20).comment('同步来源系统 edu/consult；本模块发起时为空');
    t.string('source_id', 64).comment('上游主键（幂等键）');
    t.index(['source_system', 'source_id'], 'idx_ua_source');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('t_class_upgrade_apply', (t) => {
    t.dropIndex(['source_system', 'source_id'], 'idx_ua_source');
    t.dropColumn('source_id');
    t.dropColumn('source_system');
  });
  await knex.schema.alterTable('t_class_student', (t) => {
    t.dropColumn('source_batch_no');
  });
};
