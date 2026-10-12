/**
 * 2026-10-05 斌哥拍板：大学部（sms_class）宿舍信息要进教务「宿舍总名单」
 *
 * 【背景】三库宿舍结构完全不同：
 *   - sms_edu 教务：有房间表 t_edu_dorm_room + 床位表 t_edu_dorm_bed
 *   - sms_job 实训：有房间表 t_job_dorm + 床位表 t_job_dorm_bed
 *   - sms_class 大学部：**两者都没有**，宿舍信息直接存在学生表字段上
 *     （dorm_no=房间号 / bed_no=床位序号 / dorm_id）
 *
 * 【本次方案 = A：只读聚合，不建表】
 *   总名单查询时从 t_class_student 动态按 dorm_no 分组成「间」，
 *   数据仍只存在学生表上，宿舍总名单这边只读、不反写。
 *   代价：① 空床位看不到（没住人的床不会凭空出现）
 *        ② 额定人数不可改（按该间实际最高床位序号推算）
 *
 * 【为什么要加 dorm_building 字段】
 *   原来 dorm_no 是 201/301 这种三段式，第一位隐含楼栋但表里没这一列，
 *   拼不出「宿舍楼」。斌哥要求「添加宿舍楼字段」→ 这里补一列并按首位回填。
 *   以后班主任维护宿舍时楼栋可改，不再依赖推导。
 *
 * 【顺带把 bed_no 语义对齐教务】
 *   大学部 bed_no 存的是纯序号 1/2/3/4，
 *   而全项目约定是「奇上偶下」→ 1=1上 / 2=1下 / 3=2上 / 4=2下。
 *   转换在查询时做（纯读），**不改存量数据**——
 *   因为 8003 那边也在用这个字段，改了会破坏对方的展示。
 */

const TABLE = 't_class_student';

exports.up = async function up(knex) {
  const exists = await knex.schema.hasTable(TABLE);
  if (!exists) return;

  // ---- ① 加 dorm_building（宿舍楼）----
  if (!(await knex.schema.hasColumn(TABLE, 'dorm_building'))) {
    await knex.schema.alterTable(TABLE, (t) => {
      t.string('dorm_building', 64).nullable().comment('宿舍楼（如 2号楼）；按 dorm_no 首位回填');
    });
  }

  // ---- ② 按 dorm_no 首位回填宿舍楼 ----
  //   201/202/203 → 2号楼    301/302/303 → 3号楼    401/402 → 4号楼
  //   只处理「还没楼栋」的行；dorm_no 为空或非数字的行跳过。
  //   ⚠️ 不能写 .whereNot('dorm_building','') —— 新加的列全是 NULL，
  //   而 SQL 里 NULL <> '' 不成立，会导致一条都选不出来（回填 0 行）。
  const rows = await knex(TABLE)
    .where('is_deleted', 0)
    .whereNotNull('dorm_no')
    .select('id', 'dorm_no', 'dorm_building');

  for (const r of rows) {
    if (r.dorm_building) continue;
    const m = String(r.dorm_no || '').match(/^(\d)/);
    if (!m) continue;
    await knex(TABLE)
      .where('id', r.id)
      .update({ dorm_building: `${m[1]}号楼` });
  }
};

exports.down = async function down(knex) {
  const exists = await knex.schema.hasTable(TABLE);
  if (!exists) return;
  if (await knex.schema.hasColumn(TABLE, 'dorm_building')) {
    await knex.schema.alterTable(TABLE, (t) => t.dropColumn('dorm_building'));
  }
};
