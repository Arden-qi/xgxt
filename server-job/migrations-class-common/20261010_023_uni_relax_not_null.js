/**
 * 第 4 期 · 步骤 2c：统一表「NOT NULL 但源表没有」的列改为可空
 * ============================================================
 *
 * 【★★ 切读第一轮就炸出来的真问题（不是测试写错）】
 *   统一表把三学段的表合并成一张 → 建表时用「**三张源表列的并集**」当列集，
 *   但**可空性却按「最严的那张」来定**，于是产生一批
 *   「NOT NULL 却只有部分学段才有」的列。
 *
 *   实测（脚本 `_p4-null-audit.cjs`）20 处，最典型的一个：
 *     `t_uni_exam.exam_time datetime NOT NULL`
 *       初高 `t_class_exam`  没有这一列（用 exam_date 就够了）
 *       大学 `t_class_exam`  没有这一列
 *       实训 `t_job_exam`    有这一列
 *     → 建初高的考试单时，仓储不可能塞一个「本学段压根不存在的字段」，
 *       insert 直接报 `Field 'exam_time' doesn't have a default value`。
 *
 *   ⚠️ 这个报错长得极像「迁移脚本没跑」，极具误导性
 *     （errorHandler 把 ER_BAD_FIELD_ERROR 统一翻译成「数据库字段不存在」）。
 *     实际上字段是存在的，问题是**它被要求必须有值**。
 *
 * 【为什么改成 NULL 而不是「给默认值」】
 *   给默认值意味着「初高的考试时间默认记成 0000-00-00」——
 *   数据看着齐了，其实全是假的，前端还会把它显示出来。
 *   → **列不存在 = 这一行本来就没这个信息 = 存 NULL 是诚实表达**。
 *   （这与铁律③「NOT NULL 一律给默认」相反，但那条针对的是「值已知只是没传」；
 *     这里的情况是「**这一行天生就没有这个概念**」，性质不同。）
 *
 * 【★ edu_stage 故意保持 NOT NULL 无默认值】
 *   学段是统一表的**自有列**，每一行都必须有值。
 *   忘了传就让它当场报错（而不是静默写成 'jh'）——
 *   这正是迁移 20261010_022 去掉 `DEFAULT 'jh'` 的目的。
 *
 * 【幂等】先查是否已是可空，是则跳过。
 * 【代价】仅改可空性，不动数据（各表 0~12 行自检数据）。
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

/** 统一表 → 各学段源表（用于动态判断「是否所有源表都有这一列」） */
const SOURCES = {
  t_uni_class: [
    ['sms_class_jh', 't_class_info'],
    ['sms_class', 't_class_info'],
    ['sms_job', 't_job_class'],
  ],
  t_uni_student: [
    ['sms_class_jh', 't_class_student'],
    ['sms_class', 't_class_student'],
    ['sms_job', 't_student_base'],
  ],
  t_uni_class_student: [['sms_job', 't_job_class_student']],
  t_uni_attendance: [
    ['sms_class_jh', 't_class_attendance'],
    ['sms_class', 't_class_attendance'],
  ],
  t_uni_exam: [
    ['sms_class_jh', 't_class_exam'],
    ['sms_class', 't_class_exam'],
    ['sms_job', 't_job_exam'],
  ],
  t_uni_exam_field: [
    ['sms_class_jh', 't_class_exam_field'],
    ['sms_class', 't_class_exam_field'],
  ],
  t_uni_repeat: [
    ['sms_class_jh', 't_class_repeat'],
    ['sms_class', 't_class_repeat'],
  ],
  t_uni_dorm_apply: [
    ['sms_class_jh', 't_class_dorm_apply'],
    ['sms_class', 't_class_dorm_apply'],
  ],
};

/**
 * ★ 统一表自有列（不是任何源表的同名列）—— 不参与「源表是否都有」判断
 *   - edu_stage：学段标识，统一表新增
 *   - stage_code：对应源表的**阶段码**，源表里叫 `stage`（列名不同但概念相同）
 *   - student_count_cached：第 4 期新增的缓存列
 */
const UNI_OWNED = new Set(['edu_stage', 'stage_code', 'student_count_cached']);

const up = async function (knex) {
  /** 某库某表的列名集合 */
  async function colsOf(schema, table) {
    const rows = await knex('information_schema.COLUMNS')
      .select('COLUMN_NAME as cn')
      .where('TABLE_SCHEMA', schema)
      .where('TABLE_NAME', table);
    return new Set(rows.map((r) => r.cn));
  }

  for (const uni of TABLES) {
    /* 统一表列清单 */
    const uniCols = await knex('information_schema.COLUMNS')
      .select('COLUMN_NAME as cn', 'COLUMN_TYPE as ct', 'IS_NULLABLE as nl')
      .where('TABLE_SCHEMA', 'sms_common')
      .where('TABLE_NAME', uni);

    /* 各源表的列名集合 */
    const srcSets = [];
    for (const [schema, table] of SOURCES[uni]) {
      srcSets.push(await colsOf(schema, table));
    }

    for (const c of uniCols) {
      if (c.nl !== 'NO') continue; // 已经可空
      if (c.cn === 'id') continue; // 主键
      if (UNI_OWNED.has(c.cn)) continue; // 统一表自有列

      /* ★ 只有「并非所有源表都有」的列才需要放开 */
      const missing = srcSets.some((s) => !s.has(c.cn));
      if (!missing) continue;

      await knex.raw(
        'ALTER TABLE `' + uni + '` MODIFY `' + c.cn + '` ' + c.ct + ' NULL DEFAULT NULL',
      );
      console.log('  ✔ ' + uni + '.' + c.cn + ' → NULL  ' + c.ct);
    }
  }
};

const down = async function () {
  throw new Error('不可回滚：可空性放开后无法判断哪些列原本是 NOT NULL 且源表都有');
};

module.exports = { up, down };
