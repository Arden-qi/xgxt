/**
 * 第 4 期 · 步骤 3 收口：`t_uni_exam.uk_exam` 唯一索引补上 `exam_date`
 * ============================================================
 *
 * 【★★ 为什么要改：统一表凭空加了一个老表没有的唯一索引】
 *   实测（2026-10-10 切读双跑）两张表的索引差异：
 *
 *     老表 `sms_class_jh.t_class_exam` / `sms_class.t_class_exam`
 *       PRIMARY(id)
 *       idx_exam_type / idx_exam_date / idx_class_id / idx_exam_status
 *       → **一个唯一索引都没有**。也就是说老库允许「同一学段建两个同名考试」。
 *
 *     统一表 `t_uni_exam`
 *       PRIMARY(id)
 *       uk_exam(exam_name, edu_stage)     ← 建表时凭七铁律②「唯一索引按 stage 组合」
 *       idx_edu_stage(edu_stage)
 *
 *   「按 stage 组合」那条铁律讲的是**建唯一索引时要带 stage**，
 *   不是「看到任意业务列就该建唯一索引」。这里被过度执行了。
 *
 * 【踩坑现场】
 *   跑成绩域自检时 `mkExam('jh', …, '【自检】初高成绩考')` 报
 *     Error: 建考试失败(jh)：数据已存在，请勿重复添加
 *   当时第一反应是「残留脏数据」，清了两轮才发现：
 *     清扫脚本前缀只 match '自检%'，漏了考试域的「【自检】xxx」
 *     —— 残留确实清掉了，但**真正常驻的种子数据也可能同名**，
 *     而老库从来允许这件事，统一表不允许 → 业务被索引卡死。
 *
 * 【★★ 修法（斌哥 2026-10-10 拍板方案 B）】
 *   唯一键 (exam_name, edu_stage)
 *        → (exam_name, exam_date, edu_stage)
 *
 *   语义 = 「同一学段、同一天、同一场考试名」不能重复。
 *   与真实业务对齐：老师确实可能反复建「期中考试」，
 *   但同一天的同一场考试单开两次就是脏数据，该拦。
 *
 * 【为什么保留唯一索引，而不是直接删掉】
 *   · 删索引 → 完全等于老表行为，等于放弃「同一天同一场考试」的兜底保护
 *   · 放宽到含 exam_date → 保住保护，同时不再卡住合法业务
 *   （老表完全没有该保护属于老表的历史欠账，不在归一改造里补做，
 *     免得牵一发动全身 —— 补欠账应该是独立一期的事。）
 *
 * 【★ 唯一的坑：`exam_date` 是 `date NULL`】
 *   MySQL/MariaDB 的唯一索引里，**NULL 互不相等**，
 *   即 `exam_date IS NULL` 的行会全部放行（同一 exam_name 能插多条）。
 *   这正是我们想要的：老表压根没有「同名」约束，
 *   日期缺失的老数据不该被索引拒绝。**不需要也不应该给 NULL 兜默认值。**
 *
 * 【幂等】先读现有索引构成，已经是三列就直接返回。
 * 【回滚】down 能还原成两列（前提是无重名同日期数据）。
 */

const TABLE = 't_uni_exam';

/** 读某个索引的列顺序 */
async function indexCols(knex, name) {
  const rows = await knex('information_schema.STATISTICS')
    .select('COLUMN_NAME as cn', 'SEQ_IN_INDEX as seq')
    .where('TABLE_SCHEMA', knex.client.config.connection.database || 'sms_common')
    .where('TABLE_NAME', TABLE)
    .where('INDEX_NAME', name)
    .orderBy('SEQ_IN_INDEX');
  return rows.map((r) => r.cn);
}

/**
 * 查「同组内出现 >=2 次」的分组
 *
 * ★★★ 为什么绕开 knex 的查询构造器（本项目连踩三次）
 *   1. `knex.raw(SELECT …)` 在 **MariaDB 驱动**下返回的是**原始协议字段数组**
 *      而不是行对象 → `raw[0].exam_name` 恒为 undefined、`raw.length` 恒等于字段数。
 *      实测：无重复数据时被误判成「2 组重复」并抛错。
 *   2. `.count({n:'*'}).having('>=','n',2)` → knex 把 having 里的 'n' 当普通列，
 *      抛 `The operator "n" is not permitted`。
 *   3. `.having('>=', knex.raw('count(*)'), 2)` → 生成 `having \`>=\` count(*) 2`
 *      （把运算符写进了标识符位置）→ MariaDB 语法错误。
 *
 *   → 最终解法：**`.select().from().groupBy().havingRaw('COUNT(*) >= 2')`**
 *     —— havingRaw 直接把整段 SQL 原样拼进去，不经过运算符解析，
 *     且返回的是**正常行对象**（不是 raw 的协议字段数组）。
 *
 *   ⚠️ 另外注意：`knex.client` 不是可用连接（拿不到 query 方法），
 *      迁移里想直接跑原生 SQL 只能通过 knex 实例本身。
 */
async function findDupGroups(knex, cols) {
  /* ★ cols 必须传**数组**，不能传 join 好的字符串：
       字符串会被 knex 当成一个列名 → 生成 ```a`,`b``` 报
       Unknown column '`a`, `b`' in 'field list'。 */
  const rows = await knex
    .select(...cols, knex.raw('COUNT(*) AS n'))
    .from(TABLE)
    .groupBy(...cols)
    .havingRaw('COUNT(*) >= 2');
  return rows;
}

const up = async function (knex) {
  const cur = await indexCols(knex, 'uk_exam');
  const TARGET = 'exam_name,exam_date,edu_stage';

  /* 已经就是目标结构，且确认是真唯一索引 → 幂等跳过 */
  if (cur.join(',') === TARGET) {
    const nu = await knex('information_schema.STATISTICS')
      .select('NON_UNIQUE as nu')
      .where('TABLE_SCHEMA', knex.client.config.connection.database || 'sms_common')
      .where('TABLE_NAME', TABLE)
      .where('INDEX_NAME', 'uk_exam')
      .first();
    if (nu && Number(nu.nu) === 0) {
      console.log('  · uk_exam 已是 (' + TARGET + ') 且确为唯一索引，跳过');
      return;
    }
    /* 列对但不是唯一索引（曾误用 ADD INDEX 建出来）→ 继续往下重建 */
    console.log('  · uk_exam 列结构对但 Non_unique=' + (nu ? nu.nu : '无') + '，需重建');
  } else if (cur.length === 0) {
    /* 索引整个不存在（比如上一轮执行到一半）→ 照样按目标结构建出来。
       ★ 这里不能「不凭空新增」直接 return：
         本迁移的**目的**就是把唯一键定成 (exam_name, exam_date, edu_stage)，
         索引不在了就该补上，否则这轮迁移等于什么都没做。 */
    console.log('  · uk_exam 不存在，将按目标结构新建');
  } else {
    console.log('  · uk_exam 现为 (' + cur.join(', ') + ')，将加宽为 (' + TARGET + ')');
  }

  /* 改之前先看有没有「同名同日期」的存量数据——
     有的话加索引会直接失败，必须先报出来而不是让它炸在半路。
     ⚠️ 这里必须用 query builder，不能用 knex.raw(SELECT)：
        本项目是 MariaDB 驱动，raw 的 SELECT 返回的是**原始协议字段数组**
        （不是行对象），`raw[0].exam_name` 恒为 undefined、
        `raw.length` 恒等于字段个数 → 会把「0 组重复」误判成「2 组重复」并抛错。
        （这个坑真实踩过一次：明明无重复，迁移却报「存在重复考试 2 组」。） */
  const dup = await findDupGroups(knex, ['exam_name', 'exam_date', 'edu_stage']);
  if (dup.length) {
    console.log('  ⚠ 存在同名同日期同学段的存量数据 ' + dup.length + ' 组，需先处理：');
    dup.forEach((d) =>
      console.log('      ' + d.exam_name + ' | ' + d.exam_date + ' | ' + d.edu_stage + ' × ' + d.n),
    );
    throw new Error('存在重复考试，uk_exam 无法加宽，请先清理');
  }

  /* MariaDB 不支持 ALTER TABLE DROP INDEX + ADD INDEX 在同一语句里带算法，
     分两步最稳（10.4 支持 INPLACE，无需 ALGORITHM=INPLACE） */
  if (cur.length) {
    await knex.raw('ALTER TABLE `' + TABLE + '` DROP INDEX `uk_exam`');
    console.log('  ✔ 已删除 uk_exam(' + cur.join(', ') + ')');
  }

  await knex.raw(
    'ALTER TABLE `' + TABLE +
      '` ADD UNIQUE INDEX `uk_exam` (`exam_name`, `exam_date`, `edu_stage`)',
  );
  console.log('  ✔ 已重建 uk_exam(exam_name, exam_date, edu_stage)');

  /* ★★ 建完必须自检「真的是唯一索引」——
     踩坑：MariaDB 的 `ADD INDEX` 与 `ADD UNIQUE INDEX` 只差一个词，
     但前者建出来是**普通索引**（information_schema.Non_unique = 1），
     **静默不报错、一条重复都拦不住**，实测才发现「唯一索引形同虚设」。
     → 每次改索引都要查 Non_unique 复核，
       别只信 SHOW CREATE TABLE 里的命令原文（原文长得一样，含义不同）。 */
  const after = await knex('information_schema.STATISTICS')
    .select('NON_UNIQUE as nu')
    .where('TABLE_SCHEMA', knex.client.config.connection.database || 'sms_common')
    .where('TABLE_NAME', TABLE)
    .where('INDEX_NAME', 'uk_exam')
    .first();
  if (!after || Number(after.nu) !== 0) {
    throw new Error(
      'uk_exam 建出来不是唯一索引（Non_unique=' + (after ? after.nu : '无') + '），已中止',
    );
  }
  console.log('  ✔ 自检通过：uk_exam 的 Non_unique = 0（确为唯一索引）');

  /* 顺带补一条普通索引：业务里几乎都按「学段 + 日期」查，
     加了复合唯一索引后这个顺序的索引就用不上了 */
  const hasIdxDate = await indexCols(knex, 'idx_exam_stage_date');
  if (!hasIdxDate.length) {
    await knex.raw(
      'ALTER TABLE `' + TABLE +
        '` ADD INDEX `idx_exam_stage_date` (`edu_stage`, `exam_date`)',
    );
    console.log('  ✔ 已补 idx_exam_stage_date(edu_stage, exam_date)');
  }
};

const down = async function (knex) {
  const cur = await indexCols(knex, 'uk_exam');
  if (cur.join(',') === 'exam_name,edu_stage') {
    console.log('  · 已是两列，无需回滚');
    return;
  }

  const dup = await findDupGroups(knex, ['exam_name', 'edu_stage']);
  if (dup.length) {
    throw new Error('已存在同名同学段数据（' + dup.length + ' 组），无法回滚成两列');
  }

  await knex.raw('ALTER TABLE `' + TABLE + '` DROP INDEX `uk_exam`');
  await knex.raw('ALTER TABLE `' + TABLE + '` ADD UNIQUE INDEX `uk_exam` (`exam_name`, `edu_stage`)');
  const hasIdxDate = await indexCols(knex, 'idx_exam_stage_date');
  if (hasIdxDate.length) {
    await knex.raw('ALTER TABLE `' + TABLE + '` DROP INDEX `idx_exam_stage_date`');
    console.log('  ✔ 已删 idx_exam_stage_date');
  }
  console.log('  ✔ uk_exam 已回滚为 (exam_name, edu_stage)');
};

module.exports = { up, down };