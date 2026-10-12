/**
 * 第 4 期第 10 批（2026-10-12 · 出勤/通知/催费/费用 四域收尾）结构对齐
 *
 * 本迁移做四件事，全部是「对齐老表」，不新增业务语义：
 *
 * 1) 新建 `t_uni_urge`（26 列）—— 催费**副本**表
 *    【为什么必须新建，而不能塞进 t_uni_urge_log】
 *      老表有两张语义完全不同的表：
 *        `sms_class.t_class_urge_sync`（26 列）= 教务推来的**催费副本**
 *          字段语义：某学生欠多少钱（fee_type/amount/expire_date/pay_status）
 *          + 催了几次（urge_count/last_urge_time）
 *        `sms_class.t_class_urge_log`  （15 列）= **催费动作流水**
 *          字段语义：谁在什么时候用什么渠道催了（channel/operator_id/urge_time）
 *      实测：t_uni_urge_log 60 行的 student_id 挂 t_uni_fee.id 命中 0
 *      → 两张表不是同一件事。
 *      塞进一张表会违反归一铁律④（两个不同问题挤一表），
 *      而且催费副本是「每个学生一条」、流水是「每次催收一条」，
 *      混表会让记录随催收次数无限膨胀。
 *
 * 2) `t_uni_fee` 补 5 列 —— 缴费同步接口要写，老表有
 *      source_batch_no / source_update_time / sync_status / paid_amount / pay_method
 *    【amount 不补列，走列名映射】
 *      老表 `amount` = 统一表 `fee_amount`（同一件事，两个名字），
 *      在 `UNI_COL_RENAME` 里登记，避免凭空加一列重复金额。
 *
 * 3) `t_uni_attendance_detail.phone` 加宽 varchar(20) → varchar(32)
 *    对齐老表 `t_class_attendance_absent.phone varchar(32)`。
 *
 * 4) 不建任何唯一索引（铁律⑧：老表没有的约束不引入）。
 *    t_uni_attendance_detail 已有 uk(attendance_id,student_id,edu_stage)，
 *    t_uni_attendance / t_uni_notify / t_uni_urge_log 只有主键 + idx_edu_stage，
 *    本批全部保持原样。
 */

const T = 'sms_common';

/** t_class_urge_sync 的 26 列 → t_uni_urge 的列定义 */
const URGE_COLS = [
  ['id', 'varchar(36)', 'NO', null],
  ['edu_stage', 'varchar(16)', 'NO', null],
  ['stage_code', 'int(11)', 'YES', null],
  ['student_id', 'varchar(36)', 'NO', null],
  ['student_no', 'varchar(32)', 'NO', null],
  ['student_name', 'varchar(50)', 'NO', null],
  ['class_id', 'varchar(36)', 'YES', null],
  ['class_name', 'varchar(50)', 'YES', null],
  ['phone', 'varchar(32)', 'YES', null],
  ['parent_phone', 'varchar(32)', 'YES', null],
  ['head_teacher_id', 'varchar(36)', 'YES', null],
  ['head_teacher_name', 'varchar(50)', 'YES', null],
  ['fee_type', 'int(11)', 'NO', null],
  ['amount', 'bigint(20)', 'NO', null],
  ['expire_date', 'date', 'NO', null],
  ['pay_status', 'int(11)', 'NO', null],
  ['urge_count', 'int(11)', 'NO', null],
  ['last_urge_time', 'datetime', 'YES', null],
  ['source_system', 'varchar(20)', 'NO', null],
  ['source_id', 'varchar(64)', 'NO', null],
  ['source_batch_no', 'varchar(40)', 'YES', null],
  ['source_update_time', 'datetime', 'YES', null],
  ['sync_status', 'int(11)', 'NO', null],
  ['is_deleted', 'tinyint(1)', 'NO', '0'],
  ['create_by', 'varchar(36)', 'YES', null],
  ['create_time', 'datetime', 'NO', null],
  ['update_by', 'varchar(36)', 'YES', null],
  ['update_time', 'datetime', 'YES', null],
];

exports.up = async function up(knex) {
  // ---------- 1) 新建 t_uni_urge ----------
  const hasUrge = await knex.schema.hasTable('t_uni_urge');
  if (hasUrge) {
    console.log('  · t_uni_urge 已存在，跳过建表');
  } else {
    await knex.schema.createTable(`${T}.t_uni_urge`, (t) => {
      for (const [name, type, nullable, def] of URGE_COLS) {
        const col = t.specificType(name, type);
        if (nullable === 'YES') col.nullable();
        else col.notNullable();
        if (def !== null) col.defaultTo(def);
      }
      t.primary(['id']);
      // 查询主路径：催费列表按edu_stage + 状态筛
      t.index(['edu_stage'], 'idx_edu_stage');
      // 幂等键路径：/sync 是「先查后写」，按 (source_system, source_id) 查
      // ★ 用普通索引而非唯一索引（铁律⑧：老表没有 UNIQUE 约束，不凭空加）
      t.index(['source_system', 'source_id'], 'idx_source');
      // 同步接口的 FULL 模式要按 source_system + is_deleted 批量软删
      t.index(['source_system', 'is_deleted'], 'idx_sync');
    });
    console.log('  · 已建t_uni_urge（27 列：26 业务列 + stage_code）');
  }

  // ---------- 2) t_uni_fee 补 5 列 ----------
  // 【注意顺序：先 ADD COLUMN（都是可空，不碰类型转换），不做数据翻译】
  // amount → fee_amount 走 UNI_COL_RENAME，这里**不建 amount 列**
  const feeCols = [
    ['source_batch_no', 'varchar(40)'],
    ['source_update_time', 'datetime'],
    ['sync_status', 'int(11)'],
    ['paid_amount', 'bigint(20)'],
    ['pay_method', 'varchar(32)'],
  ];
  for (const [name, type] of feeCols) {
    const exists = await knex('information_schema.COLUMNS')
      .where({ TABLE_SCHEMA: T, TABLE_NAME: 't_uni_fee', COLUMN_NAME: name })
      .first();
    if (exists) {
      console.log(`  · t_uni_fee.${name} 已存在，跳过`);
      continue;
    }
    await knex.schema.alterTable(`${T}.t_uni_fee`, (t) => {
      t.specificType(name, type).nullable();
    });
    console.log(`  · t_uni_fee 加列 ${name} ${type}`);
  }

  // ---------- 3) phone 加宽 ----------
  // 【铁律：改类型前先确认现值不会丢】
  //   varchar(20) → varchar(32) 是**加宽**，MariaDB 直接改，不会截断已有值
  const [ph] = await knex('information_schema.COLUMNS')
    .where({ TABLE_SCHEMA: T, TABLE_NAME: 't_uni_attendance_detail', COLUMN_NAME: 'phone' })
    .select('COLUMN_TYPE');
  if (ph && ph.COLUMN_TYPE === 'varchar(20)') {
    await knex.raw(
      'ALTER TABLE `t_uni_attendance_detail` MODIFY COLUMN `phone` varchar(32) NULL',
    );
    console.log('  · t_uni_attendance_detail.phone 加宽到 varchar(32)');
  } else {
    console.log(`  · t_uni_attendance_detail.phone 已是 ${ph?.COLUMN_TYPE}，跳过`);
  }
};

exports.down = async function down(knex) {
  //只回滚本批新增的列，t_uni_urge 保留（避免误删数据）
  for (const name of ['source_batch_no', 'source_update_time', 'sync_status', 'paid_amount', 'pay_method']) {
    const exists = await knex('information_schema.COLUMNS')
      .where({ TABLE_SCHEMA: T, TABLE_NAME: 't_uni_fee', COLUMN_NAME: name })
      .first();
    if (exists) {
      await knex.schema.alterTable(`${T}.t_uni_fee`, (t) => t.dropColumn(name));
    }
  }
  console.log('  · 已回滚 t_uni_fee 的 5 个新增列（t_uni_urge 保留）');
};