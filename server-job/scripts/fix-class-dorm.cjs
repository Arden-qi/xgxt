/**
 * ★ 2026-10-05 一次性数据修复：清掉「已退宿/已退学」的人在class 库残留的床位字段
 *
 * 【背景】斌哥报：「子墨已经退学，且已经退宿，所以此时教务不应该记录床铺」
 *   查出来是：退宿流程只清了 sms_job（学生主档 dorm_id/dorm_no + 床位表），
 *   但**漏了 sms_class.t_class_student 的 dorm_building/dorm_no/bed_no**。
 *   而「宿舍总名单」里大学部那一路**正是从这三个字段动态聚合出来的**
 *   → 已退宿的人仍显示占着床。
 *
 * 【判据 —— 斌哥 2026-10-05 拍板：只清「已退学/休学」的人】
 *   三个条件**同时**满足才清：
 *     ① class 库状态 ∈ {6休学, 7退学}   ← ★ 硬门槛（斌哥定的）
 *     ② job 库床位表里已经没有他的记录（床位真的释放了）
 *     ③ job 库学生主档 dorm_id 为空
 *
 *   ⚠️ 为什么加门槛①：首轮扫描（只按②③）捞出 12 人，但其中 11 人状态还是
 *     「5正式在读 / 8实训中」—— 那些是**大学部在读的学生**（冯雪晴、方语嫣等），
 *     job 库里查无此人属正常（他们还没升实训），床位很可能是真的。
 *     按②③一刀切会误清。斌哥拍板：**只清退学/休学的**。
 *
 * 用法：node scripts/fix-class-dorm.cjs          # 先预览，不改
 *      node scripts/fix-class-dorm.cjs --apply   # 真改
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const knex = require('knex')({
  client: 'mysql2',
  connection: {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
  },
});

const APPLY = process.argv.includes('--apply');
const CLR = { dorm_id: null, dorm_building: null, dorm_no: null, bed_no: null };

(async () => {
  // class 库里「还挂着床」的人
  const classWithDorm = await knex('sms_class.t_class_student')
    .where('is_deleted', false)
    .whereNotNull('dorm_no')
    .whereNot('dorm_no', '')
    .select('student_no', 'student_name', 'student_status', 'dorm_id', 'dorm_building', 'dorm_no', 'bed_no');
  console.log(`class库里「挂着床位」的学生共 ${classWithDorm.length} 人\n`);

  const toFix = [];
  const keep = [];
  for (const c of classWithDorm) {
    const no = String(c.student_no || '').trim();
    if (!no) { keep.push({ ...c, why: '无学号，跳过' }); continue; }

    // 条件①：job 库床位表里已经没有他
    const bed = await knex('t_job_dorm_bed')
      .where({ student_no: no, is_deleted: false })
      .first();
    // 条件②：job 库学生主档 dorm_id 为空
    const stu = await knex('t_student_base').where({ student_no: no, is_deleted: false }).first();

    const noBed = !bed;
    const noDorm = !stu || !stu.dorm_id;
    // ★ 硬门槛：只有「已退学(7)/休学(6)」才清（斌哥 2026-10-05 拍板）
    const isLeft = [6, 7].includes(Number(c.student_status));
    const row = {
      no, name: c.student_name, status: c.student_status,
      at: `${c.dorm_building || '?'}/${c.dorm_no || '?'}/床${c.bed_no ?? '?'}`,
      bed: bed ? `${bed.dorm_no}/床${bed.bed_no}` : '（无）',
      stuDorm: stu ? stu.dorm_id : '（查无此人）',
    };
    if (isLeft && noBed && noDorm) toFix.push({ ...row, why: '已退学/休学 + 床位已释放' });
    else if (!isLeft) keep.push({ ...row, why: `状态非退学/休学（${c.student_status}），不动` });
    else keep.push({ ...row, why: `床位${bed ? '仍占用' : '无'}／主档dorm_id=${row.stuDorm}` });
  }

  console.log('=== 待清（已不住宿舍，应清掉 class 库床位）===');
  console.table(toFix);
  if (!toFix.length) { console.log('没有需要清的'); }

  console.log('\n=== 保留（确实还住着，或条件不满足）===');
  console.table(keep);

  if (!toFix.length) { await knex.destroy(); return; }
  if (!APPLY) {
    console.log('\n（预览模式，未改数据。确认无误后加 --apply 真改）');
    await knex.destroy();
    return;
  }
  for (const f of toFix) {
    const n = await knex('sms_class.t_class_student')
      .where({ student_no: f.no, is_deleted: false })
      .update({ ...CLR, update_time: new Date(), update_by: 'fix-20261005' });
    console.log(`✓ ${f.name}(${f.no}) 清掉 ${f.at}（${n} 行）`);
  }
  await knex.destroy();
})().catch(async (e) => { console.error(e); await knex.destroy(); process.exit(1); });
