/**
 * 第 4 期 · 步骤 2 前置：统一表「学段列」改名 stage → edu_stage
 * ============================================================
 *
 * 【★★ 为什么必须改：同名不同义，切读会静默查不到数据】
 *
 *   统一表 `stage`  = **学段标识**（jh 初高 / class 大学 / job 实训）← 第 3 期新加的
 *   老表   `stage`  = **学段内阶段码**（初高 101；大学 201~206）
 *
 *   两列**名字一样、语义完全相反、类型还不同**（varchar vs int）。
 *   切读时如果仓储里写 `where stage = 'class'`：
 *     → 套到老表上变成「找阶段码等于字符串 'class' 的行」→ **一行都找不到**
 *     → 而 knex **不报错**，接口照样 200，只是列表空��
 *   这跟第 4 期之前的「列不存在静默返回 undefined」是同一类最难查的问题。
 *
 * 【★ 第 3 期其实做对了一半】
 *   建表时已经把老表的阶段码命名为 `stage_code`（实测 t_uni_class / t_uni_student
 *   都有这列，类型 int，与老表一致）—— 语义分离的意识是有的，
 *   但**学段列仍沿用了 stage 这个名字**，跟老表撞了。
 *   → 本迁移只做「给学段列改名」，`stage_code` 保持不动。
 *
 * 【为什么选「改统一表」而不是「改老表」（斌哥拍板方案 A）】
 *   ① 统一表是我们自己新建的，改 8 张表的 1 列 = 零业务风险
 *   ② 老表是三拨人在用的生产资产，**一列都不该动**
 *   ③ 后面还有 24 张表要建 —— 名字撞车的坑要在源头拔掉，不能留给后来人
 *
 * 【★ 顺带修掉第二颗雷：默认值 'jh'】
 *   8 张表的 `stage` 都写了 `DEFAULT 'jh'`。
 *   含义是「插入时忘了传 stage，这行就静默变成初高」。
 *   → 学段列**必须显式传**，默认值必须去掉，改成 NOT NULL 无默认
 *     （真忘了传 → 直接报 ER_BAD_NULL_ERROR，当场暴露，而不是脏数据）。
 *
 * 【改名会不会破坏现有索引】
 *   MySQL/MariaDB `CHANGE COLUMN` 会**自动把索引里的列名一起改**，
 *   所以索引名里的 `stage` 字样（如 `uk_uni_class_name_stage`）保留不动即可 ——
 *   索引**逻辑完全不变**，只是名字里还留着 stage 字样，不影响功能。
 *   → 唯一索引 `uk_uni_*` 的**组合里 stage 的位置不变**，
 *     所以「唯一性按学段隔离」这个第 3 期铁律依然成立。
 *
 * 【幂等】先查列是否存在；已是 edu_stage 就跳过。
 * 【代价】8 张表各 1 行 DDL，各表内 0~12 行自检数据，**不搬数据**。
 */

const TABLES = [
  't_uni_class',
  't_uni_student',
  't_uni_class_student',
  't_uni_attendance',
  't_uni_exam',
  't_uni_exam_field',
  't_uni_repeat',
  't_uni_dorm_apply',
];

const up = async function (knex) {
  async function hasCol(table, col) {
    const r = await knex('information_schema.COLUMNS')
      .select('COLUMN_NAME as cn')
      .where('TABLE_SCHEMA', knex.client.config.connection.database || 'sms_common')
      .where('TABLE_NAME', table)
      .where('COLUMN_NAME', col)
      .first();
    return !!r;
  }

  for (const t of TABLES) {
    /* ---------- 1. 改名 stage → edu_stage（尚未改过的才改） ---------- */
    if (await hasCol(t, 'edu_stage')) {
      /* 已改过：只做第 2 步的默认值修正 */
    } else if (await hasCol(t, 'stage')) {
      await knex.raw(
        'ALTER TABLE `' + t + '` ' +
          "CHANGE COLUMN `stage` `edu_stage` varchar(16) NOT NULL " +
          "COMMENT '学段 jh初高/class大学/job实训（★不是阶段码，阶段码在 stage_code）'",
      );
      console.log('  ✔ ' + t + '  stage → edu_stage');
    } else {
      throw new Error(t + ' 既没有 stage 也没有 edu_stage，建表脚本可能没跑全');
    }

    /* ---------- 2. 去掉 DEFAULT 'jh'（★忘传 stage 时要报错，不是静默变初高） ---------- */
    await knex.raw('ALTER TABLE `' + t + '` MODIFY `edu_stage` varchar(16) NOT NULL ' +
      "COMMENT '学段 jh初高/class大学/job实训（★不是阶段码，阶段码在 stage_code）'");
  }
};

const down = async function (knex) {
  for (const t of TABLES) {
    const r = await knex('information_schema.COLUMNS')
      .select('COLUMN_NAME as cn')
      .where('TABLE_SCHEMA', knex.client.config.connection.database || 'sms_common')
      .where('TABLE_NAME', t)
      .where('COLUMN_NAME', 'edu_stage')
      .first();
    if (!r) continue;
    await knex.raw(
      'ALTER TABLE `' + t + '` ' +
        "CHANGE COLUMN `edu_stage` `stage` varchar(16) NOT NULL DEFAULT 'jh' " +
        "COMMENT '学段'",
    );
  }
};

module.exports = { up, down };
