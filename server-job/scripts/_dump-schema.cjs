/**
 * 一次性脚本：从本机数据库导出 9 个库的完整表结构 -> JSON
 * 用法（在 server-job 目录下）：node scripts/_dump-schema.cjs
 * 产出：scripts/_schema-raw.json
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

// ---- 读 .env ----
const envPath = path.join(__dirname, '..', '.env');
const env = {};
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2];
}

const DBS = [
  ['sms_job', '就业 / 实训'],
  ['sms_edu', '教务'],
  ['sms_class', '班级管理（大学部）'],
  ['sms_class_jh', '教学管理（初高）'],
  ['sms_common', '公共字典（外部同步的只读副本）'],
  ['sms_portal', '统一门户 / 登录'],
  ['sms_consult', '市场咨询'],
  ['sms_finance', '财务管理'],
  ['sms_perm', '权限管理（全系统权限权威源）'],
];

(async () => {
  const conn = await mysql.createConnection({
    host: env.DB_HOST || 'localhost',
    port: Number(env.DB_PORT || 3306),
    user: env.DB_USER || 'root',
    password: env.DB_PASSWORD || '',
    multipleStatements: true,
  });

  const out = { generatedAt: new Date().toISOString(), dbs: [] };

  for (const [db, cn] of DBS) {
    let tables = [];
    let columns = [];
    let indexes = [];
    try {
      [tables] = await conn.query(
        `SELECT TABLE_NAME, TABLE_COMMENT, TABLE_ROWS
         FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = ? AND TABLE_TYPE='BASE TABLE'
         ORDER BY TABLE_NAME`,
        [db],
      );
      [columns] = await conn.query(
        `SELECT TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION, COLUMN_TYPE,
                IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY, EXTRA, COLUMN_COMMENT
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ?
         ORDER BY TABLE_NAME, ORDINAL_POSITION`,
        [db],
      );
      [indexes] = await conn.query(
        `SELECT TABLE_NAME, INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols,
                NON_UNIQUE
         FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = ?
         GROUP BY TABLE_NAME, INDEX_NAME, NON_UNIQUE
         ORDER BY TABLE_NAME, INDEX_NAME`,
        [db],
      );
    } catch (e) {
      out.dbs.push({ db, cn, error: String(e.message || e) });
      continue;
    }
    out.dbs.push({ db, cn, tables, columns, indexes });
  }

  const outPath = path.join(__dirname, '_schema-raw.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 1), 'utf8');
  console.log('written:', outPath);
  for (const d of out.dbs) {
    console.log(
      `${d.db} (${d.cn}): ${d.error ? 'ERROR ' + d.error : (d.tables || []).length + ' tables, ' + (d.columns || []).length + ' columns'}`,
    );
  }
  await conn.end();
})().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
