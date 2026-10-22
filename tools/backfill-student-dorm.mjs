/**
 * 回填学生档案里的宿舍信息
 * ============================================================
 *
 * 背景：宿舍入住原来只写「操作时碰到的那张学生表」，学生档案读的是另一张投影
 * （学号相同、id 不同）。新逻辑已在入住/退宿/审批时按学号同步，
 * 但**历史在住数据**仍然是空的 —— 这个脚本按「已占床位」回填一次。
 *
 * 数据源：sms_job.t_job_dorm_bed（bed_status=2）+ sms_job.t_job_dorm（dorm_no）
 * 目标：所有带 dorm_id/dorm_no(/bed_no) 的学生表，按 student_no 匹配
 *
 * 用法：node tools/backfill-student-dorm.mjs [--dry]
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const DRY = process.argv.includes('--dry');

function read(rel) {
  return readFileSync(join(ROOT, rel), 'utf8');
}

const env = read('server-job/.env');
const PWD = /^DB_PASSWORD=(.*)$/m.exec(env)?.[1]?.trim() || '';

function q(sql) {
  return execFileSync('mysql', ['-uroot', `-p${PWD}`, '-N', '-e', sql], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function run(sql) {
  execFileSync('mysql', ['-uroot', `-p${PWD}`, '-e', sql], {
    stdio: ['ignore', 'ignore', 'ignore'],
  });
}

/** 找出表里的列 */
function columns(schema, table) {
  const out = q(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='${schema}' AND TABLE_NAME='${table}'`,
  );
  return new Set(out ? out.split('\n').map((x) => x.trim()) : []);
}

const TABLES = [
  ['sms_class_jh', 't_class_student'],
  ['sms_class', 't_class_student'],
  ['sms_job', 't_student_base'],
  ['sms_edu', 't_student_base'],
  ['sms_perm', 't_student_base'],
];

const JOIN = `FROM {T} s
  JOIN sms_job.t_job_dorm_bed b ON BINARY b.student_no = BINARY s.student_no AND b.bed_status = 2 AND b.is_deleted = 0
  JOIN sms_job.t_job_dorm d ON d.id = b.dorm_id AND d.is_deleted = 0`;

let touched = 0;
for (const [schema, table] of TABLES) {
  const full = `${schema}.${table}`;
  const cols = columns(schema, table);
  if (!cols.has('student_no') || !cols.has('dorm_id') || !cols.has('dorm_no')) {
    console.log(`- ${full}: 缺 student_no/dorm_id/dorm_no，跳过`);
    continue;
  }

  const pending = `${JOIN.replace('{T}', full)} WHERE s.is_deleted = 0 AND (s.dorm_id IS NULL OR s.dorm_id = '')`;
  const need = Number(q(`SELECT COUNT(*) ${pending}`)) || 0;

  if (DRY) {
    console.log(`- ${full}: [dry] 待回填 ${need} 行${cols.has('bed_no') ? '（含 bed_no）' : ''}`);
    touched += need;
    continue;
  }

  if (need > 0) {
    const setBed = cols.has('bed_no') ? ', s.bed_no = b.bed_no' : '';
    run(`UPDATE ${full} s
      JOIN sms_job.t_job_dorm_bed b ON BINARY b.student_no = BINARY s.student_no AND b.bed_status = 2 AND b.is_deleted = 0
      JOIN sms_job.t_job_dorm d ON d.id = b.dorm_id AND d.is_deleted = 0
      SET s.dorm_id = b.dorm_id, s.dorm_no = d.dorm_no${setBed}
      WHERE s.is_deleted = 0 AND (s.dorm_id IS NULL OR s.dorm_id = '')`);
  }

  const ok = Number(q(`SELECT COUNT(*) ${pending}`)) || 0;
  touched += need;
  console.log(`- ${full}: 回填 ${need} 行${cols.has('bed_no') ? '（含 bed_no）' : ''}，剩余待回填 ${ok}`);
}

console.log(`\n完成：${DRY ? '（dry-run，未写库）' : '已回填'}，累计处理 ${touched} 行`);
