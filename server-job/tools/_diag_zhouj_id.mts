/* 周杰的用户 id 对比：perm 表 UUID vs uni 表 U009 */
import mysql from 'mysql2/promise';
const conn = await mysql.createConnection({ host: '127.0.0.1', port: 3306, user: 'root', password: 'xueguan123' });

const [u] = await conn.query(`SELECT id, user_name, account FROM sms_perm.t_perm_user WHERE account='zhouj'`);
console.log('perm 周杰:', JSON.stringify(u));
const [p] = await conn.query(`SELECT id, account, user_name FROM sms_portal.t_sys_account WHERE account='zhouj'`);
console.log('portal 周杰:', JSON.stringify(p));

/* 学生表 employment_teacher_id 取值分布 */
const [dist] = await conn.query(
  `SELECT employment_teacher_id, employment_teacher_name, COUNT(*) AS n
     FROM sms_common.t_uni_student WHERE is_deleted = 0 GROUP BY employment_teacher_id, employment_teacher_name`);
console.log('学生表 employment_teacher 分布:', JSON.stringify(dist));

/* 就业日志表 create_by / 归属字段 */
const [c1] = await conn.query(`SHOW COLUMNS FROM sms_common.t_uni_employment_log`);
console.log('就业日志字段:', (c1 as any[]).map((c) => c.Field).join(', '));

await conn.end();
