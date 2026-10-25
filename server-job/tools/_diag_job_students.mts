/* 就业班学生归属核查：就业老师周杰为什么学生档案 0 条 */
import mysql from 'mysql2/promise';
const conn = await mysql.createConnection({ host: '127.0.0.1', port: 3306, user: 'root', password: 'xueguan123', database: 'sms_common' });

/* 就业班的班级负责人字段 */
const [cls] = await conn.query(
  `SELECT id, class_name, edu_stage, employment_teacher_id, employment_teacher_name, head_teacher_id, head_teacher_name, project_manager_id
     FROM t_uni_class WHERE edu_stage = 'job'`);
console.log('== 就业班级 ==');
for (const r of cls as any[]) console.log(JSON.stringify(r));

/* 就业班学生数量与字段 */
const [stu] = await conn.query(
  `SELECT class_id, COUNT(*) AS n FROM t_uni_student WHERE class_id IN (SELECT id FROM t_uni_class WHERE edu_stage='job') GROUP BY class_id`);
console.log('== 就业班学生分布 ==', JSON.stringify(stu));

/* 学生表里与就业相关的字段 */
const [c1] = await conn.query(`SHOW COLUMNS FROM t_uni_student`);
console.log('== t_uni_student 字段 ==');
console.log((c1 as any[]).map((c) => c.Field).join(', '));

await conn.end();
