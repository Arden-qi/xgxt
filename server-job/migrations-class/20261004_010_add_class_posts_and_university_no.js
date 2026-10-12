/**
 * 2026-10-04 斌哥拍板：班级（大学部）也加 5 个岗位字段 + 统一班级号
 *
 * 与 sms_job 的 20261004_018 对称 —— 两边班级表结构保持一致，
 * 升实训时才能「同一个班延续」（字段一一对得上，不用做字段映射）。
 *
 * 【为什么必须对称】升实训要把大学的班搬到实训库：
 *   如果两边字段名/结构不一致，搬的时候就得写一堆映射，
 *   而且以后加岗位要改两处。保持一致 = 搬运零改动。
 */

const TABLE = 't_class_info';

const POST_FIELDS = [
  ['project_manager_id', '项目经理ID（升实训后接手）'],
  ['project_manager_name', '项目经理姓名'],
  ['employment_teacher_id', '就业指导老师ID'],
  ['employment_teacher_name', '就业指导老师姓名'],
  ['university_no', '统一班级号（Q+数字，两库共用的唯一编号）'],
];

exports.up = async function up(knex) {
  const exists = await knex.schema.hasTable(TABLE);
  if (!exists) return;

  for (const [col] of POST_FIELDS) {
    if (await knex.schema.hasColumn(TABLE, col)) continue;
    await knex.schema.alterTable(TABLE, (t) => {
      t.string(col, 64).nullable().comment(col);
    });
  }

  // ---- 回填 university_no：U01 → Q1、U02 → Q2 … ----
  const rows = await knex(TABLE).where('is_deleted', 0).select('id', 'class_name');
  for (const r of rows) {
    if (r.university_no) continue;
    const m = String(r.class_name || '').match(/(\d+)/);
    if (m) {
      await knex(TABLE).where('id', r.id).update({ university_no: `Q${Number(m[1])}` });
    }
  }
};

exports.down = async function down(knex) {
  const exists = await knex.schema.hasTable(TABLE);
  if (!exists) return;
  for (const [col] of POST_FIELDS.slice().reverse()) {
    if (await knex.schema.hasColumn(TABLE, col)) {
      await knex.schema.alterTable(TABLE, (t) => t.dropColumn(col));
    }
  }
};
