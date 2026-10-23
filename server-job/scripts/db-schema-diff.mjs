/**
 * 数据库表结构自检（2026-10-23）
 * ============================================================
 *
 * 【为什么要有它】
 *   2026-10-23 用户报障：市场咨询 → 学生管理 弹
 *   「数据表不存在：sms_consult.t_consult_installment_plan」。
 *   真实原因不是代码漏切读，而是**本地库比代码旧** ——
 *   队友 a885bd7（分期付款全链路 + 退费页面重构）加了三张表，
 *   但只写了 `sql/init/*.sql`，没写 knex 迁移，也没人提醒「拉代码要补库」。
 *   而统一错误文案又把 ER_NO_SUCH_TABLE 翻译成「教学或老表已 DROP，请检查是否漏切读」，
 *   指向完全错误的方向，排查成本极高。
 *
 * 【它检查两件事】
 *   ① 代码引用但库里不存在的表 —— 这类一定会在运行时炸「数据表不存在」；
 *   ② `sql/init/*.sql` 与真实库的表差异 —— 库里缺（代码/新功能要用的表没建）、
 *      库里多（本机残留、或初始化 SQL 过期）。列出「缺」和「多」两边。
 *
 * 【用法】
 *   node scripts/db-schema-diff.mjs           全量报告
 *   node scripts/db-schema-diff.mjs --quiet   只在有问题时输出（一键启动的自检用）
 *   node scripts/db-schema-diff.mjs --code    只扫代码引用
 *   node scripts/db-schema-diff.mjs --init    只比 init SQL
 *
 *   退出码：0 = 没问题；1 = 有缺表（可当 CI / 启动自检用）
 *
 * ⚠️ 注释不算引用：源码先剥掉 // 与块注释再扫，否则会把
 *    「历史表 t_notification」「示例 t_class_xxx_apply」这类说明文字误报成缺表。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(HERE, '..');
const SRC_DIR = path.join(SERVER_ROOT, 'src');
const INIT_DIR = path.join(SERVER_ROOT, 'sql', 'init');

const argv = process.argv.slice(2);
const QUIET = argv.includes('--quiet');
const ONLY_CODE = argv.includes('--code');
const ONLY_INIT = argv.includes('--init');

/* ---------------- 读 .env（与后端同一份凭据） ---------------- */
function readEnv() {
  const out = {};
  const p = path.join(SERVER_ROOT, '.env');
  if (!fs.existsSync(p)) return out;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/* ---------------- 剥注释（避免说明文字里的表名被当成引用） ---------------- */
function stripComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')        // 块注释 / JSDoc
    .split(/\r?\n/)
    .filter((line) => !/^\s*(\/\/|\*)/.test(line)) // 行注释、JSDoc 续行
    .map((line) => line.replace(/\s\/\/.*$/, ''))  // 行尾注释
    .join('\n');
}

/* ---------------- 递归收集源码 ---------------- */
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist') continue;
      walk(p, out);
    } else if (/\.(ts|js|mjs|cjs)$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

/* ---------------- 主流程 ---------------- */
const env = readEnv();
const mysql = (await import('file://' + path.join(SERVER_ROOT, 'node_modules', 'mysql2', 'promise.js').replace(/\\/g, '/'))).default;

let conn;
try {
  conn = await mysql.createConnection({
    host: env.DB_HOST || 'localhost',
    port: Number(env.DB_PORT || 3306),
    user: env.DB_USER || 'root',
    password: env.DB_PASSWORD || '',
    connectTimeout: 8000,
  });
} catch (e) {
  if (!QUIET) console.log(`\n[表结构自检] 连不上数据库（${e.message}），跳过。`);
  process.exit(0); // 连不上库不是本脚本要判的问题，交给 check-env.mjs
}

/** 表名 → 所在库列表 */
const tableToDbs = new Map();
{
  const [rows] = await conn.query('select table_schema, table_name from information_schema.tables');
  for (const r of rows) {
    const t = r.TABLE_NAME;
    if (!tableToDbs.has(t)) tableToDbs.set(t, []);
    tableToDbs.get(t).push(r.TABLE_SCHEMA);
  }
}

const problems = [];
const lines = [];

/* ---------- ① 代码引用但库里没有 ---------- */
if (!ONLY_INIT) {
  const refs = new Map(); // 表名 -> 引用文件集合
  for (const f of walk(SRC_DIR)) {
    const code = stripComments(fs.readFileSync(f, 'utf8'));
    for (const m of code.matchAll(/['"`](t_[a-z0-9_]+)['"`]/g)) {
      const t = m[1];
      if (!refs.has(t)) refs.set(t, new Set());
      refs.get(t).add(path.relative(SERVER_ROOT, f));
    }
  }
  const missing = [...refs.keys()].filter((t) => !tableToDbs.has(t)).sort();
  lines.push(`代码引用表名：${refs.size} 个；库里找不到：${missing.length} 个`);
  for (const t of missing) {
    const where = [...refs.get(t)].slice(0, 3).join('、') + (refs.get(t).size > 3 ? ' …' : '');
    lines.push(`  ❌ 缺表 ${t}   ← ${where}`);
    problems.push(`缺表 ${t}`);
  }
}

/* ---------- ② init SQL ⇄ 真实库 ---------- */
if (!ONLY_CODE) {
  const files = fs.existsSync(INIT_DIR) ? fs.readdirSync(INIT_DIR).filter((f) => f.endsWith('.sql')) : [];
  const initDbs = files.map((f) => path.basename(f, '.sql'));
  lines.push('');
  lines.push(`初始化 SQL 对比：${files.length} 个文件`);
  for (const f of files) {
    const db = path.basename(f, '.sql');
    const sql = fs.readFileSync(path.join(INIT_DIR, f), 'utf8');
    const created = [...new Set([...sql.matchAll(/CREATE TABLE `([^`]+)`/g)].map((m) => m[1]))];
    if (!created.length) {
      // legacy-teaching.sql / uni-tables.sql 这类不按库对齐的文件，跳过对比
      lines.push(`  · ${db}：未按库建表（${created.length} 张），跳过`);
      continue;
    }
    const actual = new Set();
    const [rows] = await conn.query('select table_name from information_schema.tables where table_schema=?', [db]);
    for (const r of rows) actual.add(r.TABLE_NAME);

    const missing = created.filter((t) => !actual.has(t));
    const extra = [...actual].filter((t) => !created.includes(t));
    if (!missing.length && !extra.length) {
      lines.push(`  ✅ ${db}：${created.length} 张，一致`);
      continue;
    }
    lines.push(`  ⚠️ ${db}：SQL 里 ${created.length} 张，库里 ${actual.size} 张`);
    if (missing.length) {
      lines.push(`     库里缺（${missing.length}）：${missing.join('、')}`);
      problems.push(`${db} 缺 ${missing.length} 张`);
    }
    if (extra.length) lines.push(`     库里多（${extra.length}）：${extra.join('、')}`);
  }
  lines.push('');
  lines.push('  提示：「库里多」多半是本机残留或 initialization SQL 没跟上，不算错误；');
  lines.push('        「库里缺」会让对应功能报「数据表不存在」，必须补齐（见 sql/init/README.md）。');
}

await conn.end();

if (QUIET && !problems.length) process.exit(0);

console.log('\n================ 数据库表结构自检 ================');
lines.forEach((l) => console.log(l));
if (problems.length) {
  console.log(`\n  → 共 ${problems.length} 处缺表。补法见 server-job/sql/init/README.md「缺表怎么补」。`);
  console.log('=================================================\n');
  process.exit(1);
}
console.log('\n  → 未发现缺表。');
console.log('=================================================\n');
process.exit(0);
