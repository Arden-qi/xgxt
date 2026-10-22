/**
 * 数据库结构体检（npm run db:check）
 *
 * ★ 2026-10-22 新增。起因：同事把仓库拉下来跑，报
 *     ① 新建班级 → 「数据库字段不存在」
 *     ② 无法新增学生
 *   这两个报错在日志里只有一句 MySQL 原文，很难判断到底是
 *   "库没建"、"表没建"、"列没加"，还是"数据没填"。
 *
 *   本脚本把三件事分开检查，并直接给出下一步命令：
 *     A. 9 个库是否都在
 *     B. 关键表 / 关键列是否存在（判断迁移有没有跑全）
 *     C. 班级编号是否为空（判断"新增学生"是不是卡在学号生成上）
 *
 * 用法：cd server-job && npm run db:check
 * 退出码：0 = 一切正常；1 = 有问题（详情见输出）
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });

const mysql = require(path.join(ROOT, 'node_modules', 'mysql2', 'promise.js'));

/** 控制台颜色：Windows 传统 cmd 不认 ANSI，会显示成 ←[32m 乱码 → 那时走纯文本 */
const USE_COLOR =
  !process.env.NO_COLOR &&
  !!process.stdout.isTTY &&
  (process.platform !== 'win32' || !!process.env.WT_SESSION || !!process.env.TERM_PROGRAM);
const paint = (code) => (s) => (USE_COLOR ? `\x1b[${code}m${s}\x1b[0m` : String(s));

const C = {
  ok: paint(32),
  bad: paint(31),
  warn: paint(33),
  dim: paint(2),
  bold: paint(1),
};

const env = process.env;
const DB = {
  job: env.DB_NAME || 'sms_job',
  edu: env.DB_NAME_EDU || 'sms_edu',
  cls: env.DB_NAME_CLASS || 'sms_class',
  common: env.DB_NAME_COMMON || 'sms_common',
  jh: env.DB_NAME_CLASS_JH || 'sms_class_jh',
  portal: env.DB_NAME_PORTAL || 'sms_portal',
  consult: env.DB_NAME_CONSULT || 'sms_consult',
  finance: env.DB_NAME_FINANCE || 'sms_finance',
  perm: env.DB_NAME_PERM || 'sms_perm',
};

/** 必须存在的表 + 必须存在的列（列名对不上，就是迁移没跑全） */
const REQUIRED = [
  { db: DB.job, table: 't_job_class', cols: ['class_code', 'stage_key', 'scheme_id', 'scheme_stage_id'] },
  { db: DB.job, table: 't_job_class_student', cols: ['class_id', 'student_no'] },
  { db: DB.jh, table: 't_class_info', cols: ['class_code', 'scheme_id', 'scheme_stage_id', 'scheme_stage_name'] },
  { db: DB.jh, table: 't_class_student', cols: ['student_no', 'class_id', 'parent_name'] },
  { db: DB.jh, table: 't_class_stage_scheme', cols: ['id', 'scheme_name', 'dept_code'] },
  { db: DB.jh, table: 't_class_stage_scheme_stage', cols: ['id', 'scheme_id'] },
  { db: DB.cls, table: 't_class_info', cols: ['class_code', 'scheme_id', 'scheme_stage_id'] },
  { db: DB.cls, table: 't_class_student', cols: ['student_no', 'class_id', 'parent_name'] },
  { db: DB.common, table: 't_uni_student', cols: ['student_no'] },
  { db: DB.common, table: 't_uni_class', cols: ['class_name'] },
  { db: DB.consult, table: 't_consult_student', cols: ['referrer_name', 'referrer_phone'] },
  // ★ 2026-10-22：操作日志改成「全系统留痕」后加了这 5 列，老库不补会写日志失败
  {
    db: DB.perm,
    table: 't_perm_log',
    cols: ['api_path', 'http_method', 'status_code', 'duration_ms', 'user_agent'],
  },
];

/** 「班级编号为空」的统计：为空 = 该班学生无法生成学号 */
const CLASS_CODE_TABLES = [
  { db: DB.jh, table: 't_class_info', nameCol: 'class_name' },
  { db: DB.cls, table: 't_class_info', nameCol: 'class_name' },
  { db: DB.job, table: 't_job_class', nameCol: 'class_name' },
];

(async () => {
  const conn = await mysql.createConnection({
    host: env.DB_HOST || 'localhost',
    port: Number(env.DB_PORT) || 3306,
    user: env.DB_USER || 'root',
    password: env.DB_PASSWORD || '',
    charset: 'utf8mb4',
    timezone: '+08:00',
  });

  let problems = 0;

  // ---------- A. 库 ----------
  console.log(C.bold('\n▶ A. 数据库是否存在（9 个）'));
  const [dbs] = await conn.query('SELECT schema_name AS n FROM information_schema.schemata');
  const alive = new Set(dbs.map((r) => r.n));
  for (const [key, name] of Object.entries(DB)) {
    if (alive.has(name)) {
      console.log(`  ${C.ok('✓')} ${name}`);
    } else {
      problems++;
      console.log(`  ${C.bad('✗')} ${name}  ${C.dim(`（缺库：${key}）`)}`);
    }
  }
  if (problems) {
    console.log(C.dim('\n  缺库不用手工建 —— 双击根目录「一键启动.bat」会自动建，'));
    console.log(C.dim('  或手动执行：CREATE DATABASE `' + Object.values(DB)[0] + '` DEFAULT CHARACTER SET utf8mb4; …'));
  }

  // ---------- B. 表 / 列 ----------
  for (const db of Object.values(DB)) {
    if (!alive.has(db)) continue;
    const [tabs] = await conn.query(
      'SELECT table_name AS n FROM information_schema.tables WHERE table_schema = ?', [db],
    );
    const tabSet = new Set(tabs.map((r) => r.n));
    const [cols] = await conn.query(
      'SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = ?', [db],
    );
    const colMap = new Map();
    for (const r of cols) {
      if (!colMap.has(r.t)) colMap.set(r.t, new Set());
      colMap.get(r.t).add(r.c);
    }

    const todo = REQUIRED.filter((x) => x.db === db);
    if (!todo.length) continue;

    console.log(C.bold(`\n▶ B. 关键表 / 列 · ${db}`));
    for (const req of todo) {
      if (!tabSet.has(req.table)) {
        problems++;
        console.log(`  ${C.bad('✗')} ${req.table}  ${C.bad('表不存在')}`);
        continue;
      }
      const have = colMap.get(req.table) || new Set();
      const missing = req.cols.filter((c) => !have.has(c));
      if (missing.length) {
        problems++;
        console.log(`  ${C.bad('✗')} ${req.table}  ${C.bad('缺列：' + missing.join(', '))}`);
      } else {
        console.log(`  ${C.ok('✓')} ${req.table}  ${C.dim(req.cols.join(', '))}`);
      }
    }
  }

  // ---------- C. 班级编号 ----------
  console.log(C.bold('\n▶ C. 班级编号是否为空（为空 → 该班无法生成学号，也就无法新增学生）'));
  for (const t of CLASS_CODE_TABLES) {
    if (!alive.has(t.db)) continue;
    try {
      const [[r]] = await conn.query(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN class_code IS NULL OR TRIM(class_code) = '' THEN 1 ELSE 0 END) AS empty_cnt
         FROM \`${t.db}\`.\`${t.table}\`
         WHERE is_deleted = 0`,
      );
      const total = Number(r.total) || 0;
      const empty = Number(r.empty_cnt) || 0;
      if (!total) {
        console.log(`  ${C.dim('—')} ${t.db}.${t.table}  ${C.dim('没有班级')}`);
      } else if (empty) {
        problems++;
        const [rows] = await conn.query(
          `SELECT ${t.nameCol} AS n FROM \`${t.db}\`.\`${t.table}\`
           WHERE is_deleted = 0 AND (class_code IS NULL OR TRIM(class_code) = '')
           ORDER BY ${t.nameCol} LIMIT 8`,
        );
        const names = rows.map((x) => x.n).filter(Boolean).join('、');
        console.log(
          `  ${C.warn('!')} ${t.db}.${t.table}  ${C.warn(`${empty}/${total} 个班没有编号`)}  ${C.dim('例：' + names)}`,
        );
      } else {
        console.log(`  ${C.ok('✓')} ${t.db}.${t.table}  ${C.dim(`${total} 个班都有编号`)}`);
      }
    } catch (e) {
      console.log(`  ${C.dim('—')} ${t.db}.${t.table}  ${C.dim('跳过：' + String(e.message).split('\n')[0])}`);
    }
  }

  // ---------- D. 权限树版本 ----------
  // ★ 2026-10-22 新增：权限树从「8 板块 55 功能点」重建为「5 板块 32 页面 146 动作」。
  //   老库（或旧的 sql/init/sms_perm.sql）里的树还是旧的，新代码用新页面名去旧树里找，
  //   匹配不上 → 除工作台外全部页面不可见 → 用户看到的就是「登录后丢了好多个板块」。
  console.log(C.bold('\n▶ D. 权限树版本（旧树 → 登录后只看到工作台，丢板块）'));
  if (!alive.has(DB.perm)) {
    console.log(`  ${C.dim('—')} ${DB.perm} 不存在，跳过`);
  } else {
    try {
      const [rows] = await conn.query(
        `SELECT module_key, COUNT(*) AS n
           FROM \`${DB.perm}\`.\`t_perm_menu\`
          WHERE is_deleted = 0
          GROUP BY module_key`,
      );
      const byBoard = new Map(rows.map((r) => [r.module_key, Number(r.n)]));
      const total = [...byBoard.values()].reduce((a, b) => a + b, 0);

      // 新树（pageRegistry 单一来源）应有的板块与页面数
      const EXPECT = { workbench: 1, consult: 5, finance: 6, perm: 7, teach: 13 };
      // 旧树的板块键，只要出现任意一个就是没迁移
      const LEGACY_KEYS = ['market', 'fin', 'train', 'acad', 'approve'];

      const legacyHit = LEGACY_KEYS.filter((k) => byBoard.has(k));
      const missingNew = Object.keys(EXPECT).filter((k) => !byBoard.has(k));

      if (legacyHit.length || missingNew.includes('workbench')) {
        problems++;
        console.log(`  ${C.bad('✗')} 权限树是旧版（当前 ${total} 个功能点）`);
        if (legacyHit.length) console.log(`     ${C.dim('检测到旧板块键：' + legacyHit.join(', '))}`);
        if (missingNew.length) console.log(`     ${C.dim('缺少新板块键：' + missingNew.join(', '))}`);
        console.log(`     ${C.bad('这就是「登录后丢了好多个板块」的原因')}`);
      } else {
        const detail = Object.keys(EXPECT)
          .map((k) => `${k}:${byBoard.get(k) || 0}`)
          .join(' ');
        const wrongCount = Object.entries(EXPECT).filter(([k, v]) => (byBoard.get(k) || 0) !== v);
        if (wrongCount.length) {
          console.log(`  ${C.warn('!')} 权限树是新版，但页面数与登记表不一致：${detail}`);
          console.log(`     ${C.dim('若你手工增删过权限点可忽略；否则跑一次 seed 脚本还原')}`);
        } else {
          console.log(`  ${C.ok('✓')} 权限树是新版  ${C.dim(`${total} 个功能点 · ${detail}`)}`);
        }
      }

      // 顺带看各职位拿到的授权行数，全是 0 也会导致「进不去任何板块」
      const [[rp]] = await conn.query(
        `SELECT COUNT(*) AS n FROM \`${DB.perm}\`.\`t_perm_role_perm\` WHERE is_deleted = 0`,
      );
      const permRows = Number(rp.n) || 0;
      if (!permRows) {
        problems++;
        console.log(`  ${C.bad('✗')} t_perm_role_perm 一条授权都没有 → 所有职位进不去任何页面`);
      } else {
        console.log(`  ${C.ok('✓')} 职位授权 ${permRows} 行`);
      }
    } catch (e) {
      console.log(`  ${C.dim('—')} 跳过：${String(e.message).split('\n')[0]}`);
    }
  }

  await conn.end().catch(() => {});

  // ---------- 结论 ----------
  if (!problems) {
    console.log(C.ok('\n✓ 结构体检通过：9 个库齐全、关键表和关键列都在、班级编号没有空值。\n'));
    process.exitCode = 0;
  } else {
    console.log(C.bold('\n── 怎么修 ──────────────────────────────────'));
    console.log('  缺表 / 缺列  →  cd server-job && npm run migrate');
    console.log('                 （会逐个库跑，失败的那个库会单独报出来）');
    console.log('  班级没编号   →  进「班级管理」给这些班补上班级编号');
    console.log('                 学号规则是 LZ + 班级编号 + 三位序号，');
    console.log('                 班级没编号时新增学生会直接报错，这是设计如此。');
    console.log('  权限树是旧版 →  npx tsx scripts/seed-perm-tree.ts --apply');
    console.log('                 （用当前代码里的页面登记表重建权限树 + 各职位授权，');
    console.log('                   会覆盖手工调过的授权；跑完重启后端）');
    console.log(C.dim('\n  修完再跑一次 npm run db:check 复检。\n'));
    process.exitCode = 1;
  }
})().catch((e) => {
  console.error(C.bad('\ndb:check 自身出错：' + e.message + '\n'));
  console.error(C.dim('  多半是 .env 里的 MySQL 账号 / 密码 / 端口不对。\n'));
  process.exitCode = 1;
});
