/**
 * 2026-10-04 斌哥拍板：班级统一管理 5 个岗位 + 班级号统一为 Q+数字
 *
 * ============================================================
 * 【背景】斌哥要求：
 *   ① 班主任（大学部）与项目经理（实训/就业）分开
 *   ② 实训班级与大学部统一 —— 升实训时【不新建班】，同一个班延续
 *      （大学 U01 → 升实训后还是 U01，只是阶段变了）
 *   ③ 班级编号统一为「Q + 数字」（就业也属于大学部）
 *   ④ 建班时把 5 个岗位一次定好：班主任 / 教员 / 助教 / 项目经理 / 就业指导老师
 *      定好后照此执行，换人走「班级交接」功能
 *
 * 【为什么加字段】原来只有 head_teacher / teacher / assistant 三个岗位，
 *   没有「项目经理」和「就业指导老师」—— 而升实训后带的班要交给项目经理。
 *
 * 【class_code 规范化】原来 U01~U06 是纯字母，学号式编码；现在统一成 Q+数字
 *   （Q1 / Q2 / …），两边（sms_class 与 sms_job）用同一套编号，靠它关联。
 */

const TABLE = 't_job_class';

/** 岗位字段：列名 → 说明 */
const POST_FIELDS = [
  ['project_manager_id', '项目经理ID（实训阶段接手人）'],
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

  // ---- 回填 university_no：Q + 原 class_name 里的数字 ----
  // U01 → Q1、U02 → Q2 …；已经是 Q 开头的保持不变
  const rows = await knex(TABLE).where('is_deleted', 0).select('id', 'class_name', 'class_code');
  for (const r of rows) {
    if (r.university_no) continue;
    const m = String(r.class_name || r.class_code || '').match(/(\d+)/);
    // ⚠️ 必须要求原名【以字母开头 + 紧跟数字】（U01 / Q1 这种）才算可推导。
    //   否则「实训一期1班」「实训四期2班」这类中文名也会被匹配到"1"/"2"，
    //   全被填成 Q1 —— 演示班本来就不该有统一编号（它们没有大学来源），
    //   保持 NULL，等真升上来的班再填。
    const src = String(r.class_name || '');
    if (!/^[A-Za-z]+\d+$/.test(src)) continue;
    if (!m) continue;
    await knex(TABLE).where('id', r.id).update({ university_no: `Q${Number(m[1])}` });
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
