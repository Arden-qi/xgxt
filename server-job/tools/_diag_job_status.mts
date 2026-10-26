/* 就业班学生的 student_status 分布 —— 判断周杰学生档案 0 条是否符合口径 */
import mysql from 'mysql2/promise';
const conn = await mysql.createConnection({ host: '127.0.0.1', port: 3306, user: 'root', password: 'xueguan123', database: 'sms_common' });

const [rows] = await conn.query(
  `SELECT class_id, student_status, COUNT(*) AS n
     FROM t_uni_student
    WHERE is_deleted = 0 AND class_id IN (SELECT id FROM t_uni_class WHERE edu_stage = 'job' AND is_deleted = 0)
    GROUP BY class_id, student_status`);
for (const r of rows as any[]) console.log(`${r.class_id} | status=${r.student_status} | n=${r.n}`);

const [dist] = await conn.query(`SELECT DISTINCT student_status FROM t_uni_student WHERE is_deleted = 0`);
console.log('全部状态枚举:', (dist as any[]).map((r) => r.student_status).join(' | '));

await conn.end();
