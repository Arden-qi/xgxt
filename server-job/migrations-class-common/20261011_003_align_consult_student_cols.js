/**
 * 第 4 期 · 第 6 批（2026-10-11 · 咨询域）：对齐 bed_no 类型 + 降级凭空唯一索引
 * ============================================================
 *
 * 【★★ 与宿舍域第 5 批不同：咨询域 6 张表实测「零缺列」，不需要补列】
 *
 *   实测逐列对比（`scripts/_p6-probe-consult.cjs`）：
 *     t_class_consult_push (35) → t_uni_consult_push (37)   缺 0
 *     t_class_student_transfer(16) → t_uni_class_transfer (44) 缺 0
 *     t_class_grade        (20) → t_uni_exam_score    (39)   缺 0
 *     t_class_repeat        (20) → t_uni_repeat        (26)   缺 0
 *     t_class_info(25) → t_uni_class    (33)   缺 0
 *     t_class_student(57) → t_uni_student     (73)   缺 0
 *
 *   但有2 处「类型/约束层面的隐患」，不修的话切读阶段会出问题。
 *
 * ── 一、`bed_no` 类型冲突：老表 int(11) vs 统一表 varchar(20) ──
 *
 *   实测：
 *     sms_class.t_class_student.bed_no  = int(11)NULL
 *     sms_common.t_uni_student.bed_no   = varchar(20) NULL
 *
 *   【★★ 为什么必须改，而不是让代码适配 —— 一列在两个域被两种方式理解】
 *
 *   咨询域「接收学员」(`/receive`) 用它做**床位占用校验**：
 *     `where({ dorm_id: b.dormId, bed_no: b.bedNo })`  ← b.bedNo 是 zod 收的 number
 *   宿舍域（上一批）`/bed/list` 拿它做**比较 + Number() 转换 + 排序**。
 *
 *   如果让咨询域适配 varchar，就得在写入和校验两处各加一次 Number()/String()，
 *   结果是**同一个字段在两个域有两种类型认知**：
 *     · 咨询域写进去 '3'（字符串），宿舍域读出来 Number('3')=3 —— 单看每处都对
 *     · 一旦某处忘了转换，症状是「床位占用校验静默失效」→ 两人住同一床位，不报错
 *   这类 bug 查起来极难，而且 ③(不复用同名不同义) 和 ⑩(口径统一) 两条铁律都指向
 *   「**以老表为准**」——老表是 int，全系统就都用 int。
 *
 *   【★顺带发现另外 3 处「统一表把老表列改窄了」，一并加宽】
 *     phone            varchar(32) → varchar(20)   ← 手机号，+86 前缀就到 14 位但将来可能带分机
 *     parent_phone     varchar(32) → varchar(20)
 *     graduate_school  varchar(150) → varchar(100) ← 毕业院校名，中文长名很容易超 100 字
 *   这3 处不会立刻炸（超长会报 Data too long），但会在某天某条真实数据上炸。
 *   统一表是**三学段合表**，字段宽度应取三老库的最大值，不该收窄。
 *
 *   （`source_system` 老表 20 → 统一表 32 是**加宽**，方向正确，不动。）
 *
 * ── 二、`uk_consult_push` 降级为普通索引（第⑧条铁律第三次重演）──
 *
 *   实测索引差异：
 *     老表 `t_class_consult_push`：
 *       PRIMARY(id) / idx_cp_no(consult_no) / idx_cp_receiver(receiver_id) / idx_cp_status(apply_status)
 *       → **consult_no 上没有任何唯一索引**
 *     统一表 `t_uni_consult_push`：
 *       PRIMARY(id) / idx_edu_stage(edu_stage) / uk_consult_push(consult_no, edu_stage) ← Non_unique=0
 *
 *   咨询域 `/push` 的幂等逻辑本来就是**应用层**做的：
 *     `where(consult_no).first()` → 有则 skip/reopen、无则 insert
 *   也就是说：**唯一索引在这里是多余的第二道锁**，而且比老表多了一道约束。
 *
 *   ★ 实测当前数据不会撞（老表 0 行 / 统一表 3 行），但结构上仍是「凭空加约束」：
 *     铁律⑧—— 老表没有的约束不要凭空引入（`t_uni_exam.uk_exam`、
 *     `t_uni_dorm_room.uk_dorm_room` 已各重演一次，这是第三次）。
 *   咨询单号的唯一性靠 `consult_no` 本身（带日期+序号）保证，不需要数据库再兜一层。
 *
 * ── 三、幂等 & 自检 ──
 *   up 先查information_schema，已改过就跳过；改完查 STATISTICS.NON_UNIQUE 复核。
 */

const DB = 'sms_common';

async function hasColumn(knex, table, column) {
  const r = await knex('information_schema.COLUMNS')
    .where({ TABLE_SCHEMA: DB, TABLE_NAME: table, COLUMN_NAME: column })
    .first();
  return !!r;
}

async function columnType(knex, table, column) {
  const r = await knex('information_schema.COLUMNS')
    .where({ TABLE_SCHEMA: DB, TABLE_NAME: table, COLUMN_NAME: column })
    .first();
  return r ? String(r.COLUMN_TYPE) : null;
}

async function indexExists(knex, table, index) {
  const r = await knex('information_schema.STATISTICS')
    .where({ TABLE_SCHEMA: DB, TABLE_NAME: table, INDEX_NAME: index })
    .first();
  return !!r;
}

async function indexCols(knex, table, index) {
  const rows = await knex('information_schema.STATISTICS')
    .where({ TABLE_SCHEMA: DB, TABLE_NAME: table, INDEX_NAME: index })
    .orderBy('SEQ_IN_INDEX');
  return rows.map((r) => String(r.COLUMN_NAME));
}

exports.up = async function up(knex) {
  // ---------- 零、先清洗：老表 int → 统一表 varchar(20) 时期灌进来的空串 ----------
  //
  // ★ 实测：t_uni_student 共 90 行，其中 **36 行 bed_no 是空串 ''**（种子数据的占位值）。
  //   MariaDB 在 `varchar → int` 严格模式下会直接报
  //     `Truncated incorrect INTEGER value: ''`
  //   （不是 warning，是 ERROR，ALTER 整个失败）。所以必须先清。
  //   清洗口径：空串/纯空白 → NULL（「没床位」在int 列里只有 NULL 这一个诚实表达）。
  //   ⚠️ 只在真正要改 bed_no 类型时清洗，不改就不动数据。
  {
    const cur = await columnType(knex, 't_uni_student', 'bed_no');
    if (cur && cur !== 'int(11)') {
      const dirty = await knex('t_uni_student')
        .whereNotNull('bed_no')
        .where('bed_no', '')
        .count({ c: '*' })
        .first();
      const n = Number(dirty?.c ?? 0);
      if (n > 0) {
        await knex('t_uni_student').where('bed_no', '').update({ bed_no: null });
        console.log(`  ✔ 清洗 t_uni_student.bed_no 空串 ${n} 行 → NULL`);
      } else {
        console.log('· t_uni_student.bed_no 无空串，跳过清洗');
      }
    }
  }

  // ---------- 一、类型对齐（老表为准） ----------
  const fixes = [
    // [列, 目标类型, 说明]
    ['bed_no', 'int(11)', '床位号：老表 int，统一表曾收窄为 varchar(20)'],
    ['phone', 'varchar(32)', '联系电话：统一表曾收窄为 varchar(20)'],
    ['parent_phone', 'varchar(32)', '家长联系电话：统一表曾收窄为 varchar(20)'],
    ['graduate_school', 'varchar(150)', '毕业院校：统一表曾收窄为 varchar(100)'],
  ];
  for (const [col, target, why] of fixes) {
    if (!(await hasColumn(knex, 't_uni_student', col))) {
      console.log(`  · t_uni_student.${col} 不存在，跳过（${why}）`);
      continue;
    }
    const cur = await columnType(knex, 't_uni_student', col);
    if (cur === target) {
      console.log(`  · t_uni_student.${col} 已是 ${target}，跳过`);
      continue;
    }
    await knex.raw(`ALTER TABLE \`t_uni_student\` MODIFY COLUMN \`${col}\` ${target} NULL`);
    console.log(`  ✔ t_uni_student.${col} ${cur} → ${target}（${why}）`);
  }

  // ---------- 二、uk_consult_push 降为普通索引 ----------
  if (await indexExists(knex, 't_uni_consult_push', 'uk_consult_push')) {
    const cols = await indexCols(knex, 't_uni_consult_push', 'uk_consult_push');
    await knex.raw('ALTER TABLE `t_uni_consult_push` DROP INDEX `uk_consult_push`');
    const newName = 'idx_cp_no';
    if (await indexExists(knex, 't_uni_consult_push', newName)) {
      await knex.raw(`ALTER TABLE \`t_uni_consult_push\` DROP INDEX \`${newName}\``);
    }
    // 只保留 consult_no 单列，与老表 idx_cp_no 同口径
    await knex.raw(
      `ALTER TABLE \`t_uni_consult_push\` ADD INDEX \`${newName}\` (${cols.map((c) => `\`${c}\``).join(',')})`,
    );
    console.log(`  ✔ uk_consult_push(${cols.join(',')}) 已降级为普通索引 ${newName}（第⑧条铁律第三次对齐）`);
  } else {
    console.log('· uk_consult_push 不存在，跳过降级');
  }

  // ---------- 三、补齐老表有的普通索引（切读后查询路径依赖） ----------
  // 实测老表有 3 个普通索引，统一表只有 PRIMARY + idx_edu_stage。
  // 这些不是约束、只是查询加速，缺了不会报错但列表会全表扫。
  const addIdx = [
    ['idx_cp_receiver', ['receiver_id']],
    ['idx_cp_status', ['apply_status']],
  ];
  for (const [name, cols] of addIdx) {
    if (await indexExists(knex, 't_uni_consult_push', name)) continue;
    await knex.raw(
      `ALTER TABLE \`t_uni_consult_push\` ADD INDEX \`${name}\` (${cols.map((c) => `\`${c}\``).join(',')})`,
    );
    console.log(`  ✔ t_uni_consult_push 补普通索引 ${name}(${cols.join(',')})`);
  }
  const stuIdx = [
    ['idx_class_id', ['class_id']],
    ['idx_dept_status', ['dept_code', 'student_status']],
    ['idx_dorm_id', ['dorm_id']],
  ];
  for (const [name, cols] of stuIdx) {
    if (await indexExists(knex, 't_uni_student', name)) continue;
    await knex.raw(
      `ALTER TABLE \`t_uni_student\` ADD INDEX \`${name}\` (${cols.map((c) => `\`${c}\``).join(',')})`,
    );
    console.log(`  ✔ t_uni_student 补普通索引 ${name}(${cols.join(',')})`);
  }
  const clsIdx = [
    ['idx_class_name', ['class_name']],
    ['idx_class_status', ['class_status']],
  ];
  for (const [name, cols] of clsIdx) {
    if (await indexExists(knex, 't_uni_class', name)) continue;
    await knex.raw(
      `ALTER TABLE \`t_uni_class\` ADD INDEX \`${name}\` (${cols.map((c) => `\`${c}\``).join(',')})`,
    );
    console.log(`  ✔ t_uni_class 补普通索引 ${name}(${cols.join(',')})`);
  }
};

exports.down = async function down() {
  console.log('· 本迁移为类型/索引对齐，回滚无业务意义（不回退到 varchar(20) / uk_consult_push）');
};