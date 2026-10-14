/**
 * 第 3 期 · 阶段 B：建 8 张统一主表（t_uni_*）
 * ============================================================
 *
 * 【目标】
 *   把散在 2~3 个库的重复表合并成「一张权威表 + stage 列区分学段」。
 *   合并前 8 张表加起来只有 8 行数据，所以**这一步纯建表，不搬数据**
 *   （搬数据是阶段 C）。
 *
 * 【放哪个库】
 *   `sms_common` —— 公共/中立位置，跨库读它不用跨库连接。
 *   （本项目已有先例：t_class_dorm_room_sync 等同步表就在这）
 *
 * 【★★★ 七条建表铁律（每条都对应调研发现的一个真实坑）】
 *
 * ① **必须带 `stage` 列**
 *    「初高 G104」和「大学 G104」是**两个不同的班**，
 *    没有 stage 就无法区分 —— 这是整个归一的必要条件。
 *
 * ② **唯一索引按 stage 组合，不能单列**
 *    合并前 `t_class_info` 的 `uk_class_name` **只在初高有**（大学不唯一）。
 *    归一后如果还用单列唯一索引 → 「初高 G104」和「大学 G104」只能存一个，
 *    **直接丢数据**。所以统一用 `uk(name, stage)`。
 *
 * ③ **NOT NULL 列一律给默认值或改可空**
 *    各学段同一列的可空性不一致（调研脚本标的 `⚠️ 类型/可空不一致` 共 17 处）。
 *    比如 `should_count`：大学 NOT NULL、初高可空 —— 硬搬到统一表会让初高数据插不进去。
 *    → **新表里所有业务列都给默认值 0 / ''**，不设 NOT NULL。
 *
 * ④ **★ 语义冲突的列必须分开保留，不能合并**
 *    最典型的两对：
 *      · `today_attendance_rate`（初高「今日」出勤率）
 *        vs `attendance_rate`（大学/实训「累计」出勤率）
 *      → **这是两个不同指标**，合并成一列会导致数据失真。**必须两列都留。**
 *      · `present_count`（大学实到）vs `actual_count`（初高已到）
 *      → 同义不同名，归一后统一叫 `present_count`（迁移时翻译）。
 *
 * ⑤ ~~保留 `src_db` + `src_id` 做溯源~~
 *    【★ 2026-10-14 已废弃】第 4 期的建表约定已改为**不加 src_* 三件套**，
 *    权威库 8 张表实测都没有 src_db / src_table / src_id。
 *    → 本迁移也因此**不再建表**，建表职责交给 sql/init/uni-tables.sql，详见文末说明。
 *    迁移后要能回答「这条记录原来在哪个库哪张表」，否则出问题无法回查。
 *
 * ⑥ **不建物理外键**
 *    本项目全部表都是逻辑关联 + 应用层保证，且 MariaDB/MySQL 混用时外键行为不一致。
 *
 * ⑦ **软删 + 唯一索引的坑：唯一索引要把 is_deleted 算进去吗？**
 *    本项目其它表的做法是**软删行仍占唯一索引**（所以「删了再也建不回来」）。
 *    这里**故意保持一致**（唯一索引不带 is_deleted），
 *    理由：① 与其它 75 张表行为一致，避免"这张表能删了再建、别的表不行"的困惑；
 *    ② 阶段 D 切换后仓储会做友好提示（见 repo 的唯一性检查写法）。
 */

/* ============================================================
 * ★★★ 2026-10-14 重大变更：本迁移**不再建表**
 * ============================================================
 *
 * 【为什么改】
 *   本文件是**第 3 期**写的，当时的建表设计是「带 src_db / src_table / src_id
 *   溯源三件套」（见上面第 ⑤ 条）。
 *   但第 4 期的建表约定已经改成 **不加 src_* 三件套**，
 *   权威库（sms_common）实测 8 张表**都没有**这三列。
 *
 *   于是出现了一个很难发现的**结构分叉**：
 *     · 空库跑本迁移  → 建出「带 src_* 的旧结构」
 *     · uni-tables.sql 是 `CREATE TABLE IF NOT EXISTS` → 见表已存在就跳过
 *     · 结果：新环境的 8 张表结构**永远修不回来**，与权威库不一致
 *       （多 src_db/src_table/src_id，少 stage 等），切读模式会读错列。
 *
 * 【现在怎么做】
 *   1. 这 8 张表（以及另外 35 张 t_uni_*）的建表职责，**统一交给**
 *      `server-job/sql/init/uni-tables.sql` —— 它是从**权威库**导出的，
 *      43 张表结构 100% 与生产一致。
 *   2. `tools/start.mjs` 已调整为 **先导入该 SQL，再跑 migrate**。
 *   3. 所以本迁移执行时，表必然已经存在 → 直接跳过即可。
 *      万一不存在，说明 SQL 没导入成功，**直接报错提醒**，不要静默建错结构。
 *
 * 【对已有环境的影响：无】
 *   · 已执行过本迁移的库，knex_migrations 里有记录，不会重跑；
 *   · 本文件也不再建表，不存在「又把旧结构建一遍」的风险。
 *   · down 保留原来的删表语义（回滚时把 8 张表删掉）。
 * ============================================================ */

const TABLES = [
  't_uni_student',
  't_uni_class',
  't_uni_class_student',
  't_uni_attendance',
  't_uni_exam',
  't_uni_exam_field',
  't_uni_repeat',
  't_uni_dorm_apply',
];

const up = async function (knex) {
  const missing = [];
  for (const t of TABLES) {
    if (!(await knex.schema.hasTable(t))) missing.push(t);
  }

  if (missing.length) {
    throw new Error(
      '统一表尚不存在：' + missing.join(', ') + '\n' +
      '  这 8 张表由 server-job/sql/init/uni-tables.sql 建立（从权威库导出，含全部 43 张 t_uni_*）。\n' +
      '  请确认 tools/start.mjs 已先导入该 SQL、再执行 knex migrate。',
    );
  }

  console.log('  ✔ 8 张统一表已由 sql/init/uni-tables.sql 建立，本迁移跳过建表');
};

const down = async function (knex) {
  for (const t of TABLES) {
    await knex.schema.dropTableIfExists(t);
  }
};

module.exports = { up, down };
