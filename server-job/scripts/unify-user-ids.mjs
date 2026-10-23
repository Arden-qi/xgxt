/**
 * 人员 ID 统一（npm run id:unify / id:unify:apply）
 *
 * ★ 2026-10-23 用户口径：
 *   「所有账号的 ID 统一使用权限库中 U 号」——权限库 `t_perm_user.id` 是唯一标准，
 *   门户账号 / 咨询自有账号的 UUID 一律映射成对应的 U 号。
 *
 * 【为什么需要清洗】
 *   同一张业务表里既有 U004 也有 85a47f05-…，凡是"按人过滤"的查询
 *   拿错口径就静默查空（班主任看不到自己的班、审批人看不到自己的单）。
 *
 * 【映射规则（唯一可信来源）】
 *   门户账号 t_sys_account(account) ─┐
 *                                     ├─ 按 account 登录名对齐 → t_perm_user.id
 *   咨询账号 t_consult_account(account)┘
 *   已经是 U 号的值原样保留。
 *
 * 【安全性】
 *   · 默认 dry-run，只打印将改多少行；加 --apply 才真的写库
 *   · 只做「UUID → U号」的单向替换，不动 U 号，不动无法映射的值
 *   · 幂等：重复执行第二次不会再有改动
 *   · 建议先跑 npm run id:audit 看清单，并自行备份（脚本不代替备份）
 *
 * 【发给同事后怎么用】
 *   1) 拉代码 → npm install（无新增依赖）
 *   2) npm run id:audit        // 看哪些列还是 UUID
 *   3) npm run id:unify        // 预览
 *   4) npm run id:unify:apply  // 执行
 *   5) npm run id:audit        // 复查应为全绿
 *   一键启动（tools/start.mjs）会在导入初始化 SQL 之后自动跑一次 apply，
 *   所以新装环境不需要手工执行。
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });

const mysql = require('mysql2/promise');

const APPLY = process.argv.includes('--apply');
/** --quiet：一键启动时只打一行结论（避免每次启动刷 35 行） */
const QUIET = process.argv.includes('--quiet');
const NO_COLOR = process.env.NO_COLOR;
const USE_COLOR =
  !NO_COLOR && !!process.stdout.isTTY && (process.platform !== 'win32' || !!process.env.WT_SESSION || !!process.env.TERM_PROGRAM);
const paint = (code) => (s) => (USE_COLOR ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const C = { ok: paint(32), bad: paint(31), warn: paint(33), dim: paint(2), bold: paint(1) };

const DB = {
  job: process.env.DB_NAME || 'sms_job',
  edu: process.env.DB_NAME_EDU || 'sms_edu',
  cls: process.env.DB_NAME_CLASS || 'sms_class',
  jh: process.env.DB_NAME_CLASS_JH || 'sms_class_jh',
  common: process.env.DB_NAME_COMMON || 'sms_common',
  consult: process.env.DB_NAME_CONSULT || 'sms_consult',
  finance: process.env.DB_NAME_FINANCE || 'sms_finance',
  perm: process.env.DB_NAME_PERM || 'sms_perm',
  portal: process.env.DB_NAME_PORTAL || 'sms_portal',
};

/** 与 id-audit.mjs 必须保持一致 */
const PERSON_COL_RE =
  /(teacher|manager|staff|approver|receiver|applicant|operator|creator|owner|advisor|consultant|recruit|handler)/;
const NOT_PERSON_RE = /^(scheme|class|student|plan|exam|dorm|bed)_/;

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    charset: 'utf8mb4',
    multipleStatements: false,
  });

  const dbs = Object.values(DB);
  const [perm] = await conn.query(`SELECT id, account FROM \`${DB.perm}\`.t_perm_user WHERE is_deleted=0`);
  const [portal] = await conn.query(`SELECT id, account FROM \`${DB.portal}\`.t_sys_account WHERE is_deleted=0`);
  let consultAcc = [];
  try {
    [consultAcc] = await conn.query(`SELECT id, account FROM \`${DB.consult}\`.t_consult_account`);
  } catch {
    /* 咨询库没这张表 */
  }

  const permIdByAccount = new Map(perm.map((p) => [String(p.account || '').toLowerCase(), String(p.id)]));
  const map = new Map(); // uuid -> U号
  for (const a of [...portal, ...consultAcc]) {
    const pid = permIdByAccount.get(String(a.account || '').toLowerCase());
    if (pid && a.id && a.id !== pid) map.set(String(a.id), pid);
  }

  const [cols] = await conn.query(
    `SELECT table_schema db, table_name t, column_name c
       FROM information_schema.columns
      WHERE table_schema IN (?) AND column_name LIKE '%\\_id'
        AND data_type IN ('varchar','char','text')
      ORDER BY table_schema, table_name, column_name`,
    [dbs],
  );
  const hits = cols.filter((x) => PERSON_COL_RE.test(x.c) && !NOT_PERSON_RE.test(x.c));

  console.log(C.bold(`\n▶ 人员 ID 统一（${APPLY ? '执行' : '预览'}模式）`));
  console.log(C.dim(`  可映射 UUID ${map.size} 个（门户 ${portal.length} + 咨询 ${consultAcc.length}，按登录名对齐权限用户 ${perm.length} 个）`));

  let totalRows = 0;
  let touchCols = 0;
  const skipped = new Map();

  for (const h of hits) {
    let vals = [];
    try {
      const [r] = await conn.query(
        `SELECT DISTINCT \`${h.c}\` v FROM \`${h.db}\`.\`${h.t}\` WHERE \`${h.c}\` IS NOT NULL AND \`${h.c}\` <> ''`,
      );
      vals = r.map((x) => String(x.v));
    } catch {
      continue;
    }
    const targets = vals.filter((v) => map.has(v));
    for (const v of vals) if (!map.has(v) && !/^U[A-Za-z0-9_]+$/.test(v)) skipped.set(v, `${h.db}.${h.t}.${h.c}`);
    if (!targets.length) continue;

    // 统计将影响多少行
    const [cnt] = await conn.query(
      `SELECT COUNT(*) n FROM \`${h.db}\`.\`${h.t}\` WHERE \`${h.c}\` IN (?)`,
      [targets],
    );
    const affected = Number(cnt[0].n);
    totalRows += affected;
    touchCols += 1;

    if (APPLY) {
      // 分批 CASE WHEN，避免超长 SQL
      const chunk = 50;
      for (let i = 0; i < targets.length; i += chunk) {
        const part = targets.slice(i, i + chunk);
        const cases = part.map(() => `WHEN ? THEN ?`).join(' ');
        const params = [];
        for (const v of part) params.push(v, map.get(v));
        await conn.query(
          `UPDATE \`${h.db}\`.\`${h.t}\` SET \`${h.c}\` = CASE \`${h.c}\` ${cases} ELSE \`${h.c}\` END WHERE \`${h.c}\` IN (?)`,
          [...params, part],
        );
      }
      if (!QUIET) console.log(`  ${C.ok('✓')} ${`${h.db}.${h.t}.${h.c}`.padEnd(56)} ${String(affected).padStart(4)} 行 → ${targets.map((v) => map.get(v)).join('/')}`);
    } else {
      if (!QUIET) console.log(`  ${C.warn('·')} ${`${h.db}.${h.t}.${h.c}`.padEnd(56)} ${String(affected).padStart(4)} 行 → ${targets.map((v) => map.get(v)).join('/')}`);
    }
  }

  console.log('');
  if (!touchCols) {
    console.log(C.ok('✓ 没有需要转换的值（已全部是 U 号）'));
  } else if (APPLY) {
    console.log(C.ok(`✓ 已统一 ${touchCols} 个列、${totalRows} 行 → 权限库 U 号`));
  } else {
    console.log(C.warn(`· 预览：将统一 ${touchCols} 个列、${totalRows} 行；确认后执行 npm run id:unify:apply`));
  }
  if (skipped.size) {
    console.log(C.dim(`  无法映射、已跳过 ${skipped.size} 个值（多为角色码或历史脏值）：${[...skipped.keys()].slice(0, 8).join(', ')}${skipped.size > 8 ? ' …' : ''}`));
  }
  await conn.end();
})().catch((e) => {
  console.error(C.bad('✗ ' + e.message));
  process.exit(2);
});
