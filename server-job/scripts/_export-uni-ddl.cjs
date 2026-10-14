/**
 * 从本地 sms_common 导出全部 t_uni_* 表的权威 DDL（IF NOT EXISTS，可重复执行）
 *
 * 用法（在 server-job 目录下）：node scripts/_export-uni-ddl.cjs
 * 产出：server-job/sql/init/uni-tables.sql
 *
 * 连接参数一律读 .env，不硬编码（与 scripts/_dump-schema.cjs 同一套规范）。
 */
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

// ---- 读 .env ----
const envPath = path.join(__dirname, '..', '.env');
const env = {};
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2];
  }
}
const DB_NAME = env.DB_NAME_COMMON || 'sms_common';

(async () => {
  const c = await mysql.createConnection({
    host: env.DB_HOST || 'localhost',
    port: Number(env.DB_PORT || 3306),
    user: env.DB_USER || 'root',
    password: env.DB_PASSWORD || '',
    database: DB_NAME,
  });
  const [tabs] = await c.query(
    `SELECT TABLE_NAME FROM information_schema.tables
     WHERE table_schema=? AND table_name LIKE 't_uni\\_%'
     ORDER BY TABLE_NAME`, [DB_NAME]);
  const names = tabs.map(r => r.TABLE_NAME);
  const out = [];
  out.push('-- ============================================================');
  out.push('-- 学管系统 · 统一表建表 SQL（从权威库导出，可重复执行）');
  out.push('-- 生成方式：SHOW CREATE TABLE 逐表导出，不要手改');
  out.push(`-- 表数量：${names.length} 张`);
  out.push(`-- 生成时间：${new Date().toISOString()}`);
  out.push('--');
  out.push('-- ★ 全部为 CREATE TABLE IF NOT EXISTS，不含 DROP / INSERT');
  out.push('--   → 库里有就跳过，不会删表、不会冲掉数据，可安全重复执行');
  out.push('--');
  out.push('-- ★ 自带建库 + USE，不依赖导入方指定 -D 参数（与四个库的 SQL 风格一致）');
  out.push('-- ============================================================');
  out.push(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
  out.push(`USE \`${DB_NAME}\`;`);
  out.push('SET NAMES utf8mb4;');
  out.push('');
  for (const t of names) {
    const [r] = await c.query(`SHOW CREATE TABLE \`${t}\``);
    let ddl = r[0]['Create Table'];
    ddl = ddl.replace(/^CREATE TABLE/, 'CREATE TABLE IF NOT EXISTS');
    out.push(`-- ---------- ${t} ----------`);
    out.push(ddl + ';');
    out.push('');
  }
  const dest = path.join(__dirname, '..', 'sql', 'init', 'uni-tables.sql');
  fs.writeFileSync(dest, out.join('\n'), 'utf8');
  console.log(`已导出 ${names.length} 张表 -> sql/init/uni-tables.sql`);
  console.log('表清单:', names.join(', '));
  await c.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
