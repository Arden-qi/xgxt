/**
 * 迁移：统一表「新环境回填」时挡路的 6 处结构（sms_common）
 * ============================================================
 * ★ 2026-10-22：本机从 origin/main 合并后，教学域默认读统一表（`t_uni_*`），
 *   但本机统一表本来是空的。用 `scripts/uni-migrate.ts` 回填时，9 张表卡住，
 *   归纳下来只有 4 类原因，后 3 类由本迁移解决（床位号那一类是一列类型）：
 *
 *   ① `t_uni_student.bed_no` 是 **int**，但初高老表的床位号是 `T008` 这种「字母+数字」
 *      → `Data truncated for column 'bed_no'`，98 个学生整体搬不进去。
 *      改回 varchar(20)（与初高老表 `sms_class_jh.t_class_student.bed_no` 一致）。
 *      ⚠️ 大学/就业的床位号本来就是纯数字，存成字符串后 `Number('3') === 3` 仍然成立，
 *         `class/modules/dorm/dorm.route.ts` 里那几处 `Number(o.bed_no)` 不受影响。
 *
 *   ② 四张统一表有 NOT NULL 且**无默认值**的列，老表压根没有这些列
 *      → `Field 'xxx' doesn't have a default value`。补默认值（不改可空性）：
 *        t_uni_fee.call_status             int          DEFAULT 0
 *        t_uni_dorm_building.bed_total     int          DEFAULT 0
 *        t_uni_dorm_room.building          varchar(50)  DEFAULT ''
 *        t_uni_dorm_bed.dorm_id            varchar(36)  DEFAULT ''
 *
 *   ③ 两个「多余的唯一索引」把本来允许重复的数据挡住
 *      → `Duplicate entry 'jh' for key 'uk_approval'` / `'一阶段-jh'` for `uk_stage_def`
 *        · t_uni_approval.uk_approval(apply_no, edu_stage)：
 *          老数据里大量单据 `apply_no` 是空串 → 同一学段只能有 1 条空串
 *        · t_uni_stage_def.uk_stage_def(stage_name, edu_stage)：
 *          初高不同阶段方案下可以同名（两个方案都有「一阶段」）
 *      按项目惯例（第 4 期第 5/6 批已多次这么做，见 `20261016_*_drop_unique_index`）
 *      降级成普通索引：保留查询性能，去掉唯一约束。
 *
 * 【幂等】
 *   每一步都先查 `information_schema`，已经是对的状态就跳过；`down` 反向还原。
 */

const DB = 'sms_common';

/** 某列当前的 COLUMN_TYPE（不存在返回 null） */
async function colType(knex, table, column) {
  const [rows] = await knex.raw(
    `select COLUMN_TYPE t from information_schema.COLUMNS
      where TABLE_SCHEMA=? and TABLE_NAME=? and COLUMN_NAME=? limit 1`,
    [DB, table, column],
  );
  return rows.length ? String(rows[0].t) : null;
}

/** 某索引是否存在（存在则返回是否唯一） */
async function indexInfo(knex, table, index) {
  const [rows] = await knex.raw(
    `select NON_UNIQUE nu from information_schema.STATISTICS
      where TABLE_SCHEMA=? and TABLE_NAME=? and INDEX_NAME=? limit 1`,
    [DB, table, index],
  );
  return rows.length ? Number(rows[0].nu) === 0 : null;
}

/**
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  const has = (t) => knex.schema.hasTable(t);

  /* ① 床位号：int → varchar(20)，保住初高的 T008 */
  if (await has('t_uni_student')) {
    const t = await colType(knex, 't_uni_student', 'bed_no');
    if (t && !/char|text/i.test(t)) {
      await knex.raw(
        `alter table \`${DB}\`.\`t_uni_student\`
           modify column \`bed_no\` varchar(20) default NULL comment '床位号（大学/就业为数字，初高为 T008 这类编号）'`,
      );
    }
  }

  /* ② 四列补默认值（只补默认值，不动 NOT NULL） */
  const defaults = [
    ['t_uni_fee', 'call_status', "int NOT NULL DEFAULT 0 COMMENT '催收进度（就业部用，其他学段恒 0）'"],
    ['t_uni_dorm_building', 'bed_total', "int NOT NULL DEFAULT 0 COMMENT '床位数合计'"],
    ['t_uni_dorm_room', 'building', "varchar(50) NOT NULL DEFAULT '' COMMENT '所属楼栋'"],
    ['t_uni_dorm_bed', 'dorm_id', "varchar(36) NOT NULL DEFAULT '' COMMENT '所属宿舍ID'"],
  ];
  for (const [table, column, def] of defaults) {
    if (!(await has(table))) continue;
    const t = await colType(knex, table, column);
    if (!t) continue;
    const [rows] = await knex.raw(
      `select COLUMN_DEFAULT d from information_schema.COLUMNS
        where TABLE_SCHEMA=? and TABLE_NAME=? and COLUMN_NAME=? limit 1`,
      [DB, table, column],
    );
    if (rows.length && rows[0].d !== null) continue; // 已有默认值
    await knex.raw(`alter table \`${DB}\`.\`${table}\` modify column \`${column}\` ${def}`);
  }

  /* ③ 两个唯一索引降级成普通索引 */
  const idxDowngrade = [
    ['t_uni_approval', 'uk_approval', 'idx_approval_no', 'apply_no, edu_stage'],
    ['t_uni_stage_def', 'uk_stage_def', 'idx_stage_def_name', 'stage_name, edu_stage'],
  ];
  for (const [table, ukName, idxName, cols] of idxDowngrade) {
    if (!(await has(table))) continue;
    const unique = await indexInfo(knex, table, ukName);
    if (unique !== null) {
      await knex.raw(`alter table \`${DB}\`.\`${table}\` drop index \`${ukName}\``);
    }
    const hasPlain = await indexInfo(knex, table, idxName);
    if (hasPlain === null) {
      await knex.raw(`alter table \`${DB}\`.\`${table}\` add index \`${idxName}\` (${cols})`);
    }
  }
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  const has = (t) => knex.schema.hasTable(t);

  /* ③ 反向：普通索引换回唯一索引 */
  const idxRestore = [
    ['t_uni_approval', 'idx_approval_no', 'uk_approval', 'apply_no, edu_stage'],
    ['t_uni_stage_def', 'idx_stage_def_name', 'uk_stage_def', 'stage_name, edu_stage'],
  ];
  for (const [table, idxName, ukName, cols] of idxRestore) {
    if (!(await has(table))) continue;
    if ((await indexInfo(knex, table, idxName)) !== null) {
      await knex.raw(`alter table \`${DB}\`.\`${table}\` drop index \`${idxName}\``);
    }
    if ((await indexInfo(knex, table, ukName)) === null) {
      await knex.raw(`alter table \`${DB}\`.\`${table}\` add unique index \`${ukName}\` (${cols})`);
    }
  }

  /* ② 反向：撤掉默认值（保持 NOT NULL） */
  const undefaults = [
    ['t_uni_fee', 'call_status', "int NOT NULL COMMENT '催收进度'"],
    ['t_uni_dorm_building', 'bed_total', "int NOT NULL COMMENT '床位数合计'"],
    ['t_uni_dorm_room', 'building', "varchar(50) NOT NULL COMMENT '所属楼栋'"],
    ['t_uni_dorm_bed', 'dorm_id', "varchar(36) NOT NULL COMMENT '所属宿舍ID'"],
  ];
  for (const [table, column, def] of undefaults) {
    if (!(await has(table))) continue;
    if (!(await colType(knex, table, column))) continue;
    await knex.raw(`alter table \`${DB}\`.\`${table}\` modify column \`${column}\` ${def}`);
  }

  /* ① 反向：床位号改回 int（有非数字值时会被截断，回滚前需人工清理） */
  if (await has('t_uni_student')) {
    const t = await colType(knex, 't_uni_student', 'bed_no');
    if (t && /char|text/i.test(t)) {
      await knex.raw(
        `alter table \`${DB}\`.\`t_uni_student\`
           modify column \`bed_no\` int default NULL comment '床位号'`,
      );
    }
  }
};
