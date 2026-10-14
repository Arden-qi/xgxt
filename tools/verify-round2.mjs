/**
 * 统一门户版 · 第二轮需求验证（2026-10-06）
 *
 * 覆盖用户提的 4 件事：
 *   ① 系统导航页里 4 个「未开放」的导航（legacy 空分组）应删除
 *   ② 校长的权限为全模块展示 —— 登录后应看得到全部 7 个模块
 *   ③ 所有「选择角色」的地方，选项来自【系统内账户所对应的角色】
 *      （建班/升实训弹窗的 班主任/教员/助教/项目经理/就业指导老师）
 *   ④ 班级管理里阶段=6 升实训时要选 项目经理 + 就业指导老师，
 *      确认后班级进入【就业管理 → 班级信息管理】
 *
 * 用法：node tools/verify-round2.mjs        （前后端需在跑：8004 + 5173）
 *
 * ⚠️ 第 ④ 段会真的把 U2601 升实训（改班级状态 + 在 sms_job 建班），
 *    跑完请执行 `npm --prefix server-job run seed:all` 复位演示数据。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUTDIR = path.join(HERE, '_out');
fs.mkdirSync(OUTDIR, { recursive: true });

const require = createRequire(path.join(ROOT, 'server-job', 'package.json'));
const mysql = require('mysql2/promise');

const API = 'http://127.0.0.1:8004';
const WEB = 'http://localhost:5173';

/* ---------------- 结果收集 ---------------- */
const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass: !!pass, detail });
  console.log(`  ${pass ? '✅' : '❌'} ${name}${detail ? '  → ' + detail : ''}`);
}
function section(t) {
  console.log(`\n===== ${t} =====`);
}

/* ---------------- DB ---------------- */
function loadEnv() {
  const env = {};
  const p = path.join(ROOT, 'server-job', '.env');
  if (!fs.existsSync(p)) return env;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const i = s.indexOf('=');
    if (i < 0) continue;
    env[s.slice(0, i).trim()] = s.slice(i + 1).trim();
  }
  return env;
}
const ENV = loadEnv();
const D = {
  portal: ENV.DB_NAME_PORTAL || 'sms_portal',
  perm: ENV.DB_NAME_PERM || 'sms_perm',
  class: ENV.DB_NAME_CLASS || 'sms_class',
  job: ENV.DB_NAME_JOB || 'sms_job',
};

/* ---------------- HTTP ---------------- */
async function login(account) {
  const r = await fetch(`${API}/api/portal/account/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account, password: '123456' }),
  });
  const j = await r.json();
  const token = j?.data?.token;
  if (!token) throw new Error(`登录失败 ${account}: ${j?.message}`);
  return {
    token,
    account,
    async call(method, url, body) {
      const res = await fetch(API + url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      let json = null;
      try { json = await res.json(); } catch { /* ignore */ }
      return { status: res.status, json, msg: json?.message ?? '' };
    },
  };
}

/* ============================================================
 * 轻量 CDP（断言前端菜单 / 弹窗，只读不写）
 * ============================================================ */
const PORT = 9341;
const BROWSER = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].find((p) => fs.existsSync(p));

let child = null;
let ws = null;
let msgId = 0;
const pending = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdpStart() {
  if (!BROWSER) return false;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-r2-'));
  child = spawn(BROWSER, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
    '--window-size=1680,1050', 'about:blank',
  ], { stdio: 'ignore' });

  let url = null;
  for (let i = 0; i < 40 && !url; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      url = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl ?? null;
    } catch { /* retry */ }
    if (!url) await sleep(250);
  }
  if (!url) return false;

  ws = new WebSocket(url);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    if (m.id && pending.has(m.id)) {
      const { resolve, reject, to } = pending.get(m.id);
      clearTimeout(to); pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    }
  };
  await send('Page.enable');
  await send('Runtime.enable');
  return true;
}
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    const to = setTimeout(() => reject(new Error('timeout ' + method)), 30000);
    pending.set(id, { resolve, reject, to });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r.result?.value;
}
async function navTo(hash, wait = 2600) {
  await send('Page.navigate', { url: `${WEB}/?t=${Date.now()}#${hash}` }, 30000);
  await sleep(wait);
}
async function loginAs(account) {
  await ev(`(() => { try { localStorage.clear(); } catch(e){} return true; })()`);
  await navTo('/login', 2200);
  await ev(`(() => {
    const items = [...document.querySelectorAll('.demo-item')];
    const el = items.find(x => x.innerText.includes('${account}'));
    if (el) { el.click(); return true; }
    return false;
  })()`);
  await sleep(500);
  await ev(`(() => { const b = document.querySelector('.submit'); if (b) b.click(); return !!b; })()`);
  await sleep(3600);
}
/** 侧栏结构：分组标题 + 顶层单层菜单项（= legacy 空分组会落在这里） */
const readSidebar = () => `(() => {
  const groups = [...document.querySelectorAll('.el-sub-menu__title')]
    .map(e => e.innerText.replace(/\\s+/g, ' ').trim());
  const plain = [...document.querySelectorAll('.side-menu > .el-menu-item')]
    .map(e => e.innerText.trim());
  return { groups, plain };
})()`;

/* ============================================================ */
async function main() {
  const db = await mysql.createConnection({
    host: ENV.DB_HOST || '127.0.0.1',
    port: Number(ENV.DB_PORT || 3306),
    user: ENV.DB_USER || 'root',
    password: ENV.DB_PASSWORD || '',
    charset: 'utf8mb4',
  });
  const q = async (sql, args = []) => (await db.query(sql, args))[0];

  const admin = await login('admin');
  const qiansy = await login('qiansy');

  /* ============================================================
   * 一、校长的权限 = 全模块
   * ============================================================ */
  section('一、校长的权限为全模块展示');
  const ALL7 = ['consult', 'finance', 'perm', 'job', 'edu', 'class', 'class-jh'];
  const prof = (await qiansy.call('GET', '/api/portal/account/profile')).json?.data;
  const mods = prof?.account?.modules ?? [];
  check('①-1 校长账号登录成功且返回 7 个模块', ALL7.every((k) => mods.includes(k)) && mods.length === 7,
    `modules=${JSON.stringify(mods)}`);
  const vis = (prof?.visibleModules ?? []).map((m) => m.key);
  check('①-2 门户下发的 visibleModules = 7 个模块',
    vis.length === 7 && ALL7.every((k) => vis.includes(k)), JSON.stringify(vis));
  check('①-3 校长能进「权限管理」（此前缺失）',
    !(await qiansy.call('GET', '/api/perm/overview/get')).json?.code?.toString().startsWith('403'),
    'HTTP ' + (await qiansy.call('GET', '/api/perm/overview/get')).status);
  const admProf = (await admin.call('GET', '/api/portal/account/profile')).json?.data;
  check('①-4 系统管理员同样 7 个模块（口径一致）',
    (admProf?.account?.modules ?? []).length === 7, JSON.stringify(admProf?.account?.modules));

  /* ============================================================
   * 二、账号 ↔ 权限库对齐 & 岗位账号补全
   * ============================================================ */
  section('二、账号与角色（岗位账号补全）');
  const portalRows = await q(`SELECT account, user_name, modules FROM \`${D.portal}\`.t_sys_account WHERE is_deleted = 0`);
  check('②-1 门户账号 16 个', portalRows.length === 16, `实际 ${portalRows.length}`);

  const permRows = await q(
    `SELECT u.account, u.user_name, u.is_deleted, GROUP_CONCAT(r.role_code) AS roles
       FROM \`${D.perm}\`.t_perm_user u
       LEFT JOIN \`${D.perm}\`.t_perm_user_role ur ON ur.user_id = u.id AND ur.is_deleted = 0
       LEFT JOIN \`${D.perm}\`.t_perm_role r ON r.id = ur.role_id
      WHERE u.is_deleted = 0 GROUP BY u.id`,
  );
  check('②-2 权限库有效账号 = 门户账号（一一对应，无僵尸）',
    permRows.length === 16 && permRows.every((r) => portalRows.some((p) => p.account === r.account)),
    `perm=${permRows.length}`);

  const want = { chenxf: 'TEACH_TUTOR', zhaomx: 'TEACH_ASSIST', sunjl: 'RM_PROJECT' };
  for (const [acc, role] of Object.entries(want)) {
    const r = permRows.find((x) => x.account === acc);
    check(`②-3 新账号 ${acc} 角色 = ${role}`, (r?.roles ?? '').includes(role), r?.roles ?? '（无）');
  }

  /* ============================================================
   * 三、岗位下拉 = 系统账户 + 其角色
   * ============================================================ */
  section('三、岗位下拉数据源 = 账户角色');
  const groups = ['headTeacher', 'teacher', 'assistant', 'projectManager', 'employmentTeacher'];
  const pools = {};
  for (const g of groups) {
    const r = await admin.call('GET', `/api/class/meta/staff?group=${g}`);
    pools[g] = r.json?.data?.list ?? [];
    check(`③-1 「${g}」下拉非空`, pools[g].length > 0, JSON.stringify(pools[g].map((x) => x.userName)));
  }

  // 反证：返回的人必须真的持有该岗位对应的角色（查 sms_perm）
  const roleOf = new Map(permRows.map((r) => [r.account, r.roles ?? '']));
  const idToAccount = new Map(
    (await q(`SELECT id, account FROM \`${D.portal}\`.t_sys_account`)).map((r) => [r.id, r.account]),
  );
  const expectRole = {
    headTeacher: 'TEACH_HEAD', teacher: 'TEACH_TUTOR', assistant: 'TEACH_ASSIST',
    projectManager: 'RM_PROJECT', employmentTeacher: 'JOB_STAFF',
  };
  let roleOk = true;
  const badRole = [];
  for (const g of groups) {
    for (const s of pools[g]) {
      const acc = idToAccount.get(s.userId);
      const roles = roleOf.get(acc) ?? '';
      if (!roles.includes(expectRole[g])) { roleOk = false; badRole.push(`${g}:${s.userName}(${roles})`); }
    }
  }
  check('③-2 下拉里每个人的角色都与岗位匹配', roleOk, badRole.join(', '));

  check('③-3 userId 用的是门户账号 id（与班级表口径一致）',
    groups.every((g) => pools[g].every((s) => idToAccount.has(s.userId))),
    `样例 ${pools.headTeacher[0]?.userName} → ${idToAccount.get(pools.headTeacher[0]?.userId)}`);

  const headNames = pools.headTeacher.map((s) => s.userName);
  check('③-4 初高班主任（孙敏，只挂 class-jh）不出现在大学部班主任池',
    !headNames.includes('孙敏') && headNames.includes('张海涛'), JSON.stringify(headNames));

  check('③-5 学管 / 校长 / 教务 / 财务 池子仍可用（跨模块角色不受模块限制）',
    (await admin.call('GET', '/api/class/meta/staff?group=principal')).json?.data?.list?.length === 1
    && (await admin.call('GET', '/api/class/meta/staff?group=eduAdmin')).json?.data?.list?.length >= 1,
    'principal / eduAdmin 有值');

  /* ============================================================
   * 四、前端：导航不再有「未开放」空项 + 升实训弹窗
   * ============================================================ */
  section('四、前端导航与弹窗（CDP）');
  const cdpOk = await cdpStart();
  if (!cdpOk) {
    check('④-0 无头浏览器可用', false, '未找到 Edge/Chrome，跳过前端断言');
  } else {
    for (const acc of ['qiansy', 'admin']) {
      await loginAs(acc);
      await navTo('/class/info', 3000);
      const sb = await ev(readSidebar());
      check(`④-1 [${acc}] 左侧导航没有「未开放」空菜单项`, (sb?.plain?.length ?? -1) === 0,
        `单层项=${JSON.stringify(sb?.plain)}`);
      check(`④-2 [${acc}] 左侧导航 7 个模块分组`, (sb?.groups?.length ?? 0) === 7,
        JSON.stringify(sb?.groups));
    }

    // 升实训弹窗：用一个【还没升实训】的班（U2602 不是六阶段，改用只读检查弹窗字段）
    await loginAs('qiansy');
    await navTo('/class/info', 3000);
    const clicked = await ev(`(() => {
      const row = [...document.querySelectorAll('.el-table__row')].find(r => r.innerText.includes('U2601'));
      if (!row) return 'row-not-found';
      const b = [...row.querySelectorAll('button')].filter(x => x.innerText.trim() === '升实训' && x.offsetParent !== null);
      if (!b.length) return 'btn-not-found';
      b[0].click(); return 'clicked';
    })()`);
    await sleep(2200);
    const dlg = await ev(`(() => {
      const d = [...document.querySelectorAll('.el-dialog')].find(x => x.innerText.includes('升实训'));
      if (!d) return null;
      return {
        labels: [...d.querySelectorAll('.el-form-item__label')].map(e => e.innerText.trim()),
        options: [...d.querySelectorAll('.el-select')].map(s => [...s.querySelectorAll('.el-select-dropdown__item')].length),
      };
    })()`);
    check('④-3 升实训弹窗可打开（U2601 六阶段）', clicked === 'clicked' && !!dlg, String(clicked));
    check('④-4 弹窗字段 = 班级 / 项目经理 / 就业指导老师 / 备注',
      JSON.stringify(dlg?.labels) === JSON.stringify(['班级', '项目经理', '就业指导老师', '备注']),
      JSON.stringify(dlg?.labels));
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUTDIR, '_round2_upgrade_dialog.png'), Buffer.from(shot.data, 'base64'));
    console.log('  📷 tools/_out/_round2_upgrade_dialog.png');
  }
  /* ============================================================
   * 五、升实训：选项目经理 + 就业指导老师 → 进就业管理
   * ============================================================ */
  section('五、升实训（第六阶段 → 就业管理·班级信息管理）');
  const cls = (await q(
    `SELECT id, class_name, stage, class_status, project_manager_id
       FROM \`${D.class}\`.t_class_info WHERE id = 'CLS-U2601'`,
  ))[0];
  check('⑤-0 前置：U2601 处于六阶段且未升实训',
    cls && Number(cls.stage) === 206 && Number(cls.class_status) !== 5,
    `stage=${cls?.stage} status=${cls?.class_status}`);

  // 负例：不传项目经理
  await q(`UPDATE \`${D.class}\`.t_class_info SET project_manager_id = NULL, project_manager_name = NULL WHERE id = 'CLS-U2601'`);
  const noPm = await qiansy.call('POST', '/api/class/info/training/upgrade', { classId: 'CLS-U2601' });
  check('⑤-1 不传「项目经理」→ 被后端拦下', noPm.json?.code !== 200 && /项目经理/.test(noPm.msg), noPm.msg);

  // 正例
  const pm = pools.projectManager[0];
  const et = pools.employmentTeacher[0];
  const up = await qiansy.call('POST', '/api/class/info/training/upgrade', {
    classId: 'CLS-U2601',
    projectManagerId: pm.userId,
    projectManagerName: pm.userName,
    employmentTeacherId: et.userId,
    employmentTeacherName: et.userName,
    remark: 'VERIFY-ROUND2',
  });
  check('⑤-2 带项目经理+就业指导老师 → 升实训成功', up.json?.code === 200 && !!up.json?.data?.handoffNo,
    `HTTP ${up.status} ${up.msg}`);

  const after = (await q(
    `SELECT class_status, project_manager_id, project_manager_name, employment_teacher_id, employment_teacher_name
       FROM \`${D.class}\`.t_class_info WHERE id = 'CLS-U2601'`,
  ))[0];
  check('⑤-3 大学部班级回写：状态→实训中 + 两个岗位落库',
    Number(after?.class_status) === 5
    && after?.project_manager_id === pm.userId && after?.project_manager_name === pm.userName
    && after?.employment_teacher_id === et.userId,
    JSON.stringify(after));

  const job = (await q(
    `SELECT class_name, stage, project_manager_name, employment_teacher_name
       FROM \`${D.job}\`.t_job_class
      WHERE university_no = ? OR class_name = ? OR class_code = ?`,
    ['Q2601', 'Q2601', 'Q2601'],
  ))[0];
  check('⑤-4 班级已进入【就业管理 → 班级信息管理】(sms_job.t_job_class)',
    !!job && Number(job.stage) === 13, JSON.stringify(job));
  check('⑤-5 实训侧班级挂的是本次选定的项目经理 / 就业指导老师',
    job?.project_manager_name === pm.userName && job?.employment_teacher_name === et.userName,
    `${job?.project_manager_name} / ${job?.employment_teacher_name}`);


  /* ---------------- 汇总 ---------------- */
  section('汇总');
  const pass = results.filter((r) => r.pass).length;
  const fail = results.length - pass;
  console.log(`合计 ${results.length} 项  ·  通过 ${pass}  ·  失败 ${fail}`);
  if (fail) {
    console.log('\n失败明细：');
    for (const r of results.filter((x) => !x.pass)) console.log(`  · ${r.name}  → ${r.detail}`);
  }
  console.log('\n⚠️ 第 ⑤ 段已把 U2601 升实训（改班级状态 + 在 sms_job 建班）。');
  console.log('   复位演示数据请执行： npm --prefix server-job run seed:all');

  try { if (ws) await send('Browser.close'); } catch { /* ignore */ }
  try { if (child) child.kill(); } catch { /* ignore */ }
  await db.end();
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => {
  console.error('ERR: ' + (e?.stack || e));
  try { if (child) child.kill(); } catch { /* ignore */ }
  process.exit(1);
});
