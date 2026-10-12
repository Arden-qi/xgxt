/**
 * 迁移：床位号从「数字」改成「上/下铺」格式
 *
 * ============================================================
 * 【为什么要改】（斌哥 2026-10-01）
 * ============================================================
 *   宿舍是**上下铺**，所以床位号不能只写 1/2/3/4 ——
 *   要能看出"这个人是上铺还是下铺"。
 *
 *   新格式：4 人间 = 1上 / 1下 / 2上 / 2下
 *   规则：**奇数序号 = 上铺，偶数序号 = 下铺**；同一编号共用一个床架
 *
 * ============================================================
 * 【改哪些】
 * ============================================================
 *   t_job_dorm_bed.bed_no            int → varchar(10)   1 → '1上'、2 → '1下' …
 *   t_job_dorm_change.old_bed_no     int → varchar(10)   （调换/退宿的旧床位快照）
 *   t_job_dorm_change.new_bed_no     int → varchar(10)   （调换的新床位快照）
 *
 *   ⚠️ t_job_dorm_bed 上有唯一索引 `uk_bed_dorm_bedno (dorm_id, bed_no)`，
 *      改类型前必须先删、改完再重建。
 *
 * ============================================================
 * 【幂等保护】
 * ============================================================
 *   本迁移会先查 bed_no 的当前类型 —— 已经是 varchar 就跳过，
 *   避免中途失败后重跑炸掉。
 *
 * ⚠️ 铁律：不许直接连数据库改表结构，一切变更走脚本！
 */

/**
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  /* ---------------- ① t_job_dorm_bed.bed_no ---------------- */
  const [bedCol] = await knex.raw(
    `SELECT DATA_TYPE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_job_dorm_bed' AND COLUMN_NAME = 'bed_no'`,
  );
  const bedIsInt = String(bedCol?.[0]?.DATA_TYPE || '').toLowerCase() === 'int';

  if (bedIsInt) {
    // 加临时列 → 回填「上/下」 → 删旧列 → 改名 → 重建唯一索引
    await knex.raw(
      `ALTER TABLE t_job_dorm_bed
       ADD COLUMN bed_no_new VARCHAR(10) NULL COMMENT '床位号，如 1上 / 1下 / 2上 / 2下'`,
    );
    await knex.raw(
      `UPDATE t_job_dorm_bed
       SET bed_no_new = CONCAT(CEIL(bed_no / 2), IF(bed_no % 2 = 1, '上', '下'))`,
    );
    await knex.raw('ALTER TABLE t_job_dorm_bed DROP INDEX uk_bed_dorm_bedno');
    await knex.raw('ALTER TABLE t_job_dorm_bed DROP COLUMN bed_no');
    await knex.raw(
      `ALTER TABLE t_job_dorm_bed
       CHANGE bed_no_new bed_no VARCHAR(10) NOT NULL COMMENT '床位号，如 1上 / 1下 / 2上 / 2下'`,
    );
    await knex.raw(
      'ALTER TABLE t_job_dorm_bed ADD UNIQUE KEY uk_bed_dorm_bedno (dorm_id, bed_no)',
    );
    console.log('  ✔ t_job_dorm_bed.bed_no → varchar（1上/1下/…），唯一索引已重建');
  } else {
    console.log('  ⏭ t_job_dorm_bed.bed_no 已是 varchar，跳过');
  }

  /* ------------- ② t_job_dorm_change 的两个快照列 ------------- */
  const [chgCols] = await knex.raw(
    `SELECT COLUMN_NAME, DATA_TYPE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_job_dorm_change'
       AND COLUMN_NAME IN ('old_bed_no', 'new_bed_no')`,
  );
  for (const col of chgCols) {
    if (String(col.DATA_TYPE || '').toLowerCase() !== 'int') {
      console.log(`  ⏭ t_job_dorm_change.${col.COLUMN_NAME} 已是 varchar，跳过`);
      continue;
    }
    const c = col.COLUMN_NAME;
    // 先改类型（1 → '1'），再按规则补「上/下」
    await knex.raw(`ALTER TABLE t_job_dorm_change MODIFY ${c} VARCHAR(10) NULL`);
    await knex.raw(
      `UPDATE t_job_dorm_change
       SET ${c} = CONCAT(CEIL(${c} / 2), IF(${c} % 2 = 1, '上', '下'))
       WHERE ${c} IS NOT NULL`,
    );
    console.log(`  ✔ t_job_dorm_change.${c} → varchar（上/下）`);
  }
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  // 回滚：把「1上/1下」还原成数字（取编号部分）
  await knex.raw(
    `ALTER TABLE t_job_dorm_bed
     MODIFY bed_no VARCHAR(10) NULL`,
  );
  await knex.raw(
    `UPDATE t_job_dorm_bed SET bed_no = LEFT(bed_no, CHAR_LENGTH(bed_no) - 1)`,
  );
  await knex.raw('ALTER TABLE t_job_dorm_bed MODIFY bed_no INT NULL');
  console.log('  ↩ 已回滚（仅还原了类型与编号，上/下信息丢失）');
};
