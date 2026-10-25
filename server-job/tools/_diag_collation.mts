/* 查各库 t_uni_* 表与关键列的排序规则，找出 collation 混用点 */
import mysql from 'mysql2/promise';

const cfg = { host: '127.0.0.1', port: 3306, user: 'root', password: 'xueguan123' };
const conn = await mysql.createConnection(cfg);

const [tabs] = await conn.query(
  `SELECT table_schema AS s, table_name AS t, table_collation AS c
     FROM information_schema.tables
    WHERE table_name LIKE 't_uni_%' AND table_schema LIKE 'sms%'
    ORDER BY table_schema, table_name`);
console.log('== 表级 collation ==');
for (const r of tabs) console.log(`${r.s}.${r.t}: ${r.c}`);

const focus = ['t_uni_review', 't_uni_employment_log', 't_uni_student', 't_uni_class', 't_uni_class_student'];
const [cols] = await conn.query(
  `SELECT table_schema AS s, table_name AS t, column_name AS col, collation_name AS co, column_type AS ct
     FROM information_schema.columns
    WHERE table_name IN (?) AND table_schema LIKE 'sms%' AND collation_name IS NOT NULL
    ORDER BY table_schema, table_name, column_name`, [focus]);
console.log('\n== 关键表字符列 collation ==');
for (const c of cols) console.log(`${c.s}.${c.t}.${c.col}: ${c.co} (${c.ct})`);

await conn.end();
