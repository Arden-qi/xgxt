/**
 * 一次性补列：咨询库 2026-10-22 迁移缺的 3 列（本机专用）
 *
 * 【为什么单独写】
 *   `migrations/20261022_001_add_consult_education_finance_verified.js` 用的是
 *   **不带库名**的 `knex.schema.hasTable('t_consult_student')`，而 `migrate:job` 连的是
 *   sms_job —— 那张表在 sms_job 里不存在，up() 会静默跳过却把迁移记成「已执行」，
 *   列永远补不上（真踩过）。所以 sms_consult 的结构一直走脚本补，本脚本沿用这个做法。
 *
 * 幂等：表不存在跳过，列已存在跳过，可重复执行。
 * 用法：cd server-job && node scripts/_fix-consult-20261026-columns.mjs
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });

const mysql = require(path.join(ROOT, 'node_modules', 'mysql2', 'promise.js'));
const DB = process.env.DB_NAME_CONSULT || 'sms_consult';

/** 与迁移文件里的定义保持一致（education / finance_verified_*） */
const TABLES = {
  t_consult_student: [
    ['education', "varchar(20) DEFAULT NULL COMMENT '学历（初中/高中/中专/大专/本科/硕士及以上）'"],
  ],
  t_consult_fee_order: [
    ['finance_verified_by', "varchar(50) DEFAULT NULL COMMENT '财务核对人姓名（从财务侧同步）'"],
    ['finance_verified_time', "datetime DEFAULT NULL COMMENT '财务核对时间（从财务侧同步）'"],
  ],
};

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    charset: 'utf8mb4',
  });
  try {
    for (const [TABLE, COLUMNS] of Object.entries(TABLES)) {
      const [[t]] = await conn.query(
        'SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ? AND table_name = ?',
        [DB, TABLE],
      );
      if (!Number(t.n)) {
        console.log(`  - ${DB}.${TABLE} 不存在，跳过`);
        continue;
      }
      const [cols] = await conn.query(
        'SELECT column_name AS c FROM information_schema.columns WHERE table_schema = ? AND table_name = ?',
        [DB, TABLE],
      );
      const have = new Set(cols.map((r) => r.c));
      let added = 0;
      for (const [name, ddl] of COLUMNS) {
        if (have.has(name)) continue;
        await conn.query(`ALTER TABLE \`${DB}\`.\`${TABLE}\` ADD COLUMN \`${name}\` ${ddl}`);
        added++;
      }
      console.log(`  ${added ? `+ ${DB}.${TABLE} 补了 ${added} 列` : `= ${DB}.${TABLE} 列已齐全`}`);
    }
  } finally {
    await conn.end().catch(() => {});
  }
})().catch((e) => {
  console.error('补列失败:', e.message);
  process.exitCode = 1;
});
