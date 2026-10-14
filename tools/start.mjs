#!/usr/bin/env node
/**
 * 良志学管 · 统一门户版 —— 一键启动（Node 版启动器）
 *
 * 为什么用 Node 写而不是纯 .bat：
 *   .bat 在中文 Windows 上有硬伤 —— 脚本文件本身是 UTF-8，cmd 却按 GBK(936) 解析，
 *   于是中文标题/提示一律变成乱码（“鏂囦欢涓嶅瓨鍦?”），连 set 变量都可能被污染。
 *   Node 全程按 UTF-8 处理，输出稳定不乱码，跨机器也不用手改路径。
 *
 * 用法：
 *   双击根目录的  一键启动.bat   （它只是转手调用本文件）
 *   或者直接：node tools/start.mjs
 *
 * 参数：
 *   --no-install   跳过 npm install 检查
 *   --no-browser   不自动开浏览器
 *   --backend=8004 --frontend=5173   自定义端口
 */

import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// 参数 & 输出
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const hasFlag = (f) => argv.includes(f);
const getOpt = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split('=')[1]) : dflt;
};

const NO_INSTALL = hasFlag('--no-install');
const NO_BROWSER = hasFlag('--no-browser');
const FRONTEND_PORT = getOpt('frontend', 5173);

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', gray: '\x1b[90m',
};
const paint = (c, s) => (process.env.NO_COLOR === '1' ? s : c + s + C.reset);
const step = (n, m) => console.log('\n' + paint(C.bold + C.cyan, `[${n}] ${m}`));
const ok = (m) => console.log('  ' + paint(C.green, '✔') + ' ' + m);
const warn = (m) => console.log('  ' + paint(C.yellow, '!') + ' ' + m);
const err = (m) => console.log('  ' + paint(C.red, '✘') + ' ' + m);
const note = (m) => console.log('    ' + paint(C.gray, m));

// ---------------------------------------------------------------------------
// 基础工具
// ---------------------------------------------------------------------------
function tcpAlive(host, port, timeout = 1500) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let done = false;
    const finish = (v) => { if (done) return; done = true; sock.destroy(); resolve(v); };
    sock.setTimeout(timeout);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
    sock.connect(port, host);
  });
}

async function waitPort(port, seconds, label) {
  const deadline = Date.now() + seconds * 1000;
  process.stdout.write(`    等待 ${label}（:${port}）就绪 `);
  let dots = 0;
  // 服务可能只绑 IPv4（127.0.0.1）或只绑 IPv6（::1）——两边都探，防止误报超时
  while (Date.now() < deadline) {
    if ((await tcpAlive('127.0.0.1', port)) || (await tcpAlive('::1', port))) {
      process.stdout.write(paint(C.green, ' 就绪\n'));
      return true;
    }
    if (dots++ % 2 === 0) process.stdout.write('.');
    await new Promise((r) => setTimeout(r, 1000));
  }
  process.stdout.write(paint(C.yellow, ' 超时\n'));
  return false;
}

/** 找占用某端口的 PID（Windows: netstat -ano；其它平台: lsof） */
function pidsOnPort(port) {
  const pids = new Set();
  try {
    if (process.platform === 'win32') {
      const out = spawnSync('netstat', ['-ano'], { encoding: 'utf8', windowsHide: true }).stdout || '';
      for (const line of out.split(/\r?\n/)) {
        // TCP    0.0.0.0:8004    0.0.0.0:0    LISTENING    39120
        const m = line.match(/^\s*TCP\s+\S*:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i);
        if (m && Number(m[1]) === port) pids.add(m[2]);
      }
    } else {
      const out = spawnSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).stdout || '';
      out.split(/\s+/).filter(Boolean).forEach((p) => pids.add(p));
    }
  } catch {
    /* 忽略 */
  }
  return [...pids];
}

function killPids(pids) {
  for (const pid of pids) {
    try {
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/PID', pid, '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      } else {
        spawnSync('kill', ['-9', pid], { stdio: 'ignore' });
      }
    } catch {
      /* 忽略 */
    }
  }
}

function which(cmd) {
  const exe = process.platform === 'win32' ? `${cmd}.cmd` : cmd;
  try {
    const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], {
      encoding: 'utf8', windowsHide: true,
    });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim().split(/\r?\n/)[0];
  } catch {
    /* 忽略 */
  }
  return exe;
}

/** 在 root/dir 下按当前平台的 npm 执行，实时透传输出 */
function runNpm(dir, args, label) {
  return new Promise((resolve) => {
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const child = spawn(npmCmd, args, {
      cwd: dir,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      windowsHide: false,
      env: { ...process.env, npm_config_yes: 'true' },
    });
    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); });
  });
}

// ---------------------------------------------------------------------------
// .env 解析
// ---------------------------------------------------------------------------
function parseEnv(file) {
  const map = new Map();
  if (!fs.existsSync(file)) return map;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    map.set(line.slice(0, eq).trim(), val);
  }
  return map;
}

// ===========================================================================
// 主流程
// ===========================================================================
console.log('');
console.log(paint(C.bold + C.cyan, '═'.repeat(62)));
console.log(paint(C.bold, '  良志学管系统 · 统一门户版   一键启动'));
console.log(paint(C.gray, '  市场咨询 + 财务 + 权限 + 就业 + 教务 + 班级 + 教学（初高）'));
console.log(paint(C.gray, '  一个后端 + 一个前端 + 一套统一登录'));
console.log(paint(C.bold + C.cyan, '═'.repeat(62)));
console.log(paint(C.gray, `  项目目录：${ROOT}`));

// ---- 0) Node 自检 --------------------------------------------------------
const major = Number(process.versions.node.split('.')[0]);
if (major < 18) {
  err(`Node 版本过低：${process.versions.node}，需要 18 或更高。`);
  note('下载地址：https://nodejs.org  （选 LTS）');
  process.exit(1);
}
ok(`Node ${process.versions.node}`);

// ---- 1) 环境自检（调 check-env.mjs）--------------------------------------
step('1/6', '环境自检');
const checkRes = spawnSync(process.execPath, [path.join(__dirname, 'check-env.mjs')], {
  stdio: 'inherit',
  windowsHide: true,
});
if (checkRes.status === 2) {
  // 致命问题：给出明确指引后停下，不要继续（继续只会弹一堆看不懂的报错）
  console.log('');
  err('环境自检发现必须先解决的问题，已停止启动。');
  note('按上面标 [错误] 的行改完，重新双击本文件即可。');
  console.log('');
  process.exit(1);
}

// ---- 2) 端口处理 ---------------------------------------------------------
step('2/6', '检查启动端口');

const envMap = parseEnv(path.join(ROOT, 'server-job', '.env'));
const BACKEND_PORT = Number(envMap.get('PORT') || 8004);

const busy = [];
for (const [port, label] of [[BACKEND_PORT, '后端'], [FRONTEND_PORT, '前端']]) {
  if (await tcpAlive('127.0.0.1', port)) busy.push({ port, label, pids: pidsOnPort(port) });
}

if (busy.length === 0) {
  ok(`端口 ${BACKEND_PORT} / ${FRONTEND_PORT} 都空闲`);
} else {
  for (const b of busy) {
    warn(`端口 ${b.port}（${b.label}）已被占用${b.pids.length ? `  PID: ${b.pids.join(', ')}` : ''}`);
  }
  note('常见原因：之前开过的黑窗口没关干净，或另一个项目副本正在跑。');
  note('如果直接启动，你很可能看到「接口不存在，请检查路径」或 EADDRINUSE。');
  const ans = await ask('\n  要现在把这些旧进程关掉吗？输入 Y 回车=关掉，直接回车=不动：');
  if (/^y/i.test(ans)) {
    for (const b of busy) {
      if (b.pids.length) {
        killPids(b.pids);
        ok(`已结束 ${b.label} 端口 ${b.port} 上的进程（PID ${b.pids.join(', ')}）`);
      }
    }
    await new Promise((r) => setTimeout(r, 2000));
  } else {
    warn('已跳过。之后若出现「接口不存在」，先跑 stop-all.bat 再重来。');
  }
}

// ---- 3) 依赖 ------------------------------------------------------------
step('3/6', '检查依赖');

if (NO_INSTALL) {
  note('（--no-install）跳过依赖安装');
} else {
  for (const dir of ['shared-types', 'server-job', 'web-job']) {
    const nm = path.join(ROOT, dir, 'node_modules');
    if (fs.existsSync(nm)) {
      ok(`${dir} 依赖已在，跳过`);
      continue;
    }
    console.log(`    正在安装 ${dir} 依赖（首次比较慢，请耐心等）...`);
    const done = await runNpm(path.join(ROOT, dir), ['install', '--no-audit', '--no-fund'], dir);
    if (done) ok(`${dir} 依赖安装完成`);
    else {
      err(`${dir} 依赖安装失败`);
      note('常见原因：网络问题。可在该目录手动执行 npm install 看详细报错。');
      note('如果公司网络需要镜像，试试：npm config set registry https://registry.npmmirror.com');
      process.exit(1);
    }
  }
}

// ---- 4) 编译 shared-types -----------------------------------------------
step('4/6', '编译 shared-types');
const SHARED_CJS = path.join(ROOT, 'shared-types', 'dist', 'cjs', 'index.js');
if (NO_INSTALL) {
  note('（--no-install）跳过编译');
} else {
  // 每次都编一遍：这步很快，但漏了会导致「登录进去菜单全空」这种诡异问题
  const done = await runNpm(path.join(ROOT, 'shared-types'), ['run', 'build'], 'shared-types');
  if (done) ok('shared-types 编译完成');
  else {
    err('shared-types 编译失败');
    process.exit(1);
  }
}
if (!fs.existsSync(SHARED_CJS)) {
  err('shared-types/dist/cjs/index.js 仍然不存在，前后端都会报找不到模块。');
  process.exit(1);
}

// ---- 5) 建库 / 建表 / 导数据（交给已有的 npm scripts）-------------------
step('5/6', '准备数据库（建库 · 建表 · 导演示数据）');

await ensureDatabases();

async function ensureDatabases() {
  const mysql2Path = path.join(ROOT, 'server-job', 'node_modules', 'mysql2', 'promise.js');
  if (!fs.existsSync(mysql2Path)) {
    warn('缺少 mysql2 模块，跳过数据库准备（依赖装好后重跑即可）');
    return;
  }
  const mysql = (await import('file://' + mysql2Path.replace(/\\/g, '/'))).default;

  const host = envMap.get('DB_HOST') || 'localhost';
  const port = Number(envMap.get('DB_PORT') || 3306);
  const user = envMap.get('DB_USER') || 'root';
  const password = envMap.get('DB_PASSWORD') || '';

  let conn;
  try {
    conn = await mysql.createConnection({
      host, port, user, password, charset: 'utf8mb4', timezone: '+08:00', connectTimeout: 8000,
    });
  } catch (e) {
    err(`连不上 MySQL：${e.code || e.message}`);
    note('确认 MySQL 已启动，且 server-job/.env 里的密码正确。');
    process.exit(1);
  }

  try {
    // 5a) 建 9 个库
    const DB_KEYS = [
      ['DB_NAME', 'sms_job'], ['DB_NAME_EDU', 'sms_edu'],
      ['DB_NAME_CLASS', 'sms_class'], ['DB_NAME_COMMON', 'sms_common'],
      ['DB_NAME_CLASS_JH', 'sms_class_jh'], ['DB_NAME_PORTAL', 'sms_portal'],
      ['DB_NAME_CONSULT', 'sms_consult'], ['DB_NAME_FINANCE', 'sms_finance'],
      ['DB_NAME_PERM', 'sms_perm'],
    ];
    let created = 0;
    for (const [key, dflt] of DB_KEYS) {
      const db = envMap.get(key) || dflt;
      const [[row]] = await conn.query(
        'SELECT COUNT(*) AS n FROM information_schema.schemata WHERE schema_name = ?', [db],
      );
      if (Number(row.n) === 0) {
        await conn.query(
          `CREATE DATABASE \`${db}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
        );
        created++;
      }
    }
    ok(created ? `新建了 ${created} 个库，9 个库现已齐全` : '9 个库已存在，跳过建库');
  } finally {
    await conn.end().catch(() => {});
  }

  // 5b) migrate：建 5 个库的表（job / edu / class / class-common / class-jh）
  console.log('    正在建表（knex migrate，覆盖就业/教务/班级/公共/初高 5 个库）...');
  const mOk = await runNpm(path.join(ROOT, 'server-job'), ['run', 'migrate'], 'migrate');
  if (mOk) ok('表结构已就绪');
  else warn('建表过程有报错。若只是「已是最新」可以忽略，否则看上面的报错原文。');

  // 5c) 导入 4 个库的演示数据（仅当该库没有业务表时才导）
  const DEMO = ['sms_portal', 'sms_consult', 'sms_finance', 'sms_perm'];

  /**
   * ★ 2026-10-14：SQL 目录改为「优先仓库自带，回退本机导出」
   *
   * 【为什么】
   *   原来只读根目录 `数据库导出/`，而那个目录被 .gitignore 排除了。
   *   于是「斌哥本地能跑、同事 clone 后登录就报『数据表不存在』」——
   *   四个模块库（portal/consult/finance/perm）压根建不出来。
   *
   *   现在把脱敏后的初始化 SQL 放进 `server-job/sql/init/`（随 git 分发），
   *   先找它、找不到再回退到本机的 `数据库导出/`。
   *   两个目录都在时以仓库自带的为准（它才是有版本管理的那份）。
   */
  const sqlDirs = [
    path.join(ROOT, 'server-job', 'sql', 'init'), // 随仓库分发（推荐）
    path.join(ROOT, '数据库导出'),                  // 本机导出（回退）
  ];
  const findSql = (name) => sqlDirs.map((d) => path.join(d, name)).find((p) => fs.existsSync(p));

  for (const db of DEMO) {
    const sqlFile = findSql(`${db}.sql`);
    if (!sqlFile) {
      warn(`没找到 ${db}.sql（找过 server-job/sql/init/ 与 数据库导出/），跳过`);
      continue;
    }
    // 判空：库里有几张表？有就不是空库，别导（导出文件含 DROP，会冲掉已有数据）
    const alive = await tableCount(db);
    if (alive === null) { warn(`${db} 状态未知，跳过导入`); continue; }
    if (alive > 0) { ok(`${db} 已有 ${alive} 张表，跳过导入`); continue; }

    console.log(`    正在导入 ${db} 演示数据 ...`);
    const imported = await importSql(sqlFile, db);
    if (imported) ok(`${db} 导入完成`);
    else warn(`${db} 导入失败（不影响其它模块，可稍后手动导入）`);
  }

  /**
   * 5d) 补统一表（sms_common 的 43 张 t_uni_*）
   *
   * 【为什么必须单独补】
   *   `npm run migrate` 的 5 个迁移目录里，只有 `20261009_010_create_uni_tables_p3.js`
   *   建了 8 张统一表，其余 35 张**没有任何迁移创建它们**（当初是用一次性脚本 + SQL 建库的）。
   *   → 只跑 migrate 的话，同事本地只有 8/43 张，切读模式各页面会大面积缺表。
   *
   * 【为什么可以无条件跑】
   *   uni-tables.sql 全篇是 `CREATE TABLE IF NOT EXISTS`，**不含 DROP / INSERT**，
   *   跑一遍只是把缺的建出来，已有的跳过，不动任何数据 → 完全幂等，每次启动跑都安全。
   *   放在 migrate **之后**：migrate 建好的表保持不动，只补齐缺的。
   */
  const uniSql = findSql('uni-tables.sql');
  if (uniSql) {
    console.log('    正在补齐统一表（sms_common.t_uni_*，幂等）...');
    const uOk = await importSql(uniSql, 'sms_common');
    if (uOk) ok('统一表已就绪');
    else warn('统一表导入失败（切读模式下各业务页可能缺表，可手动导入 sql/init/uni-tables.sql）');
  } else {
    warn('没找到 uni-tables.sql，跳过统一表补齐');
  }

  async function tableCount(db) {
    const mysql2Path2 = path.join(ROOT, 'server-job', 'node_modules', 'mysql2', 'promise.js');
    const m = (await import('file://' + mysql2Path2.replace(/\\/g, '/'))).default;
    let c;
    try {
      c = await m.createConnection({
        host, port, user, password, charset: 'utf8mb4', timezone: '+08:00', connectTimeout: 8000,
      });
      const [[r]] = await c.query(
        'SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ?', [db],
      );
      return Number(r.n);
    } catch {
      return null;
    } finally {
      if (c) await c.end().catch(() => {});
    }
  }

  /**
   * 导入 .sql 到指定库。
   *
   * ★ 2026-10-09 加固：加了「mysql2 驱动」回退通道。
   *
   * 【为什么必须回退】
   *   原来只找系统 `mysql` 命令行客户端。而「统一门户版」的目标场景是
   *   **只装了 MySQL/MariaDB 服务、没装客户端工具**的机器（本机就是这样）。
   *   于是这 4 个库（portal/consult/finance/perm）永远建不出来 →
   *   门户登录查 t_sys_account 报 50002「数据表不存在」→
   *   浏览器上只看到 Network Error。而启动器给的原因却是
   *   「找不到 mysql 命令行客户端，无法自动导入演示数据」——
   *   用户根本不知道这就是登录失败的原因。
   *
   *   现在：客户端找不到（或执行失败）→ 自动改用项目自带的 mysql2 驱动导入
   *   （server-job/node_modules/mysql2 本来就随包分发），并顺手做
   *   MySQL 8 → MariaDB 的兼容净化。启动器从此自给自足，换机器不必先装客户端。
   */
  async function importSql(sqlFile, db) {
    const candidates = [];
    // 1) PATH 里的 mysql
    candidates.push('mysql');
    // 2) 常见安装位置
    for (const base of [
      'C:/Program Files/MySQL',
      'C:/Program Files (x86)/MySQL',
      'D:/mysql', 'C:/mysql',
      path.join(ROOT, '..', 'mysql'),
    ]) {
      if (!fs.existsSync(base)) continue;
      let entries = [];
      try { entries = fs.readdirSync(base); } catch { continue; }
      for (const e of entries) {
        const p = path.join(base, e, 'bin', 'mysql.exe');
        if (fs.existsSync(p)) candidates.push(p);
      }
      const direct = path.join(base, 'bin', 'mysql.exe');
      if (fs.existsSync(direct)) candidates.push(direct);
    }

    for (const exe of candidates) {
      const r = spawnSync(
        exe,
        ['-h127.0.0.1', `-P${port}`, `-u${user}`, '--default-character-set=utf8mb4'],
        {
          input: fs.readFileSync(sqlFile),
          env: { ...process.env, MYSQL_PWD: password },
          stdio: ['pipe', 'ignore', 'pipe'],
          windowsHide: true,
          maxBuffer: 64 * 1024 * 1024,
        },
      );
      if (r.error && r.error.code === 'ENOENT') continue; // 这个候选不存在，试下一个
      if (r.status === 0) return true;
      const stderr = (r.stderr || '').toString().slice(0, 400);
      if (stderr) note(stderr.split('\n')[0]);
      break; // 找到客户端但执行失败 → 不再试别的路径，转 mysql2 回退
    }

    // ★ 回退：项目自带的 mysql2 驱动（不需要任何外部客户端）
    return await importSqlViaMysql2(sqlFile, db);
  }

  /**
   * 用 mysql2 驱动导入 .sql（启动器的回退通道）。
   *
   * ⚠️ 必须做 MySQL 8 → MariaDB 兼容净化，否则在 MariaDB 上建表会直接失败：
   *   ① `utf8mb4_0900_ai_ci` —— MySQL 8.0 专属排序规则，MariaDB 完全不认
   *      → 换成 `utf8mb4_unicode_ci`
   *   ② 80016 版本注释里的 DEFAULT ENCRYPTION 子句 —— MariaDB 不认；
   *      且 MariaDB 的版本号比较会把 10.4 当作大于 8.0.16，于是真的去执行它
   *      → 整段删掉
   */
  async function importSqlViaMysql2(sqlFile, db) {
    const mysql2Path = path.join(ROOT, 'server-job', 'node_modules', 'mysql2', 'promise.js');
    if (!fs.existsSync(mysql2Path)) {
      warn('既没有 mysql 命令行客户端，也找不到 server-job/node_modules/mysql2，无法导入。');
      note('可以手动导入：数据库导出/*.sql 用 Navicat 之类的工具跑一遍即可。');
      return false;
    }
    note('未找到可用的 mysql 客户端，改用项目自带 mysql2 驱动导入 ...');
    const m = (await import('file://' + mysql2Path.replace(/\\/g, '/'))).default;
    const sql = fs
      .readFileSync(sqlFile, 'utf8')
      .replace(/utf8mb4_0900_ai_ci/g, 'utf8mb4_unicode_ci')
      .replace(/\/\*!80016[\s\S]*?\*\//g, '');
    let c;
    try {
      c = await m.createConnection({
        host, port, user, password,
        charset: 'utf8mb4', multipleStatements: true, connectTimeout: 15000,
      });
      await c.query(sql);
      return true;
    } catch (e) {
      note(`mysql2 导入 ${db} 失败：${e.code || ''} ${e.message}`);
      return false;
    } finally {
      if (c) await c.end().catch(() => {});
    }
  }
}

// ---- 6) 起前后端 --------------------------------------------------------
step('6/6', '启动前后端服务');

const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';

function launch(title, dir, args, extraEnv = {}) {
  /**
   * ★★★ 2026-10-12 修复「服务启动后自己消失」
   *
   * 【原 bug】原来是 `detached: false` + 继承父进程 stdio：
   *   `一键启动.bat` 跑完 `node tools/start.mjs` 就 `exit /b 0`，
   *   cmd 窗口关闭 → 附着在该控制台上的前后端子进程被一起终止。
   *   现象：启动成功、浏览器能打开、能登录能操作，然后服务凭空消失，
   *   前端所有请求 15s 超时（"timeout of 15000ms exceeded"），
   *   刷新回登录页、点任何页面都是「加载失败」。
   *   而脚本打印的却是「本窗口可以关掉，不影响已经起来的服务」—— 承诺是假的。
   *
   * 【修法】三件事一起做，缺一不可：
   *   ① `detached: true` —— 子进程进自己的进程组，不随父进程退出而死
   *   ② `child.unref()` —— 父进程不必等它，start.mjs 可以正常退出
   *   ③ `stdio: 'ignore'` —— 不继承父进程 stdio。父进程的控制台一关，
   *      附着在该控制台（继承 stdio）的子进程会收到 CTRL_CLOSE_EVENT 被终止；
   *      断开 stdio 则彻底脱离控制台。
   *      （试过把 fd 传进去写 logs/backend.log，实测子进程什么都没写进去、
   *        服务也没起来，所以用 'ignore' 最稳，代价是看不到子进程输出）
   *
   * 【验证】`node tools/start.mjs` 跑完退出后，端口必须仍在 LISTENING。
   */
  const child = spawn(npmCmd, args, {
    cwd: dir,
    shell: isWin,
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
    env: { ...process.env, ...extraEnv, FORCE_COLOR: '1' },
  });
  child.unref();
  return child;
}

console.log(`    启动后端（端口 ${BACKEND_PORT}）...`);
const backend = launch('后端', path.join(ROOT, 'server-job'), ['run', 'dev']);

console.log(`    启动前端（端口 ${FRONTEND_PORT}）...`);
const frontend = launch('前端', path.join(ROOT, 'web-job'), ['run', 'dev'], {
  // vite.config.ts 会读这两个变量决定监听端口（优先 FRONTEND_PORT）
  FRONTEND_PORT: String(FRONTEND_PORT),
  PORT: String(FRONTEND_PORT),
});

console.log('');
console.log(paint(C.gray, '  ✔ 服务已在后台独立运行，本窗口可以关掉，不影响使用'));
console.log(paint(C.gray, '  要停服务：双击根目录 stop-all.bat（MySQL 会保留运行）'));
console.log(paint(C.gray, '  首次启动要编译，大约 1 分钟，请耐心等 ...'));

const url = `http://localhost:${FRONTEND_PORT}`;
const beOk = await waitPort(BACKEND_PORT, 180, '后端');
if (beOk) {
  try {
    const res = await fetch(`http://127.0.0.1:${BACKEND_PORT}/health`);
    const j = await res.json();
    if (j && j.code === 200) ok(`后端健康检查通过（${JSON.stringify(j.data)}）`);
    else warn('后端 /health 返回异常，可能跑的是旧版本后端。');
  } catch {
    warn('后端 /health 没响应。');
  }
}

const feOk = await waitPort(FRONTEND_PORT, 120, '前端');

/**
 * ★ 2026-10-12：防「假成功」
 *
 * 原来只等端口通就宣布启动成功。但端口通 ≠ 服务能活：
 * 本机实测过一次「端口就绪、健康检查通过、脚本退出，3 秒后两个端口全消失」。
 * 所以这里在宣布成功前，隔几秒再确认一次端口还在。
 */
let aliveOk = beOk && feOk;
if (aliveOk) {
  console.log(paint(C.gray, '  等待 4 秒后复核服务是否仍在运行 ...'));
  await new Promise((r) => setTimeout(r, 4000));
  const beAgain = (await tcpAlive('127.0.0.1', BACKEND_PORT)) || (await tcpAlive('::1', BACKEND_PORT));
  const feAgain = (await tcpAlive('127.0.0.1', FRONTEND_PORT)) || (await tcpAlive('::1', FRONTEND_PORT));
  if (!beAgain || !feAgain) {
    aliveOk = false;
    console.log('');
    warn('服务起来后又消失了（通常是启动方式导致子进程被连带终止）。');
    console.log(paint(C.gray, '  可用「手动启动」兜底，开两个终端分别跑：'));
    console.log(paint(C.gray, '    终端1: cd server-job && npm run dev'));
    console.log(paint(C.gray, '    终端2: cd web-job && npm run dev'));
  } else {
    ok('复核通过：服务在独立运行，关掉本窗口不影响使用');
  }
}

console.log('');
console.log(paint(C.bold + C.cyan, '═'.repeat(62)));
if (aliveOk) {
  console.log(paint(C.green + C.bold, '  启动成功'));
  console.log('');
  console.log(`  页面地址：  ${paint(C.bold, url)}`);
  console.log(`  后端自检：  http://localhost:${BACKEND_PORT}/health`);
  console.log('');
  console.log(paint(C.bold, '  演示账号（密码统一 123456，登录页右侧点一下自动填入）'));
  console.log(paint(C.gray, '    qiansy   钱守义 · 校长        → 全部 7 个模块，可改数据'));
  console.log(paint(C.gray, '    admin    系统管理员          → 全部 7 个模块，页面级只读'));
  console.log(paint(C.gray, '    zhangls  张老师 · 咨询师      → 只看得到「市场咨询」'));
  console.log(paint(C.gray, '    liukj    刘会计 · 财务专员    → 只看得到「财务管理」'));
  console.log(paint(C.gray, '    linx     林晓 · 权限管理员    → 只看得到「权限管理」'));
  console.log('');
  console.log(paint(C.gray, '  看不到某个模块是正常的：左侧菜单按你的账号被授权的模块渲染。'));
} else {
  console.log(paint(C.yellow + C.bold, '  服务没有在等待时间内全部就绪'));
  console.log('');
  if (!beOk) console.log(paint(C.red, `    ✘ 后端 :${BACKEND_PORT} 没起来 —— 请看后端窗口的报错原文`));
  if (!feOk) console.log(paint(C.red, `    ✘ 前端 :${FRONTEND_PORT} 没起来 —— 请看前端窗口的报错原文`));
  if (beOk && feOk && !aliveOk) {
    console.log(paint(C.red, '    ✘ 端口就绪过但又消失了（子进程被连带终止）'));
  }
  console.log('');
  console.log(paint(C.gray, `    也可以手动用浏览器打开： ${url}`));
}
console.log(paint(C.bold + C.cyan, '═'.repeat(62)));
console.log('');

if (!NO_BROWSER && feOk) {
  const openCmd = isWin ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const openArgs = isWin ? ['/c', 'start', '', url] : [url];
  try {
    spawn(openCmd, openArgs, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    ok('已在浏览器中打开。');
  } catch {
    console.log('    ' + paint(C.gray, `没能自动开浏览器，手动访问： ${url}`));
  }
}

if (aliveOk) {
  console.log(paint(C.gray, '  本窗口可以关掉，不影响已经起来的服务。'));
}
console.log(paint(C.gray, '  要停服务：双击根目录 stop-all.bat（MySQL 会保留运行）。'));
console.log('');
