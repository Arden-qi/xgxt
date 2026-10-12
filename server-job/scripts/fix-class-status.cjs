/**
 * ★ 2026-10-05 一次性数据修复：把「已退学/休学」的人在class 库的状态对齐过来
 *
 * 【为什么需要】
 *   退学/休学原来只改 sms_job.t_student_base，class 库那份还停在「实训中(8)」。
 *   代码侧已加跨库同步（治本，只管以后），**存量**要一次性对齐。
 *
 * 【只改哪两种状态 —— 这是安全底线】
 *   只把 class 库状态改成「离开类」的（6休学 / 7退学），也就是
 *     class库=8实训中 且job库∈{6,7}  →  class库改成 job 库那个值
 *   绝对**不动**「9待就业 / 10已就业 ←→ 8实训中」那 15 条：
 *   那是「结业转就业」后的正常差异（实测确认），改了反而是错。
 *
 * 用法：node scripts/fix-class-status.cjs          # 先预览，不改
 *      node scripts/fix-class-status.cjs --apply   # 真改
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
/** 离开类状态：休学(6) / 退学(7) */
const LEFT_STATUS = [6, 7];

(async () => {
  const job = await knex('sms_job.t_student_base')
    .where('is_deleted', false)
    .whereIn('student_status', LEFT_STATUS)
    .select('student_no', 'student_name', 'student_status', 'update_time');

  console.log(`job库里「休学/退学」的学生共 ${job.length} 人\n`);

  const toFix = [];
  for (const j of job) {
    const no = String(j.student_no || '').trim();
    if (!no) continue;
    const c = await knex('sms_class.t_class_student')
      .where({ student_no: no, is_deleted: false })
      .first();
    if (!c) { console.log(`- ${j.student_name}(${no}) class库没有这个人，跳过`); continue; }
    if (Number(c.student_status) === Number(j.student_status)) continue;
    // ★ 安全闸：只改「class还在实训中(8)」这种明确过时的
    if (Number(c.student_status) !== 8) {
      console.log(`- ${j.student_name}(${no}) class库状态是 ${c.student_status}（不是实训中8），不动`);
      continue;
    }
    toFix.push({ no, name: j.student_name, from: c.student_status, to: j.student_status });
  }

  console.log('\n=== 待修清单 ===');
  console.table(toFix);
  if (!toFix.length) { console.log('没有需要修的数据'); await knex.destroy(); return; }

  if (!APPLY) {
    console.log('（预览模式，未改任何数据。确认无误后加 --apply 真改）');
    await knex.destroy();
    return;
  }

  for (const f of toFix) {
    const n = await knex('sms_class.t_class_student')
      .where({ student_no: f.no, is_deleted: false, student_status: f.from })
      .update({ student_status: f.to, update_time: new Date(), update_by: 'fix-20261005' });
    console.log(`✓ ${f.name}(${f.no}) ${f.from} → ${f.to}（${n} 行）`);
  }
  await knex.destroy();
})().catch(async (e) => { console.error(e); await knex.destroy(); process.exit(1); });
