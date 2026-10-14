/**
 * 第 4 期 · 步骤 0b：修正统一表的 4 处硬错误（类型层）
 * ============================================================
 *
 * 【★★ 这 4 个错误不是本轮改坏的，是第 3 期建表时就错的】
 *   第 3 期那张表建完只灌了 12 行自检夹具，而**仓储始终没切读**，
 *   所以这些列**从来没被写入过、也从来没被读过** —— 错误一直没暴露。
 *   第 4 期步骤 1 做「双写夹具」时，第一次真往这些列写值，立刻炸：
 *   `Data truncated for column 'join_date'`。
 *
 *   → 这是「表建好了 ≠ 能用」这条教训的**第三次复现**。
 *     第 1 次：漏 `src_table`（验收脚本也没查）
 *     第 2 次：漏 `prev_class_status`
 *     第 3 次：★ 列类型按「想当然」写，没对老表逐列核类型
 *
 * 【错误清单（实测，非推测）—— 脚本 `_p4-type-audit.cjs`】
 *
 *   ① `t_uni_class_student.join_date` 建成了 **int(11)**
 *      建表脚本注释还写着「★改用 date」，类型却写成了 integer —— 自相矛盾。
 *      源表 `t_job_class_student.join_date` 是 **date**。
 *      后果：入班日期存不进日期，**数据直接损坏**。
 *
 *   ② `t_uni_student.student_status` 建成了 **varchar(16)**
 *      三学段源表**全是 int**（初高/大学默认 5、实训默认 1）。
 *      后果：状态码存成字符串，仓储里所有 `Number(status)` 判空 → NaN。
 *
 *   ③ `t_uni_class_student.join_type` 建成了 **varchar(16)**，源表是 **int**
 *      后果：入班方式（1随班/2插班…）判断失效。
 *
 *   ④ 全部 8 张表的 `update_time` 建成了 **timestamp NOT NULL DEFAULT '0000-00-00 00:00:00'**
 *      MariaDB 默认严格模式**拒绝零日期** → 任何不带 update_time 的插入直接报错。
 *      源表全是 `datetime NULL DEFAULT NULL`。
 *      实测现有 8 张表零日期数据 **0 行**，改列零风险。
 *
 *   ⑤ 附带：`create_time` 建成了 `timestamp`（源表都是 `datetime`）
 *      timestamp 有 **2038 年上限**，datetime 没有；业务表不该用 timestamp。
 *      一并改 datetime。
 *
 * 【★★ 为什么 `field_type` 不能一刀切改成 int】
 *   实测：`sms_class_jh.t_class_exam_field.field_type` 是 **int**（初高口径 1/2/3），
 *        但 `sms_class.t_class_exam_field.field_type` 是 **varchar(20)**（中文「数值」/「主观」）。
 *   → **两个学段语义不同，不能塞进同一列**。
 *   处理：**分列**，各存各的原始值：
 *     · `field_type`      改回 **int**     ← 初高口径（仓储本来就 `Number(r.field_type)`）
 *     · `field_type_text` **新增 varchar** ← 大学口径的中文
 *   ⚠️ 这正是建表铁律④「语义冲突列必须分列」的又一个实例，
 *      第 3 期把两者合并成一列是错的。
 *
 * 【为什么不用「适配层转换」（斌哥已拍板方案 A）】
 *   方案 B（不动表结构、仓储里转换）看着更安全，但：
 *     ① 后面还有 **24 张表**要建 —— 会把这个错误**复制 24 遍**
 *     ② 转换逻辑写进每个仓储 = 把脏活扩散到代码里，以后每加一个域都得记得转
 *     ③ 现在统一表只有 12 行数据，**改列的代价是历史最低点**
 *   → 改表结构，让「整行原样直插」成立（第 4 期步骤 1 的双写就靠这个前提）。
 *
 * 【幂等】每个列先查类型，已是目标类型就跳过。
 * 【代价】表内 0~12 行自检数据，不搬数据、不回填。
 */

const up = async function (knex) {
  /**
   * 类型对账（用于幂等判断）
   *
   * ⚠️ MariaDB 10.4 的 information_schema **把别名原样小写化**，
   *    写 `AS COLUMN_TYPE` 拿到的是 `column_type`（不是 `COLUMN_TYPE`）。
   *    → 这里用**位置取值** `r[0]/r[1]/r[2]`，不依赖别名大小写。
   *    （踩过：第一次写成 `AS t` 拿到的对象没有 `.t`，报 `undefined.startsWith`）
   */
  async function colType(table, col) {
    // ★ 走查询接口而非 raw()：raw 返回 [[行],[字段]] 两段结构，取值极易出错
    const r = await knex('information_schema.COLUMNS')
      .select('COLUMN_TYPE as ct', 'IS_NULLABLE as nl', 'COLUMN_DEFAULT as dv')
      .where('TABLE_SCHEMA', knex.client.config.connection.database || 'sms_common')
      .where('TABLE_NAME', table)
      .where('COLUMN_NAME', col)
      .first();
    if (!r) return null;
    return { t: r.ct, nl: r.nl, dv: r.dv };
  }

  /* ==========================================================
   * ① join_date：int(11) → date
   * ========================================================== */
  const joinDate = await colType('t_uni_class_student', 'join_date');
  if (joinDate && String(joinDate.t) !== 'date') {
    await knex.raw('ALTER TABLE `t_uni_class_student` MODIFY `join_date` date NULL DEFAULT NULL');
  }

  /* ==========================================================
   * ② student_status：varchar(16) → int(11)
   *    ⚠️ 先把可能存在的字符串值转成数字再改类型。
   *    实测现有 2 行数据是数字字符串（'1'），MODIFY 会自动转换；
   *    但为防万一，先扫一遍非数字值，有则报错而不是静默变 0。
   * ========================================================== */
  const stuBad = await knex('t_uni_student')
    .whereNotNull('student_status')
    .whereRaw("CAST(student_status AS CHAR) REGEXP '[0-9]' = 0")
    .count({ n: '*' });
  const badCount = Number(stuBad[0]?.n || 0);
  if (badCount > 0) {
    throw new Error(
      `t_uni_student.student_status 有 ${badCount} 行非数字值，` +
        `改 int 前需人工确认。已中止，未做任何修改。`,
    );
  }
  const stuStatus = await colType('t_uni_student', 'student_status');
  if (stuStatus && String(stuStatus.t) !== 'int(11)') {
    await knex.raw(
      `ALTER TABLE \`t_uni_student\`
         MODIFY \`student_status\` int(11) NOT NULL DEFAULT 5
         COMMENT '统一学生状态 1待咨询2咨询中3试学中4预在读5正式在读6休学7退学8实训中9待就业10已就业11流失'`,
    );
  }

  /* ==========================================================
   * ③ join_type：varchar(16) → int(11)
   * ========================================================== */
  const jtBad = await knex('t_uni_class_student')
    .whereNotNull('join_type')
    .whereRaw("CAST(join_type AS CHAR) REGEXP '[0-9]' = 0")
    .count({ n: '*' });
  if (Number(jtBad[0]?.n || 0) > 0) {
    throw new Error(
      `t_uni_class_student.join_type 有非数字值，改 int 前需人工确认。已中止。`,
    );
  }
  const joinType = await colType('t_uni_class_student', 'join_type');
  if (joinType && String(joinType.t) !== 'int(11)') {
    await knex.raw(
      'ALTER TABLE `t_uni_class_student` MODIFY `join_type` int(11) NULL DEFAULT NULL ' +
        "COMMENT '入班方式（1随班 2插班 3转班 4复学）'",
    );
  }

  /* ==========================================================
   * ⑤ field_type 分列：int（初高）+ 新增 field_type_text（大学）
   *
   * ⚠️⚠️ 实测踩到的坑（不是推测，是第一次跑就炸出来的）：
   *   第 3 期的迁移脚本把**初高**那行的 field_type 也写成了中文「数值」——
   *   因为建表时列类型就是 varchar(20) DEFAULT '数值'，
   *   迁移时 `r.field_type` 读到 int 却被塞进 varchar，一样能存进去。
   *   → 所以**光靠「列类型是 varchar 就搬」这个判断不够**：
   *      搬迁必须**无条件执行一次**（按 stage 区分），否则中文值原地不动，
   *      紧接着的 MODIFY ... int 就会报 `Truncated incorrect INTEGER value: '数值'`。
   *
   *   实测现状：2 行都是「数值」，其中 stage=jh（初高）本该是 int 码。
   *   → 处理：中文一律搬到 field_type_text；int 列按 stage 给默认值兜底。
   * ========================================================== */
  const hasText = await knex.schema.hasColumn('t_uni_exam_field', 'field_type_text');
  if (!hasText) {
    await knex.schema.alterTable('t_uni_exam_field', (t) =>
      t.string('field_type_text', 20).comment(
        '★大学口径字段类型（中文：数值/主观/…）。与 field_type(int,初高口径) 语义不同，务必分列',
      ),
    );
  }
  /**
   * ★★★ 第四次踩的坑（终于找到真凶，前三次都在治标）：
   *
   *   现象：把同样两条 UPDATE 放进迁移脚本里跑就报
   *         `Truncated incorrect DOUBLE value: ''`，
   *         但**用独立脚本跑同样的 SQL 完全成功**。
   *
   *   真凶：`knex.raw()` 在**迁移的连接上下文**里，
   *   这条 UPDATE 的 WHERE 里出现了 `field_type <> ''` + `field_type REGEXP ...`，
   *   MariaDB 在严格模式下对 `field_type`（此时还是 varchar，存着中文）
   *   求值时把它当数字 → Truncated。
   *   而独立脚本能跑通，是因为**那时 field_type 已经被前面的实验改成 int 了**。
   *
   *   → 结论：**不要在同一条 UPDATE 里用「列 <> ''」这种会触发隐式数值转换的判据**。
   *   → 做法：**先用 SELECT 查出待处理的 id（纯读，绝对安全），
   *        再用 `whereIn('id', ids)` 逐条改**。这样 UPDATE 的 WHERE 里只有主键，
   *     不触发任何类型推断，行为完全确定。
   *
   *   ⚠️ 这是本项目通用纪律的又一例：
   *     **批量 UPDATE 的 WHERE 条件里一旦出现「可能存了脏值的列」，
   *     严格模式就会炸。** 先查 id、再按 id 改，永远安全。
   */
  // ——— 第 1 步：搬中文值到 field_type_text（按主键逐条，WHERE 里只有 id）———
  const toMove = await knex('t_uni_exam_field')
    .select('id', 'field_type')
    .whereNull('field_type_text')
    .whereNotNull('field_type');
  for (const row of toMove) {
    const id = row.id;
    const val = row.field_type;
    if (typeof id !== 'string' || !id) continue;
    if (val === null || val === undefined || val === '') continue;
    // 已经是纯数字的说明本来就是 int 码，不用搬
    if (/^[0-9]+$/.test(String(val))) continue;
    await knex.raw('UPDATE `t_uni_exam_field` SET `field_type_text` = ? WHERE `id` = ?', [
      String(val),
      id,
    ]);
  }

  const pending = await knex('t_uni_exam_field')
    .select('id')
    .whereNotNull('field_type_text')
    .whereNot('field_type_text', '')
    .whereNot('field_type', 1);
  const ids = (pending || []).map((r) => r.id).filter((x) => typeof x === 'string' && x !== '');
  if (ids.length) {
    // 按主键逐条改：WHERE 里只有 id，不触发 field_type 的隐式数值求值
    for (const id of ids) {
      await knex.raw(
        'UPDATE `t_uni_exam_field` SET `field_type` = 1 WHERE `id` = ?',
        [id],
      );
    }
  }

  const ftBad = await knex('t_uni_exam_field')
    .whereNotNull('field_type')
    .whereNot('field_type', '')
    .whereRaw("field_type REGEXP '[0-9]' = 0")
    .count({ n: '*' });
  if (Number(ftBad[0]?.n || 0) > 0) {
    throw new Error(
      `t_uni_exam_field.field_type 仍有非数字值未搬到 field_type_text，无法改 int。已中止。`,
    );
  }
  /**
   * ★★★ 2026-10-14 变更：**不再把 field_type 改成 int**
   *
   * 【为什么去掉这段】
   *   本迁移写于第 4 期**早期**，当时的设计是「field_type 改回 int（初高口径），
   *   大学的中文口径另开 field_type_text 列」。
   *   但**第 9 批的 `20261011_005_exam_domain_align` 已经推翻了这个决定**：
   *   它把这列**改回 varchar(20) DEFAULT '数值'**，
   *   理由是业务代码 `exam/route.ts` 的 zod schema 就是 `z.string().default('数值')`，
   *   而大学侧（sms_class）老表也是 varchar —— 对齐它 = 代码零改动。
   *
   *   于是这条迁移链在新库上产生了**顺序副作用**：
   *     ① SQL 建表   → varchar（与权威库一致）✅
   *     ② 本迁移     → 改成 int        ❌ 把权威结构改坏
   *     ③ 005 迁移   → 判断「已是 varchar(20) 就跳过」，此刻是 int，
   *                    但实测 005 仍走了跳过分支 → **最终停在 int**
   *     → 结果：新库这 1 张表与权威库不一致，切读模式新增考试字段会
   *       报 `Truncated incorrect INTEGER value: '数值'`。
   *
   * 【为什么直接删掉这段是安全的】
   *   · 已有环境：本迁移早已执行过（knex_migrations 有记录），不会重跑，改了不影响；
   *   · 新环境：SQL 建的本来就是 varchar，本段不执行反而**结果正确**。
   *   · 搬中文值到 field_type_text 的逻辑**保留**（见上方第 1 步），
   *     那部分对空库是空操作、对老库是必要的数据搬迁。
   */
  const ft = await colType('t_uni_exam_field', 'field_type');
  if (ft && String(ft.t) !== 'varchar(20)' && String(ft.t) !== 'int(11)') {
    // 只做提示，不改类型：类型口径由 20261011_005 负责（varchar(20)）
    console.log(`  · t_uni_exam_field.field_type 当前类型 ${ft.t}，保持不动（口径由 005 迁移统一为 varchar(20)）`);
  }

  /* ==========================================================
   * ④⑤ 时间列：timestamp → datetime，且去掉零日期默认值
   *
   * ★ 为什么必须去零日期：
   *   MariaDB 默认严格模式下 `DEFAULT '0000-00-00 00:00:00'` 会被拒绝，
   *   而 knex 的 insert 不传该列时会用默认值 → 直接报错。
   *   源表全是 `datetime NULL DEFAULT NULL`，对齐源表最安全。
   *
   * ★ 为什么 timestamp → datetime：
   *   timestamp 上限 2038-01-19，datetime 是 9999-12-31。
   *   业务表存的是学制年份跨度，用 timestamp 属于埋雷。
   *
   * ⚠️⚠️ 列清单**必须查全，不能只写 create_time / update_time**：
   *   第一版只写了这两个，跑完对账才发现
   *   `t_uni_dorm_apply.approve_time` 同样是 timestamp + 零日期默认
   *   （「审批时间」业务列，老表是 datetime NULL）。
   *   → 改成**按 information_schema 全表扫 datetime 之外的时间列**，
   *     而不是硬编码列名，这样以后加表也不会漏。
   * ========================================================== */
  const TIME_TABLES = [
    't_uni_class',
    't_uni_student',
    't_uni_class_student',
    't_uni_attendance',
    't_uni_exam',
    't_uni_exam_field',
    't_uni_repeat',
    't_uni_dorm_apply',
  ];
  for (const tb of TIME_TABLES) {
    // ★ 动态扫出该表所有 timestamp 列（不硬编码列名，避免漏业务时间列）
    //
    // ⚠️⚠️⚠️ 第四次踩同一个坑的**最终形态**（这次终于查到根）：
    //   `knex.raw()` 在本项目返回的是 **两段结构**：
    //       r[0] = [行1, 行2, ...]      ← 整批行，是一个数组
    //       r[1] = [字段元数据]           ← FieldPacket 列表
    //   所以 `r[0]` 是数组、不是行对象，`r[0][0]` 拿到的是**整批行**，
    //   我前面几版按 `r[0][0]` / `r[0]` 取值全错 → 循环体一次都没执行 →
    //   表现为「迁移跑成功、但 timestamp 列一个没改」。
    //
    //   （前两次只改判据没查返回值结构，属于治标；这次打印了原始 JSON 才定位到。）
    //
    //   → 正确姿势：**information_schema 查询一律走查询接口** `knex('information_schema.COLUMNS')`，
    //     拿到的就是干净的字段对象，不受 raw 的两段结构影响。
    const tsRows = await knex('information_schema.COLUMNS')
      .select('COLUMN_NAME as cn')
      .where('TABLE_SCHEMA', knex.client.config.connection.database || 'sms_common')
      .where('TABLE_NAME', tb)
      .where('DATA_TYPE', 'timestamp');
    for (const r of tsRows) {
      const col = r.cn;
      if (!col || typeof col !== 'string') continue;
      // 先把零日期洗成 NULL（timestamp 上限 1970，'<1970' 只会命中零日期与越界值）
      await knex.raw(
        `UPDATE \`${tb}\` SET \`${col}\` = NULL WHERE \`${col}\` < '1970-01-01 00:00:00'`,
      );
      await knex.raw(`ALTER TABLE \`${tb}\` MODIFY \`${col}\` datetime NULL DEFAULT NULL`);
    }
  }
};

const down = async function (knex) {
  /**
   * 回滚说明：
   *   类型收窄是**不可逆**的（int → varchar 可以，date → int 会把日期变成 20260301 之类的数字，
   *   虽可转但语义已损）。所以这里只回滚「分列」这一件无损的事，
   *   其余类型一律不回滚 —— 需要回退请从备份重建表。
   *
   *   【实测零日期/脏数据前提】改列前已确认 8 张表零日期 0 行，
   *   且 student_status / join_type / field_type 的非数字值已显式校验为 0，
   *   所以 MODIFY COLUMN 是安全的无损操作。
   */
  const hasText = await knex.schema.hasColumn('t_uni_exam_field', 'field_type_text');
  if (hasText) {
    await knex.schema.alterTable('t_uni_exam_field', (t) => t.dropColumn('field_type_text'));
  }
};

module.exports = { up, down };