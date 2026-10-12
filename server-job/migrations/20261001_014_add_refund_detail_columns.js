/**
 * 迁移脚本：t_job_refund 增加「退学退费」三项明细金额
 *
 * 归属模块：就业管理 > 实训阶段（马志斌）
 * 背景：斌哥 2026-10-01 拍板 ——「退学审批通过后自动生成退费单，
 *       **合并成一张**，但三种费用（学费/住宿费/餐费）分别多少钱要能看出来」
 *
 * ============================================================
 * 【为什么加在主表，不建明细子表】
 * ============================================================
 *   全项目的单据都是"扁平字段"风格，加 3 个可空列最省事、也能直接统计
 *   （比如"这个月退了多少学费"直接 SUM(tuition_amount)）。
 *   只有「退学退费」这种合并单会填这 3 列，其余单子留空 —— 不冲突。
 *
 * ============================================================
 * 【金额一律用「分」】
 * ============================================================
 *   refund_amount（总金额）恒等于三者之和：
 *     学费 + 住宿费 + 餐费
 *   ⚠️ 生成时三个明细都是 0（系统拿不到缴费数据），由班主任核对后填写。
 *
 * ⚠️ 铁律：不许直接连数据库改表结构，一切变更走脚本！
 * ⚠️ 幂等：列已存在就直接跳过
 */

/**
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  const has = await knex.schema.hasColumn('t_job_refund', 'tuition_amount');
  if (has) {
    console.log('[014] t_job_refund 明细列已存在，跳过');
    return;
  }

  await knex.schema.alterTable('t_job_refund', (table) => {
    table
      .bigint('tuition_amount')
      .comment('学费退费金额（分）—— 仅「退学退费」合并单使用');
    table
      .bigint('accommodation_amount')
      .comment('住宿费退费金额（分）—— 仅「退学退费」合并单使用');
    table
      .bigint('meal_amount')
      .comment('餐费退费金额（分）—— 仅「退学退费」合并单使用');
  });

  console.log('[014] 已为 t_job_refund 增加三个明细金额列');
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  const has = await knex.schema.hasColumn('t_job_refund', 'tuition_amount');
  if (!has) return;

  await knex.schema.alterTable('t_job_refund', (table) => {
    table.dropColumn('tuition_amount');
    table.dropColumn('accommodation_amount');
    table.dropColumn('meal_amount');
  });
};
