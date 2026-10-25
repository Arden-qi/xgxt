/* 排序规则统一：所有 sms% 库 → utf8mb4_unicode_ci
 * 背景：sms_common 里 uni-migrate 早期建的 20 张表是 utf8mb4_0900_ai_ci，
 * 其余 33 张是 utf8mb4_unicode_ci，跨表子查询（t_uni_review.student_id IN
 * (select id from t_uni_student ...)）报 Illegal mix of collations。
 * 一次性把 10 个库的库默认 + 全部表 CONVERT 成 utf8mb4_unicode_ci，
 * 与服务器/连接默认一致，杜绝以后再混。 */
import mysql from 'mysql2/promise';

const TARGET = 'utf8mb4_unicode_ci';
const conn = await mysql.createConnection({ host: '127.0.0.1', port: 3306, user: 'root', password: 'xueguan123' });

const [dbs] = await conn.query(`SELECT schema_name AS s, default_collation_name AS dc FROM information_schema.schemata WHERE schema_name LIKE 'sms%'`);
let dbChanged = 0; let tabChanged = 0;
for (const { s, dc } of dbs as any[]) {
  if (dc !== TARGET) {
    await conn.query(`ALTER DATABASE \`${s}\` COLLATE ${TARGET}`);
    console.log(`ALTER DATABASE ${s}: ${dc} → ${TARGET}`);
    dbChanged++;
  }
  const [tabs] = await conn.query(
    `SELECT table_name AS t, table_collation AS c FROM information_schema.tables
      WHERE table_schema = ? AND table_type = 'BASE TABLE' AND table_collation <> ?`, [s, TARGET]) as any[];
  for (const { t, c } of tabs) {
    await conn.query(`ALTER TABLE \`${s}\`.\`${t}\` CONVERT TO CHARACTER SET utf8mb4 COLLATE ${TARGET}`);
    console.log(`  ALTER TABLE ${s}.${t}: ${c} → ${TARGET}`);
    tabChanged++;
  }
  console.log(`-- ${s} 完成`);
}
console.log(`\n库默认修改 ${dbChanged} 个，表转换 ${tabChanged} 张，全部 → ${TARGET}`);

/* 复查 */
const [left] = await conn.query(
  `SELECT table_schema AS s, COUNT(*) AS n FROM information_schema.tables
    WHERE table_schema LIKE 'sms%' AND table_collation <> '${TARGET}' GROUP BY table_schema`);
console.log((left as any[]).length === 0 ? '✅ 复查：所有 sms% 表 collation 已统一' : `⚠️ 仍有残留: ${JSON.stringify(left)}`);

await conn.end();
