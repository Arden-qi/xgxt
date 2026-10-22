/**
 * 给咨询库 sms_consult 补「转介绍招生老师」两列（npm run fix:consult）
 *
 * 为什么单独一个脚本、而不是 knex 迁移：
 *   sms_consult.knex_migrations 里记着 8 条 2026-10-02 的一次性迁移，
 *   文件早就删了；一旦给 sms_consult 单开迁移目录，knex 会直接判
 *   「migration directory is corrupt, the following files are missing: …」
 *   所以这个库一直靠脚本补结构，本脚本沿用同一套做法。
 *
 * 幂等：表不存在就跳过，列已存在就跳过，可重复执行。
 *
 * 用法：cd server-job && npm run fix:consult
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
const TABLE = 't_consult_student';

const COLUMNS = [
  ['referrer_name', "varchar(50) DEFAULT NULL COMMENT '转介绍招生老师姓名（来源=转介绍时填）'"],
  ['referrer_phone', "varchar(20) DEFAULT NULL COMMENT '转介绍招生老师电话'"],
];

const C = {
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bad: (s) => `\x1b[31m${s}\x1b[0m`,
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
    const [[t]] = await conn.query(
      'SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ? AND table_name = ?',
      [DB, TABLE],
    );
    if (!Number(t.n)) {
      console.log(C.dim(`  — ${DB}.${TABLE} 不存在，跳过（咨询库没导入时属正常）`));
      return;
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
    console.log(added ? C.ok(`  ✓ ${DB}.${TABLE} 补了 ${added} 列`) : C.dim(`  ✓ ${DB}.${TABLE} 列已齐全`));
  } finally {
    await conn.end().catch(() => {});
  }
})().catch((e) => {
  console.error(C.bad(`  ✗ 咨询库补列失败：${e.message}`));
  process.exitCode = 1;
});
