/**
 * 一次跑完【全部】数据库迁移（npm run migrate 的入口）
 *
 * ★ 2026-10-22 新增，修的是「新机器拉取后跑不起来」的老毛病。
 *
 * 【为什么不能用 `knex migrate:latest && knex migrate:latest --env edu && ...`】
 *   原来的写法是 `&&` 串联，只要第一个库（sms_job）报一个错，
 *   后面的 edu / class / class-common / class-jh 就【一个都不跑】。
 *   实际踩到过：主目录里一条改咨询表的迁移在 sms_job 上必然报
 *   「Table 'sms_job.t_consult_student' doesn't exist」，
 *   于是新机器上 4 个库是空的 ——
 *   表现就是「新建班级提示数据库字段不存在」「无法新增学生」，
 *   而且日志里只有一行英文，很难联想到是"别的库根本没建"。
 *
 * 【现在的行为】
 *   1. 按固定顺序逐个库跑，某个库失败只记录下来，不打断后面；
 *   2. class-common 依赖统一表（43 张 t_uni_*）：如果 sms_common 还是空的，
 *      先把 sql/init/uni-tables.sql 导进去再迁移（该文件全为
 *      CREATE TABLE IF NOT EXISTS，不含 DROP / INSERT，可重复执行）；
 *   3. 最后打印一张"哪个库成功 / 哪个库失败 / 失败原因"的汇总表，
 *      有失败则退出码为 1（一键启动.bat 能感知到）。
 *   4. 咨询库（sms_consult）不用 knex 跑（历史迁移文件已删，knex 会判目录
 *      corrupt），改由 scripts/fix-consult-columns.mjs 幂等补列，这里顺带调起。
 *
 * 用法：
 *   cd server-job
 *   npm run migrate            # 全部 5 个 knex 库 + 咨询库补列
 *   npm run migrate -- class-jh # 只跑指定库（可写多个）
 */

import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const configs = require(path.join(ROOT, 'knexfile.js'));
const knexFactory = require('knex');

/** 执行顺序是刻意排的：class-common 依赖统一表（见下面的自动导入） */
const ORDER = [
  ['development', 'sms_job', '就业 / 实训'],
  ['edu', 'sms_edu', '教务'],
  ['class', 'sms_class', '大学部班级'],
  ['class-common', 'sms_common', '统一表（跨模块副本）'],
  ['class-jh', 'sms_class_jh', '初高部班级'],
];

/**
 * 迁移之后还要补的库 —— 咨询库（sms_consult）。
 *
 * 它不在这里跑 knex：sms_consult.knex_migrations 里记着 8 条已删除的一次性迁移，
 * knex 会判目录 corrupt 直接报错。所以改用独立脚本补列（幂等）。
 */
const POST_STEPS = [
  ['scripts/fix-consult-columns.mjs', '咨询表补列', 'sms_consult'],
  /**
   * ★ 2026-10-22：咨询状态对账
   *
   * 「教学侧已建档入班、咨询侧还停在待分班 / 没学号」这类历史数据，
   * 靠一次幂等对账补齐（只升不降、不碰退费流失）。
   * 必须排在学籍库（class / class-jh）迁移之后 —— 它要读那边的档案。
   */
  ['scripts/repair-consult-state.mjs', '咨询状态对账', 'sms_consult'],
  /**
   * ★ 2026-10-23：进班日（trial_start）对账
   *
   * 已入班但 trial_start 为空的学生（缴全款直接转正式的走 FORMAL 分支，
   * 早期没写这一列），退费弹窗算不出最早可选日 → 日历能选到几个月前。
   * 用入班历史 / 建档日补齐，只补空不覆盖。
   */
  ['scripts/repair-trial-start.mjs', '进班日对账', 'sms_consult'],
];

const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const targets = only.length ? ORDER.filter(([env]) => only.includes(env)) : ORDER;

/**
 * 控制台颜色：Windows 传统 cmd 不认 ANSI 转义（会显示成 ←[32m 这种乱码），
 * 所以只在"确实是现代终端"时才上色 —— 一键启动.bat 里跑的是 cmd，
 * 这种情况下走纯文本，宁可不好看也不能是乱码。
 */
const USE_COLOR =
  !process.env.NO_COLOR &&
  !!process.stdout.isTTY &&
  (process.platform !== 'win32' || !!process.env.WT_SESSION || !!process.env.TERM_PROGRAM);
const paint = (code) => (s) => (USE_COLOR ? `\x1b[${code}m${s}\x1b[0m` : String(s));

const C = {
  ok: paint(32),
  bad: paint(31),
  dim: paint(2),
  bold: paint(1),
};

/** sms_common 是不是一张业务表都没有（新库） */
async function isEmptyDatabase(db) {
  const mysql = require(path.join(ROOT, 'node_modules', 'mysql2', 'promise.js'));
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    charset: 'utf8mb4',
    multipleStatements: true,
  });
  try {
    const [[r]] = await conn.query(
      'SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ?',
      [db],
    );
    return Number(r.n) === 0;
  } finally {
    await conn.end().catch(() => {});
  }
}

/** 导入一个 .sql（多语句），返回导入语句条数 */
async function importSqlFile(file) {
  const mysql = require(path.join(ROOT, 'node_modules', 'mysql2', 'promise.js'));
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    charset: 'utf8mb4',
    multipleStatements: true,
  });
  try {
    const sql = fs.readFileSync(file, 'utf8');
    // 文件自带 CREATE DATABASE / USE，不用指定库
    await conn.query(sql);
    return (sql.match(/create table/gi) || []).length;
  } finally {
    await conn.end().catch(() => {});
  }
}

const uniSql = path.join(ROOT, 'sql', 'init', 'uni-tables.sql');

(async () => {
  console.log(C.bold('\n▶ 数据库迁移（按库逐个执行，单个库失败不会中断其它库）\n'));

  const report = [];

  for (const [env, dbName, label] of targets) {
    const cfg = configs[env];
    if (!cfg) {
      report.push({ env, dbName, label, status: 'SKIP', detail: 'knexfile 里没有这个 env' });
      console.log(`  ${C.dim('—')} ${label.padEnd(10, ' ')} ${dbName}  ${C.dim('跳过（未配置）')}`);
      continue;
    }

    // class-common：统一表还没建就先导 SQL，否则 010 迁移会因缺表直接报错
    if (env === 'class-common') {
      try {
        if (await isEmptyDatabase(dbName) && fs.existsSync(uniSql)) {
          console.log(`  ${C.dim('·')} ${dbName} 是空库，先导入 sql/init/uni-tables.sql（幂等）…`);
          const n = await importSqlFile(uniSql);
          console.log(`  ${C.dim('·')} 已导入 ${n} 张统一表`);
        }
      } catch (e) {
        console.log(`  ${C.dim('·')} 统一表导入失败：${e.message}（继续尝试迁移）`);
      }
    }

    const db = knexFactory(cfg);
    try {
      const [batch, log] = await db.migrate.latest();
      const n = Array.isArray(log) ? log.length : 0;
      report.push({
        env,
        dbName,
        label,
        status: 'OK',
        detail: n ? `第 ${batch} 批，执行 ${n} 条` : '已是最新',
      });
      console.log(`  ${C.ok('✓')} ${label.padEnd(10, ' ')} ${dbName}  ${n ? `执行 ${n} 条` : C.dim('已是最新')}`);
    } catch (e) {
      const msg = String(e.message || e).split('\n')[0];
      report.push({ env, dbName, label, status: 'FAIL', detail: msg });
      console.log(`  ${C.bad('✗')} ${label.padEnd(10, ' ')} ${dbName}  ${C.bad(msg)}`);
    } finally {
      await db.destroy().catch(() => {});
    }
  }

  // ---------- 迁移之外还要补的库 ----------
  if (!only.length) {
    for (const [rel, label, dbName] of POST_STEPS) {
      const file = path.join(ROOT, rel);
      if (!fs.existsSync(file)) continue;
      const r = spawnSync(process.execPath, [file], { cwd: ROOT, encoding: 'utf8' });
      const out = String(r.stdout || '').trim();
      if (out) console.log(out);
      if (r.status === 0) {
        report.push({ env: rel, dbName, label, status: 'OK', detail: out.split('\n').pop() || '完成' });
      } else {
        const msg = String(r.stderr || '').split('\n').filter(Boolean)[0] || '失败';
        report.push({ env: rel, dbName, label, status: 'FAIL', detail: msg });
        console.log(`  ${C.bad('✗')} ${label.padEnd(10, ' ')} ${dbName}  ${C.bad(msg)}`);
      }
    }
  }

  // ---------- 汇总 ----------
  const failed = report.filter((r) => r.status === 'FAIL');
  const skipped = report.filter((r) => r.status === 'SKIP');

  console.log(C.bold('\n── 迁移结果 ──────────────────────────────────'));
  for (const r of report) {
    const tag = r.status === 'OK' ? C.ok('成功') : r.status === 'FAIL' ? C.bad('失败') : C.dim('跳过');
    console.log(`  ${tag}  ${r.label.padEnd(10, ' ')} ${r.dbName.padEnd(15, ' ')} ${C.dim(r.detail)}`);
  }

  if (failed.length) {
    console.log(C.bad(`\n✗ ${failed.length} 个库迁移失败。上面每个库的第一行错误就是要修的地方；`));
    console.log(C.bad('  修完重新跑 npm run migrate 即可（已成功的库不会重复执行）。\n'));
    process.exitCode = 1;
  } else if (skipped.length) {
    console.log(C.dim(`\n完成，但有 ${skipped.length} 个库被跳过（不影响使用）。\n`));
  } else {
    console.log(C.ok('\n✓ 全部数据库迁移完成。\n'));
  }
})().catch((e) => {
  console.error(C.bad('\n迁移脚本自身出错：' + e.message + '\n'));
  process.exitCode = 1;
});
