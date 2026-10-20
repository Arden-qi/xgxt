/**
 * 清理 e2e 自检夹具残留（默认只预演，不删）
 * ============================================================
 * 用法：
 *   node scripts/_demo-clean-e2e.mjs            # 预演：只统计，不删
 *   node scripts/_demo-clean-e2e.mjs --apply    # 真删（事务内）
 *
 * 【为什么会有这些数据】
 *   17 个 e2e 套件（_e2e-*.mjs）会造「班级/学生/考试/成绩」夹具，名字统一以 E2E 开头
 *   （如 E2E-GRADE-erypke-A / E2Egraypke636177）。正常跑完会自己清理；
 *   中途失败/被打断、或早期套件漏登记统一表镜像行时会留残留 → 界面上像乱码。
 *
 * 【清理口径】只删「名字以 E2E 开头」的记录及其子表，绝不动其它数据。
 */

import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(ROOT, '.env') });
const APPLY = process.argv.includes('--apply');

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: 'sms_common',
  multipleStatements: true,
});

const ids = async (sql) => (await conn.query(sql))[0].map((r) => String(r.id));

const classIds = await ids(`select id from t_uni_class where class_name like 'E2E%'`);
const stuIds = await ids(`select id from t_uni_student where student_name like 'E2E%'`);
const examIds = await ids(`select id from t_uni_exam where exam_name like 'E2E%'`);

const inList = (arr) => (arr.length ? arr.map(() => '?').join(',') : `''`);

// 子表 → 主表的关联（顺序即删除顺序：先子后主）
const plan = [
  ['t_uni_exam_score', `exam_id in (${inList(examIds)}) or student_name like 'E2E%'`, examIds],
  ['t_uni_exam_content', `exam_id in (${inList(examIds)})`, examIds],
  ['t_uni_attendance_detail', `student_name like 'E2E%' or attendance_id in (select id from t_uni_attendance where class_id in (${inList(classIds)}) or class_name like 'E2E%')`, classIds],
  ['t_uni_attendance', `class_name like 'E2E%' or class_id in (${inList(classIds)})`, classIds],
  ['t_uni_class_student', `class_name like 'E2E%' or student_name like 'E2E%' or class_id in (${inList(classIds)}) or student_id in (${inList(stuIds)})`, [...classIds, ...stuIds]],
  ['t_uni_approval', `student_name like 'E2E%' or student_id in (${inList(stuIds)})`, stuIds],
  ['t_uni_refund', `student_name like 'E2E%' or student_id in (${inList(stuIds)})`, stuIds],
  ['t_uni_exam', `id in (${inList(examIds)})`, examIds],
  ['t_uni_student', `id in (${inList(stuIds)})`, stuIds],
  ['t_uni_class', `id in (${inList(classIds)})`, classIds],
];

console.log(`${APPLY ? '【真删】' : '【预演】'} 夹具：班级 ${classIds.length} · 学生 ${stuIds.length} · 考试 ${examIds.length}\n`);

let total = 0;
await conn.beginTransaction().catch(() => {});
for (const [table, where, params] of plan) {
  try {
    const [[c]] = await conn.query(`select count(*) c from ${table} where ${where}`, params);
    const n = Number(c.c);
    total += n;
    if (!n) continue;
    if (APPLY) await conn.query(`delete from ${table} where ${where}`, params);
    console.log(`  ${APPLY ? '删除' : '命中'} ${String(n).padStart(4)} 行  ${table}`);
  } catch (e) {
    console.log(`  ⚠️ 跳过 ${table}：${e.code || e.message}`);
  }
}
if (APPLY) await conn.commit();
else await conn.rollback().catch(() => {});
console.log(`\n${APPLY ? '已删除' : '将删除'} ${total} 行（未包含其它数据）`);
if (!APPLY) console.log('确认无误后加 --apply 执行；建议先做一次库备份。');
console.log('（注意：e2e 套件跑完还会再产生新夹具，长期方案是修套件的清理逻辑）');
await conn.end();
