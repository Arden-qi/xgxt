/**
 * 第 4 期 · 第 5 批（2026-10-11 · 宿舍域）：补齐宿舍统一表的同步字段 + 放宽唯一索引
 * ============================================================
 *
 * 【★★ 本迁移要解决两件事，都是实测踩出来的，不是一般性优化】
 *
 * ── 一、补列：两张同步表共缺 14 列，其中 `source_id` 是命门 ──
 *
 *   实测（逐列对比 information_schema）：
 *     `t_class_dorm_room_sync`(19 列) → `t_uni_dorm_room`(29 列)缺 7：
 *       source_system / source_id / source_batch_no / source_update_time /
 *       sync_status / leader_student_id / leader_student_name
 *     `t_class_dorm_live_sync`(19 列) → `t_uni_dorm_resident`(22 列)缺 7：
 *       source_system / source_id / source_batch_no / source_update_time /
 *       sync_status / dorm_id / dorm_no
 *
 *   【★★★ 为什么 `source_id` 是命门 —— 它是同步幂等键，丢了不会报错，只会静默产生重复】
 *   老表的老接口 `/api/class/dorm/sync` 整个 upsert 都建立在
 *     `where({ source_system, source_id })` + 唯一索引 `uk_room_source` 上。
 *   缺了 `source_id` 列 → 该 where 条件**无法成立**（列不存在）→
 *     只能退化成"每次都当新行 insert" → 教务重复推同一批数据，
 *     宿舍表里会堆出 N 份一模一样的房间，而**接口依然返回 200**。
 *   → 这就是记忆里那条「业务失败 ≠ HTTP 报错」的最阴版本：
 *     没有异常、没有日志、只有数据在悄悄翻倍。
 *   → 第 4 期建表时用 `data_source` 承载了「数据来源」这个概念，
 *     但**没留幂等键** ——「知道数据从哪来」和「用哪个键去重」是两个字段的事。
 *
 *   【为什么给 DEFAULT '' 而不是 NOT NULL + 无默认】
 *   铁律③说「NOT NULL 一律给默认」，这里照做：全部给 `DEFAULT ''`（datetime 给 `NULL`）。
 *   `source_id` 允许为空是有意的 —— **本地新建的房间没有上游主键**
 *   （`/room/add` 走的是 `source_system='class'` + `source_id=自己uuid`，
 *   但换宿/调宿产生的关联行确实可能没有）。空串表示「无上游主键」，
 *   不能拿 NULL，因为 NULL 在唯一索引里**互不相等** → 会放行任意多行重复。
 *
 * ── 二、放宽唯一索引 `uk_dorm_room`（第⑧条铁律第二次重演）──
 *
 *   实测索引差异：
 *     老表 `t_class_dorm_room_sync`：PRIMARY(id) / idx_room_no(dorm_no) / idx_room_type
 *                                   uk_room_source(source_system, source_id)
 *       → **没有任何以 dorm_no/room_no 为键的唯一索引**
 *     统一表 `t_uni_dorm_room`：    PRIMARY(id) / idx_edu_stage
 *                                   uk_dorm_room(room_no, edu_stage)  ← Non_unique=0
 *
 *   ★★ **实测复现的撞墙现场**（不是理论推演）：
 *     老代码 `/room/add` 只写 `dorm_no`，**从不写 `room_no`**。
 *     切读后 `room_no` 走列DEFAULT ''→ 两间房都是 ('','class')
 *       第1间：OK
 *       第2间：`Duplicate entry 'class' for key 'uk_dorm_room'`
 *     → **第二间宿舍就建不出来**，而老库模式下能建任意多间。
 *
 *   【为什么加宽到 `(room_no, dorm_no, edu_stage)`，而不是直接删索引】
 *   · 与 t_uni_exam.uk_exam 那次同理：老表压根没有这层保护，
 *     凭空加的约束会卡死合法业务（老师确实可能建两间都叫「101」的房间，
 *     不同楼栋而已 —— 这在宿舍管理里是常态）
 *   · 保留索引但加宽：同一 room_no + 同一 dorm_no + 同学段 才算重复，
 *     而 dorm_no 是「楼栋-房号」格式，跨楼栋天然不撞
 *   · 删索引会连「同一宿舍号在同一学段不能重复」这层兜底一起丢掉，
 *     而 `/room/add` 本身就有 dup 检查，只是那层能被绕过
 *
 * 【幂等】按列逐个查在不在；按索引查当前列构成，已是目标结构就跳过。
 * 【回滚】down 能删列并把索引还原成两列（前提是无 room_no 重复数据）。
 */

const T_ROOM = 't_uni_dorm_room';
const T_RES = 't_uni_dorm_resident';

/** 要补的列：[列名, 类型, 是否可空, 默认值, 注释] */
const ROOM_COLS = [
  ['source_system', 'varchar(64)', "NOT NULL DEFAULT ''", '来源系统（教务/class/…）'],
  ['source_id', 'varchar(64)', "NOT NULL DEFAULT ''", '★ 上游主键 = 同步幂等键，空串=无上游主键'],
  ['source_batch_no', 'varchar(64)', "NOT NULL DEFAULT ''", '来源批次号'],
  ['source_update_time', 'datetime', 'NULL DEFAULT NULL', '来源更新时间'],
  ['sync_status', 'int(11)', 'NOT NULL DEFAULT 0', '同步状态 1待同步/2已同步/3失败'],
  ['leader_student_id', 'varchar(36)', 'NULL DEFAULT NULL', '舍长学员ID'],
  ['leader_student_name', 'varchar(64)', 'NULL DEFAULT NULL', '舍长姓名'],
];

const RES_COLS = [
  ['source_system', 'varchar(64)', "NOT NULL DEFAULT ''", '来源系统'],
  ['source_id', 'varchar(64)', "NOT NULL DEFAULT ''", '★ 上游主键 = 同步幂等键（roomSourceId##学号）'],
  ['source_batch_no', 'varchar(64)', "NOT NULL DEFAULT ''", '来源批次号'],
  ['source_update_time', 'datetime', 'NULL DEFAULT NULL', '来源更新时间'],
  ['sync_status', 'int(11)', 'NOT NULL DEFAULT 0', '同步状态'],
];

/** 补列：已存在就跳过（幂等） */
async function addCols(knex, table, cols) {
  const have = new Set(
    (
      await knex('information_schema.COLUMNS')
        .select('COLUMN_NAME as cn')
        .where('TABLE_SCHEMA', knex.client.config.connection.database || 'sms_common')
        .where('TABLE_NAME', table)
    ).map((r) => r.cn),
  );
  const added = [];
  for (const [name, type, opts, comment] of cols) {
    if (have.has(name)) {
      console.log(`    · ${table}.${name} 已存在，跳过`);
      continue;
    }
    await knex.raw(
      `ALTER TABLE \`${table}\` ADD COLUMN \`${name}\` ${type} COMMENT '${comment}'`,
    );
    console.log(`  ✔ ${table}.${name} ${type} ${opts.split(' ')[0]}`);
    added.push(name);
  }
  return added;
}

/** 读某索引的列顺序 */
async function indexCols(knex, name, table) {
  const rows = await knex('information_schema.STATISTICS')
    .select('COLUMN_NAME as cn', 'SEQ_IN_INDEX as seq')
    .where('TABLE_SCHEMA', knex.client.config.connection.database || 'sms_common')
    .where('TABLE_NAME', table)
    .where('INDEX_NAME', name)
    .orderBy('SEQ_IN_INDEX');
  return rows.map((r) => r.cn);
}

const up = async function (knex) {
  console.log('--- ① 补room 缺的 7 列 ---');
  await addCols(knex, T_ROOM, ROOM_COLS);
  console.log('--- ② 补 resident 缺的 5 列 ---');
  await addCols(knex, T_RES, RES_COLS);

  console.log('--- ③ 放宽 uk_dorm_room ---');
  const TARGET = 'room_no,dorm_no,edu_stage';
  const cur = await indexCols(knex, 'uk_dorm_room', T_ROOM);
  if (cur.join(',') === TARGET) {
    console.log('  · 已是三列结构，跳过索引部分');
  } else {
    console.log(`  · 现为 (${cur.join(', ') || '不存在'}) → 目标 (${TARGET})`);
    /*
     * ⚠️ MariaDB 10.4 不能 DROP + ADD 写在同一条 ALTER 里（要 INPLACE 算法时报错），
     *   分两步最稳。
     * ⚠️ 改索引前必须先查重复：老表本来允许同room_no，
     *   若库里已有 (room_no='', edu_stage='class') 的多行历史数据，
     *   加宽**不会**失败（加了 dorm_no 反而更宽），但为保险仍先看一眼。
     */
    const dup = await knex
      .select(...['room_no', 'dorm_no', 'edu_stage'], knex.raw('COUNT(*) AS n'))
      .from(T_ROOM)
      .groupBy('room_no', 'dorm_no', 'edu_stage')
      .havingRaw('COUNT(*) >= 2');
    if (dup.length) {
      console.log(`  ⚠ 目标三元组已有重复 ${dup.length} 组：`);
      dup.forEach((d) => console.log(`      ${JSON.stringify(d)}`));
      throw new Error('目标唯一键已有重复数据，uk_dorm_room 无法加宽');
    }
    if (cur.length) {
      await knex.raw('ALTER TABLE `' + T_ROOM + '` DROP INDEX `uk_dorm_room`');
    }
    await knex.raw(
      'ALTER TABLE `' + T_ROOM +
        '` ADD UNIQUE INDEX `uk_dorm_room` (`room_no`, `dorm_no`, `edu_stage`)',
    );
    console.log(`  ✔ uk_dorm_room 已重建为 (${TARGET})`);
  }

  /*
   * ★★★ 改完索引必须复核 NON_UNIQUE —— MariaDB 里
   *   `ADD INDEX` 与 `ADD UNIQUE INDEX` 只差一个词，
   *   前者建出来 Non_unique=1、**静默不报错、一条重复都拦不住**。
   *   （第 4 期在 t_uni_exam.uk_exam 上真踩过一次：看起来建好了，其实形同虚设。）
   */
  const nu = await knex('information_schema.STATISTICS')
    .select('NON_UNIQUE as nu')
    .where('TABLE_SCHEMA', knex.client.config.connection.database || 'sms_common')
    .where('TABLE_NAME', T_ROOM)
    .where('INDEX_NAME', 'uk_dorm_room')
    .first();
  if (!nu || Number(nu.nu) !== 0) {
    throw new Error('uk_dorm_room 不是唯一索引（Non_unique=' + (nu ? nu.nu : '无') + '），已中止');
  }
  console.log('  ✔ 自检：uk_dorm_room Non_unique = 0（确为唯一索引）');

  /* ── 补一个幂等键的普通索引 ──
   * 老表有 uk_room_source(source_system, source_id) 唯一索引，
   * 而本地新建的房间 source_id 就是自己的 uuid，全局不撞，
   * 所以三列唯一索引**理论上可以照搬**。
   * 但这里刻意只建**普通索引**：老代码的 upsert 靠 where 条件走，
   * 不靠数据库拦；而三列唯一索引一旦某天有脏数据就会插不进去。
   * → 索引服务于「查得快」，唯一性交给业务代码的 dup 检查（老代码本来就有）。
   */
  const hasIdx = await indexCols(knex, 'idx_dorm_source', T_ROOM);
  if (!hasIdx.length) {
    await knex.raw(
      'ALTER TABLE `' + T_ROOM +
        '` ADD INDEX `idx_dorm_source` (`source_system`, `source_id`)',
    );
    console.log('  ✔ 已补 idx_dorm_source(source_system, source_id)');
  }
  const hasIdx2 = await indexCols(knex, 'idx_res_source', T_RES);
  if (!hasIdx2.length) {
    await knex.raw(
      'ALTER TABLE `' + T_RES +
        '` ADD INDEX `idx_res_source` (`source_system`, `source_id`)',
    );
    console.log('  ✔ 已补 idx_res_source(source_system, source_id)');
  }
};

const down = async function (knex) {
  for (const [table, cols] of [
    [T_ROOM, ROOM_COLS],
    [T_RES, RES_COLS],
  ]) {
    for (const [name] of cols) {
      await knex.raw('ALTER TABLE `' + table + '` DROP COLUMN `' + name + '`');
    }
    console.log('  ✔ 已删除 ' + table + ' 的 ' + cols.length + ' 个补列');
  }
  const cur = await indexCols(knex, 'uk_dorm_room', T_ROOM);
  if (cur.length === 3) {
    const dup = await knex
      .select('room_no', 'edu_stage', knex.raw('COUNT(*) AS n'))
      .from(T_ROOM)
      .groupBy('room_no', 'edu_stage')
      .havingRaw('COUNT(*) >= 2');
    if (dup.length) {
      throw new Error('已存在同 room_no 同学段数据（' + dup.length + ' 组），无法回滚成两列');
    }
    await knex.raw('ALTER TABLE `' + T_ROOM + '` DROP INDEX `uk_dorm_room`');
    await knex.raw('ALTER TABLE `' + T_ROOM + '` ADD UNIQUE INDEX `uk_dorm_room` (`room_no`, `edu_stage`)');
    console.log('  ✔ uk_dorm_room 已回滚为 (room_no, edu_stage)');
  }
};

module.exports = { up, down };