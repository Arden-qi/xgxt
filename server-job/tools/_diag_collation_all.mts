/* 全库 collation 摸底：所有 sms% 库的表级 collation 分布 + 库内是否混用 */
import mysql from 'mysql2/promise';

const cfg = { host: '127.0.0.1', port: 3306, user: 'root', password: 'xueguan123' };
const conn = await mysql.createConnection(cfg);

const [dbs] = await conn.query(`SELECT schema_name AS s FROM information_schema.schemata WHERE schema_name LIKE 'sms%'`);
for (const { s } of dbs) {
  const [tabs] = await conn.query(
    `SELECT table_name AS t, table_collation AS c FROM information_schema.tables
      WHERE table_schema = ? AND table_type = 'BASE TABLE' ORDER BY table_name`, [s]);
  const byColl = {};
  for (const { t, c } of tabs) (byColl[c] = byColl[c] || []).push(t);
  const mixed = Object.keys(byColl).length > 1;
  console.log(`\n== ${s} ==${mixed ? '  ⚠️ 混用' : ''}`);
  for (const [c, list] of Object.entries(byColl)) {
    if (mixed) console.log(`  [${c}] (${list.length}): ${list.join(', ')}`);
    else console.log(`  全部 ${c} (${list.length} 张)`);
  }
  /* 列级与表默认不一致的（可能有） */
  const [colMis] = await conn.query(
    `SELECT table_name AS t, column_name AS col, collation_name AS co
       FROM information_schema.columns
      WHERE table_schema = ? AND collation_name IS NOT NULL AND collation_name <> 'utf8mb4_general_ci'
        AND collation_name <> (SELECT table_collation FROM information_schema.tables ts
                                WHERE ts.table_schema = columns.table_schema AND ts.table_name = columns.table_name)
      LIMIT 20`, [s]);
  if (colMis.length) console.log('  ⚠️ 列级 collation 与表默认不一致:', colMis.map((r) => `${r.t}.${r.col}=${r.co}`).join(', '));
}

/* 连接默认 collation */
const [v] = await conn.query(`SHOW VARIABLES LIKE 'collation_%'`);
console.log('\n== 服务器 collation 变量 ==');
for (const r of (v as any[])) console.log(`${r.Variable_name}: ${r.Value}`);

await conn.end();
