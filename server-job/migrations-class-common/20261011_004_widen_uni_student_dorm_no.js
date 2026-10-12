/**
 * 第 4 期 · 第 7 批（2026-10-11 · 成绩域）：加宽 t_uni_student.dorm_no
 * ============================================================
 *
 * 【本批成绩域 5 张表实测「零缺列、零类型冲突」，不需要补列】
 *   t_class_grade(20) → t_uni_exam_score(39)缺 0
 *   t_class_exam  (14) → t_uni_exam     (27) 缺 0
 *   t_class_student(57) / t_class_info(25) / t_class_consult_push(35) → 上批已对齐
 * → 迁移 003 修的`bed_no → int(11)` 本批直接受益，成绩域的「床位占用校验」口径与宿舍域一致了。
 *
 * ── 唯一要动的一列：`t_uni_student.dorm_no` ──
 *
 *   实测：
 *     sms_class.t_class_student.dorm_no  = varchar(64) NULL
 *     sms_common.t_uni_student.dorm_no= varchar(20) NULL
 *
 *   实测当前最长值 5 位（`CHAR_LENGTH` 最大 5、共 54 行有值）→ **现在还没炸**，
 *   但老表给到 64 是有理由的：实训那侧房间号带栋/层/铺位前缀（如「A栋-301-上铺」），
 *   统一表是三学段合表，**宽度应取三老库最大值**，不该收窄。
 *   与迁移 003 对 phone / parent_phone / graduate_school 的处理是同一个口径。
 *
 * ── 幂等 & 自检 ──
 *   up 先查 information_schema，已是目标宽度就跳过；改完回查类型。
 */

const DB = 'sms_common';

async function columnType(knex, table, column) {
  const r = await knex('information_schema.COLUMNS')
    .where({ TABLE_SCHEMA: DB, TABLE_NAME: table, COLUMN_NAME: column })
    .first();
  return r ? String(r.COLUMN_TYPE) : null;
}

exports.up = async function up(knex) {
  const cur = await columnType(knex, 't_uni_student', 'dorm_no');
  if (!cur) {
    console.log('· t_uni_student.dorm_no 不存在，跳过');
    return;
  }
  if (cur === 'varchar(64)') {
    console.log('· t_uni_student.dorm_no 已是 varchar(64)，跳过');
    return;
  }
  await knex.raw('ALTER TABLE `t_uni_student` MODIFY COLUMN `dorm_no` varchar(64) NULL');
  console.log(`  ✔ t_uni_student.dorm_no ${cur} → varchar(64)（对齐老表 varchar(64)）`);
};

exports.down = async function down() {
  console.log('· 本迁移为列宽对齐，回滚无业务意义');
};