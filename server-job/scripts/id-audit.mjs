/**
 * 人员 ID 体检（npm run id:audit）
 *
 * ★ 2026-10-23
 *
 * 【为什么需要】
 *   系统里"人"的 ID 历史上有四套写法，同一批业务表混着存：
 *     ① 门户账号 UUID（t_sys_account.id，登录用）
 *     ② 权限库用户号（t_perm_user.id，如 U004 / U_chenxf）—— 本项目约定的唯一标准
 *     ③ 咨询自有账号 UUID（t_consult_account.id，历史遗留）
 *     ④ 角色码（如 TEACH_DEAN 被写进 receiver_id）
 *
 *   凡是"按人过滤"的地方（班主任看自己班、审批人看自己单据…），
 *   拿错口径就会静默查空 —— 不报错，只是列表一条都没有。
 *
 * 【本脚本做什么】
 *   扫描 9 个库里所有"人员 ID 列"（按列名关键字自动发现），
 *   把实际取值分类统计：U 号 / 门户 UUID / 咨询 UUID / 角色码 / 其他，
 *   并标出哪些值无法映射到权限用户（= 清洗时会跳过）。
 *
 * 用法：
 *   cd server-job && npm run id:audit
 *   退出码：0 = 全部已是 U 号；1 = 仍有非 U 号（需跑 id:unify）
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });

const mysql = require('mysql2/promise');

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

/** 人员 ID 列的判定关键字（与 unify-user-ids.mjs 保持一致） */
export const PERSON_COL_RE =
  /(teacher|manager|staff|approver|receiver|applicant|operator|creator|owner|advisor|consultant|recruit|handler)/;
/** 明显不是"人"的列（方案/班级/学生/计划…的主键） */
export const NOT_PERSON_RE = /^(scheme|class|student|plan|exam|dorm|bed)_/;

const ID_U = /^U[A-Za-z0-9_]+$/;
const ID_PORTAL = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    charset: 'utf8mb4',
  });

  const dbs = Object.values(DB);
  const [cols] = await conn.query(
    `SELECT table_schema db, table_name t, column_name c, data_type ty
       FROM information_schema.columns
      WHERE table_schema IN (?) AND column_name LIKE '%\\_id'
        AND data_type IN ('varchar','char','text')
      ORDER BY table_schema, table_name, column_name`,
    [dbs],
  );
  const hits = cols.filter((x) => PERSON_COL_RE.test(x.c) && !NOT_PERSON_RE.test(x.c));

  // 三类可映射来源 → 统一 U 号
  const [perm] = await conn.query(`SELECT id, account FROM \`${DB.perm}\`.t_perm_user WHERE is_deleted=0`);
  const [portal] = await conn.query(`SELECT id, account FROM \`${DB.portal}\`.t_sys_account WHERE is_deleted=0`);
  let consultAcc = [];
  try {
    [consultAcc] = await conn.query(`SELECT id, account FROM \`${DB.consult}\`.t_consult_account`);
  } catch {
    /* 咨询库没有这张表：忽略 */
  }
  const permIdByAccount = new Map(perm.map((p) => [String(p.account || '').toLowerCase(), String(p.id)]));
  const uuidToPerm = new Map();
  for (const a of [...portal, ...consultAcc]) {
    const pid = permIdByAccount.get(String(a.account || '').toLowerCase());
    if (pid) uuidToPerm.set(String(a.id), pid);
  }
  const permIds = new Set(perm.map((p) => String(p.id)));

  console.log(C.bold('\n▶ 人员 ID 扫描'));
  console.log(C.dim(`  权限用户 ${perm.length} 个 / 门户账号 ${portal.length} 个 / 咨询账号 ${consultAcc.length} 个`));

  const rows = [];
  const unmapped = new Map();
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
    if (!vals.length) continue;
    let u = 0;
    let uuid = 0;
    let other = 0;
    for (const v of vals) {
      if (permIds.has(v)) u += 1;
      else if (uuidToPerm.has(v)) uuid += 1;
      else {
        other += 1;
        if (!unmapped.has(v)) unmapped.set(v, []);
        unmapped.get(v).push(`${h.db}.${h.t}.${h.c}`);
      }
    }
    rows.push({ where: `${h.db}.${h.t}.${h.c}`, u, uuid, other, total: vals.length });
  }

  console.log(C.dim('\n  列（库.表.列）'.padEnd(60)) + C.dim('取值  U号 待洗  其他'));
  let dirty = 0;
  for (const r of rows) {
    const flag = r.uuid ? C.warn(' ← 待清洗') : r.other ? C.dim(' ← 有其他值') : '';
    if (r.uuid) dirty += 1;
    console.log(
      `  ${r.where.padEnd(60)}${String(r.total).padStart(4)}${String(r.u).padStart(5)}${String(r.uuid).padStart(5)}${String(r.other).padStart(6)}${flag}`,
    );
  }

  if (unmapped.size) {
    console.log(C.warn(`\n  无法映射到权限用户的值（清洗时会跳过，共 ${unmapped.size} 个）：`));
    for (const [v, where] of [...unmapped].slice(0, 12)) {
      console.log(C.dim(`    ${v}  →  ${where.slice(0, 3).join(', ')}`));
    }
    if (unmapped.size > 12) console.log(C.dim(`    … 还有 ${unmapped.size - 12} 个`));
  }

  console.log('');
  if (dirty) {
    console.log(C.bad(`✗ 仍有 ${dirty} 个人员列存的是非 U 号 → 执行 npm run id:unify:apply 清洗`));
    process.exitCode = 1;
  } else {
    console.log(C.ok('✓ 所有人员列都已是权限库 U 号'));
  }
  await conn.end();
})().catch((e) => {
  console.error(C.bad('✗ ' + e.message));
  process.exit(2);
});
