/**
 * ★ 2026-10-05 一次性排查脚本：找「同学号在job 库和 class 库状态不一致」的脏数据
 * 用途：斌哥报「子墨退学后教务还显示实训中」→ 治本同步只能管以后，
 *      存量不一致的要一次性对齐。本脚本只 SELECT，不改数据。
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

const JOB = 'sms_job.t_student_base';
const CLS = 'sms_class.t_class_student';
const EDU = 'sms_edu.t_student_base';

(async () => {
  const job = await knex(JOB).where('is_deleted', false).select('student_no', 'student_name', 'student_status', 'update_time');
  const cls = await knex(CLS).where('is_deleted', false).select('student_no', 'student_name', 'student_status', 'update_time');
  const edu = await knex(EDU).where('is_deleted', false).select('student_no', 'student_name', 'student_status', 'update_time');

  const idx = (rows) => {
    const m = new Map();
    for (const r of rows) {
      const k = String(r.student_no || '').trim();
      if (!k) continue;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    }
    return m;
  };
  const jM = idx(job), cM = idx(cls), eM = idx(edu);

  const all = new Set([...jM.keys(), ...cM.keys(), ...eM.keys()]);
  const diff = [];
  for (const no of all) {
    const j = (jM.get(no) || [])[0];
    const c = (cM.get(no) || [])[0];
    const e = (eM.get(no) || [])[0];
    const sts = [j, c, e].filter(Boolean).map((x) => Number(x.student_status));
    const uniq = [...new Set(sts)];
    if (uniq.length > 1) {
      diff.push({ no, name: (j || c || e).student_name, job: j ? j.student_status : null, class: c ? c.student_status : null, edu: e ? e.student_status : null });
    }
  }
  console.log('=== 状态不一致的学号 ===');
  console.table(diff);
  console.log('不一致条数:', diff.length);
  console.log('job库人数:', job.length, ' class库:', cls.length, ' edu库:', edu.length);
  await knex.destroy();
})().catch(async (e) => { console.error(e); await knex.destroy(); process.exit(1); });
