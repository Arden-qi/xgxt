/**
 * P8（阶段 7）配套：**教学域老表的「临时重建 / 清除」**
 * ============================================================
 *
 * 【用途】
 *   老表已 DROP（P8）。`seed-all-demo.mjs` 的写数据逻辑按老表列写的（1600 行，不重写），
 *   因此 seed 的流程变成：
 *     ① 本脚本 up   —— 从 P5 全量备份（exports/p5-backup/*.sql）临时重建老表（仅结构）
 *     ② seed 灌数据（写临时老表，逻辑零改动）
 *     ③ 跑 `_uni-migrate-p5.mjs` 搬进统一表（既有管线，已验证）
 *     ④ 本脚本 --drop —— 删掉临时老表，库里恢复「无老表」状态
 *
 *   这样「seed 直写统一表」的最终态达成，而 1600 行写数据代码一行不改。
 *
 * 【范围】
 *   仅 sms_class / sms_class_jh / sms_job 三库、备份 DDL 里存在的 t_* 表。
 *   sms_edu（B 类保留域）、sms_common 的 *_sync 表、perm/finance/consult/portal 不碰。
 *
 * 【幂等】up 是 DROP IF EXISTS + CREATE；--drop 是 DROP IF EXISTS。
 *
 * 跑法：
 *   node scripts/_uni-recreate-legacy.mjs          # 重建（临时）
 *   node scripts/_uni-recreate-legacy.mjs --drop   # 清除
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('dotenv').config({ path: path.join(process.cwd(), '.env') });
const mysql = require('mysql2/promise');

const DBS = ['sms_class', 'sms_class_jh', 'sms_job'];
const BACKUP_DIR = fs.existsSync(path.join(process.cwd(), 'exports', 'p8-final-backup'))
  ? path.join(process.cwd(), 'exports', 'p8-final-backup') // P8 最终备份（权威）
  : path.join(process.cwd(), 'exports', 'p5-backup');
const DROP_MODE = process.argv.includes('--drop');

/** 从备份 SQL 里提取某库的「表名 → CREATE TABLE DDL」 */
function parseBackup(db) {
  const file = path.join(BACKUP_DIR, `${db}.sql`);
  if (!fs.existsSync(file)) throw new Error(`缺备份文件 ${file} —— 先跑 _uni-p5-backup.mjs`);
  const sql = fs.readFileSync(file, 'utf8');
  const out = {};
  const re = /DROP TABLE IF EXISTS `(t_[a-z_0-9]+)`;\s*\n(CREATE TABLE `[^`]+`[\s\S]*?ENGINE=[^;]+);/g;
  let m;
  while ((m = re.exec(sql)) !== null) out[m[1]] = m[2];
  return out;
}

async function main() {
  for (const db of DBS) {
    // ★ 每库独立连接（CREATE TABLE 的 DDL 不带库名前缀，必须先选定库）
    const conn = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: +process.env.DB_PORT,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: db,
      multipleStatements: false,
    });
    const ddls = parseBackup(db);
    const tables = Object.keys(ddls);
    if (!tables.length) {
      console.log(`  ⚠ ${db}: 备份里没解析到教学域表 DDL，跳过`);
      await conn.end();
      continue;
    }
    for (const t of tables) {
      await conn.query(`DROP TABLE IF EXISTS \`${db}\`.\`${t}\``);
      if (!DROP_MODE) {
        await conn.query(ddls[t]);
      }
    }
    console.log(
      `  ✔ ${db}: ${tables.length} 张老表已${DROP_MODE ? '清除' : '临时重建'}`,
    );
    await conn.end();
  }

  console.log(DROP_MODE ? '临时老表已清除，库里恢复「无老表」状态' : '临时老表已就绪（可灌数据）');
}

main().catch((e) => {
  console.error('✗ 失败：', e?.message || e);
  process.exit(1);
});
