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

/* ---------------- init SQL 里的列 ⇄ 真实库 ---------------- */
/**
 * 逐表比对「init SQL 里声明的列」与库里实际的列。
 * 返回 [{ table, cols: [...] }] —— cols 是库里缺的列。
 *
 * ⚠️ 只取 CREATE TABLE 块里以反引号开头的行（列定义），
 *    索引/主键/约束行不以反引号开头，天然被排除。
 */
async function columnGaps(db, sql, tables) {
  const out = [];
  for (const t of tables) {
    const block = new RegExp('CREATE TABLE `' + t + '` \\(([\\s\\S]*?)\\n\\)', 'i').exec(sql);
    if (!block) continue;
    const declared = [...block[1].matchAll(/^\s*`([^`]+)`\s/gm)].map((m) => m[1]);
    if (!declared.length) continue;
    const [rows] = await conn.query(
      'select column_name from information_schema.columns where table_schema=? and table_name=?',
      [db, t],
    );
    const actual = new Set(rows.map((r) => r.COLUMN_NAME));
    const miss = declared.filter((c) => !actual.has(c));
    if (miss.length) out.push({ table: t, cols: miss });
  }
  return out;
}

/* ---------------- 迁移是否落后 ---------------- */
/**
 * 对比各库 `knex_migrations` 与 `migrations-*` 目录里的文件名。
 *
 * ★ 2026-10-23 加：这次事故的根因就是「迁移 20261022_001 从来没跑」，
 *   而当时的自检只看表名，完全发现不了。现在把「目录里有、库里没记录」
 *   的迁移直接点名列出来。
 */
const MIGRATION_DIRS = [
  ['migrations', 'sms_job'],
  ['migrations-edu', 'sms_edu'],
  ['migrations-class', 'sms_class'],
  ['migrations-class-common', 'sms_common'],
  ['migrations-class-jh', 'sms_class_jh'],
];

async function pendingMigrations() {
  const out = [];
  for (const [dir, db] of MIGRATION_DIRS) {
    const abs = path.join(SERVER_ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    const files = fs.readdirSync(abs).filter((f) => /\.(js|cjs|mjs|ts)$/.test(f));
    if (!files.length) continue;
    let applied = new Set();
    try {
      const [rows] = await conn.query(`select name from \`${db}\`.knex_migrations`);
      applied = new Set(rows.map((r) => String(r.name)));
    } catch {
      out.push({ db, dir, names: ['（连不上该库或没有 knex_migrations 表）'] });
      continue;
    }
    const pending = files.filter((f) => !applied.has(f)).sort();
    if (pending.length) out.push({ db, dir, names: pending });
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
/** 某库是否有某表 */
const tableIn = (schema, t) => (tableToDbs.get(t) || []).includes(schema);
{
  const [rows] = await conn.query('select table_schema, table_name from information_schema.tables');
  for (const r of rows) {
    const t = r.TABLE_NAME;
    if (!tableToDbs.has(t)) tableToDbs.set(t, []);
    tableToDbs.get(t).push(r.TABLE_SCHEMA);
  }
}

/**
 * ★ 2026-10-26：识别「已归一」的历史表名，别再报成缺表。
 *
 *   背景：一键启动会跑本脚本做自检。统一表归一（P8）之后，
 *   初高/大学/就业那批老表（t_class_refund、t_class_room、t_job_approval …）
 *   在库里**已经 DROP**，但代码里仍保留它们的字面量（tbl() 会按 UNI_MAP 改写成 t_uni_*）。
 *   本脚本只比「代码里的表名字面量 vs 库」，不知道映射 →
 *   每次启动都刷一屏「❌ 缺表」，实际功能全正常（走的是统一表）。
 *
 *   口径：只要该老表在 UNI_MAP 里有映射、且映射到的统一表在库里存在，
 *   就判为「已归一（走统一表）」，不计入问题；统一表也缺才是真缺表。
 */
const UNI_MAP = (() => {
  const map = new Map(); // 老表基础名 -> 统一表集合
  try {
    const src = fs.readFileSync(path.join(SERVER_ROOT, 'src/teaching/shared/uniTable.ts'), 'utf8');
    for (const m of src.matchAll(/'([a-z0-9_]+)\.([a-z0-9_]+)'\s*:\s*'([a-z0-9_]+)'/g)) {
      const base = m[2];
      const uni = m[3];
      if (!/^t_/.test(base) || !/^t_/.test(uni)) continue;
      if (!map.has(base)) map.set(base, new Set());
      map.get(base).add(uni);
    }
  } catch {
    /* 读不到映射表就退回原口径（照常报缺表） */
  }
  return map;
})();

/** 统一表开关关掉时不做"已归一"豁免（那时老表是真要用的） */
const UNI_MODE = String(env.TEACHING_UNI_TABLE ?? '1') !== '0';

/** 该老表是否「已归一且统一表存在」→ 可以跳过 */
function normalizedTo(t) {
  if (!UNI_MODE) return null;
  const unis = UNI_MAP.get(t);
  if (!unis) return null;
  const alive = [...unis].filter((u) => tableToDbs.has(u));
  return alive.length ? alive : null;
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
  const absent = [...refs.keys()].filter((t) => !tableToDbs.has(t)).sort();
  const normalized = absent.filter((t) => normalizedTo(t));
  const missing = absent.filter((t) => !normalizedTo(t));
  lines.push(
    `代码引用表名：${refs.size} 个；库里找不到：${absent.length} 个` +
      (normalized.length ? `（其中 ${normalized.length} 个已归一到统一表，不计问题）` : ''),
  );
  for (const t of normalized) {
    lines.push(`  ℹ️ 已归一 ${t} → ${normalizedTo(t).join('/')}（老表已 DROP，代码走统一表）`);
  }
  for (const t of missing) {
    const where = [...refs.get(t)].slice(0, 3).join('、') + (refs.get(t).size > 3 ? ' …' : '');
    lines.push(`  ❌ 缺表 ${t}   ← ${where}`);
    problems.push(`缺表 ${t}`);
  }
}

/**
 * ★ 2026-10-26 补：带库名的引用（'sms_edu.t_edu_dorm_assignment' 这种）原来根本没检查 ——
 *   裸表名正则要求引号紧跟表名，写成 `schema.table` 就漏掉了。
 *   这里按「指定库是否存在这张表 / 是否已归一」判断，属于**补盲区**，正常不产生噪声。
 */
if (!ONLY_INIT) {
  const qualRefs = new Map(); // schema.table -> 文件集合
  for (const f of walk(SRC_DIR)) {
    const code = stripComments(fs.readFileSync(f, 'utf8'));
    for (const m of code.matchAll(/['"`]([a-z0-9_]+)\.(t_[a-z0-9_]+)['"`]/g)) {
      const k = `${m[1]}.${m[2]}`;
      if (!qualRefs.has(k)) qualRefs.set(k, new Set());
      qualRefs.get(k).add(path.relative(SERVER_ROOT, f));
    }
  }
  const bad = [];
  for (const [k] of qualRefs) {
    const [sch, t] = k.split('.');
    if (tableIn(sch, t)) continue;
    if (normalizedTo(t)) continue;      // 老表已归一，运行期会改写
    if (tableToDbs.has(t)) continue;    // 别的库有同名表（历史写法，能跑）
    bad.push(k);
  }
  lines.push(`带库名引用：${qualRefs.size} 个；其中指向不存在的 ${bad.length} 个`);
  for (const k of bad.sort()) {
    lines.push(`  ❌ 缺表 ${k}   ← ${[...qualRefs.get(k)].slice(0, 3).join('、')}`);
    problems.push(`缺表 ${k}`);
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

    /* ★ 2026-10-26：init SQL 里仍会建那批老表（给老环境用），
       统一表模式下库里没有它们属于正常 → 不计「库里缺」。 */
    const missingRaw = created.filter((t) => !actual.has(t));
    const missing = missingRaw.filter((t) => !normalizedTo(t));
    const normalizedGap = missingRaw.filter((t) => normalizedTo(t));
    const extra = [...actual].filter((t) => !created.includes(t));
    /* ★ 2026-10-23：除了表，**列**也要比 —— 这次的事故就是「表在、列缺」，
     *   只比表名完全查不出来（t_class_stage_scheme_stage 少 stage_code）。 */
    const colGaps = await columnGaps(db, sql, created);
    if (!missing.length && !extra.length) {
      lines.push(
        colGaps.length
          ? `  ⚠️ ${db}：表齐全，但有 ${colGaps.length} 张表缺列`
          : `  ✅ ${db}：${created.length} 张表、列齐全`,
      );
      for (const g of colGaps) {
        lines.push(`     缺列 ${g.table}：${g.cols.join('、')}`);
        problems.push(`${db}.${g.table} 缺列`);
      }
      continue;
    }
    lines.push(`  ⚠️ ${db}：SQL 里 ${created.length} 张，库里 ${actual.size} 张`);
    if (missing.length) {
      lines.push(`     库里缺（${missing.length}）：${missing.join('、')}`);
      problems.push(`${db} 缺 ${missing.length} 张`);
    }
    if (normalizedGap.length) {
      lines.push(`     （另有 ${normalizedGap.length} 张老表已归一到统一表，库里没有属正常）`);
    }
    if (extra.length) lines.push(`     库里多（${extra.length}）：${extra.join('、')}`);
  }
  /* ---------- ③ 迁移是否落后 ---------- */
  lines.push('');
  const pending = await pendingMigrations();
  if (!pending.length) {
    lines.push('迁移状态：5 个迁移目录都与库同步');
  } else {
    lines.push(`⚠️ 有 ${pending.length} 个库的迁移没跑完：`);
    for (const g of pending) {
      lines.push(`  ${g.db}（${g.dir}）未执行 ${g.names.length} 条：`);
      for (const n of g.names.slice(0, 8)) lines.push(`     · ${n}`);
      if (g.names.length > 8) lines.push(`     · …还有 ${g.names.length - 8} 条`);
      problems.push(`${g.db} 有未执行迁移`);
    }
    lines.push('  修复：cd server-job && npm run migrate -- <库名，如 class-jh>');
  }

  lines.push('');
  lines.push('  提示：「库里多」多半是本机残留或 initialization SQL 没跟上，不算错误；');
  lines.push('        「库里缺」会让对应功能报「数据表不存在」，必须补齐（见根目录「数据库变更约定.md」）。');
}

await conn.end();

if (QUIET && !problems.length) process.exit(0);

console.log('\n================ 数据库表结构自检 ================');
lines.forEach((l) => console.log(l));
if (problems.length) {
  console.log(`\n  → 共 ${problems.length} 处问题（缺表 / 缺列 / 迁移没跑）。补法见仓库根目录「数据库变更约定.md」。`);
  console.log('=================================================\n');
  process.exit(1);
}
console.log('\n  → 未发现缺表。');
console.log('=================================================\n');
process.exit(0);
