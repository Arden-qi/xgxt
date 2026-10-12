/**
 * 统一门户版 · UI 关键界面截图（人工核对用）
 *
 * 覆盖 2026-10-06 三项需求的"看得见"部分：
 *   ① 全量重建后的数据在各页面上的呈现
 *   ② 账号权限与角色对应（不同账号进去只看得到自己的模块）
 *   ③ 班级管理·待接收学员（接收班级由推送决定，本界面不选班级）
 *      + 咨询·收款与缴费的「分班」按钮状态（已分派置灰 / 驳回可点）
 *
 * 用法：node tools/shot-ui.mjs        （前后端需在跑：8004 + 5173）
 * 产物：tools/_out/*.png
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUTDIR = path.join(HERE, '_out');
fs.mkdirSync(OUTDIR, { recursive: true });
const PORT = 9337;
const BASE = 'http://localhost:5173';

const BROWSER = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].find((p) => fs.existsSync(p));
if (!BROWSER) {
  console.log('NO BROWSER');
  process.exit(1);
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-shot-'));
const child = spawn(BROWSER, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
  '--window-size=1680,1050', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws; let msgId = 0; const pending = new Map();

async function getTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
      const page = list.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch { /* retry */ }
    await sleep(250);
  }
  throw new Error('no target');
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
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUTDIR, name), Buffer.from(r.data, 'base64'));
  console.log('  shot: ' + name);
}
async function nav(hash, wait = 2600) {
  await send('Page.navigate', { url: `${BASE}/?t=${Date.now()}#${hash}` }, 30000);
  await sleep(wait);
}
async function loginAs(account) {
  await ev(`(() => { try { localStorage.clear(); } catch(e){} return true; })()`);
  await nav('/login', 2200);
  const clicked = await ev(`(() => {
    const items = [...document.querySelectorAll('.demo-item')];
    const el = items.find(x => x.innerText.includes('${account}'));
    if (el) { el.click(); return true; }
    return false;
  })()`);
  await sleep(500);
  await ev(`(() => { const b = document.querySelector('.submit'); if (b) b.click(); return !!b; })()`);
  await sleep(3400);
  return clicked;
}

/** 点行内按钮（rowText 用于定位行） */
const clickBtn = (text, rowText) => `(() => {
  let scope = document;
  if ('${rowText || ''}') {
    const row = [...document.querySelectorAll('.el-table__row')].find(r => r.innerText.includes('${rowText}'));
    if (!row) return 'row-not-found';
    scope = row;
  }
  const bs = [...(scope.querySelectorAll ? scope.querySelectorAll('button') : [])]
    .filter(b => b.innerText.trim() === '${text}' && b.offsetParent !== null && !b.disabled);
  if (bs.length) { bs[0].click(); return 'clicked'; }
  return 'not-found';
})()`;

const clickTab = (text) => `(() => {
  const t = [...document.querySelectorAll('.el-tabs__item')].find(e => e.innerText.trim() === '${text}');
  if (t) { t.click(); return 'ok'; }
  return 'not-found';
})()`;

/* ---------- 后端 API 小工具（用于在截图前把状态改成「升实训后」） ---------- */
const API = 'http://127.0.0.1:8004';
async function apiLogin(account, password = '123456') {
  const r = await fetch(`${API}/api/portal/account/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account, password }),
  });
  const j = await r.json().catch(() => null);
  return j?.data?.token;
}
async function apiCall(token, method, url, body) {
  const r = await fetch(API + url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, json: await r.json().catch(() => null) };
}
const staffOf = (token, group) =>
  apiCall(token, 'GET', `/api/class/meta/staff?group=${group}`).then((r) => r.json?.data?.list ?? []);

const rows = () => `document.querySelectorAll('.el-table__row').length`;

(async () => {
  ws = new WebSocket(await getTarget());
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

  /* ---------- 0) 门户登录页 ---------- */
  console.log('=== 门户登录页 ===');
  await ev(`(() => { try { localStorage.clear(); } catch(e){} return true; })()`);
  await nav('/login', 2500);
  await shot('01_portal_login.png');

  /* ---------- 1) 咨询 · 收款与缴费（分班按钮状态） ---------- */
  console.log('=== 咨询 zhangls · 收款与缴费 ===');
  await loginAs('zhangls');
  await nav('/consult/fee');
  console.log('  行数=', await ev(rows()));
  await shot('02_consult_fee_assign_buttons.png');

  /* ---------- 2) 班级管理 · 待接收学员（班主任） ---------- */
  console.log('=== 班主任 zhanght · 待接收学员 ===');
  await loginAs('zhanght');
  await nav('/class/consult');
  console.log('  行数=', await ev(rows()));
  await shot('03_class_consult_pending_head_teacher.png');

  /* ---------- 3) 班级管理 · 待接收学员（校长，全权） ---------- */
  console.log('=== 校长 qiansy · 待接收学员 ===');
  await loginAs('qiansy');
  await nav('/class/consult');
  console.log('  行数=', await ev(rows()));
  await shot('04_class_consult_pending_principal.png');

  /* ---------- 4) 初高 · 学生详情 · 缴费情况 ---------- */
  console.log('=== 初高 sunmin · 学生详情 ===');
  await loginAs('sunmin');
  await nav('/class-jh/student');
  console.log('  行数=', await ev(rows()));
  console.log('  ' + (await ev(clickBtn('详情', 'J26001'))));
  await sleep(2200);
  await shot('05_jh_student_detail.png');
  console.log('  tab: ' + (await ev(clickTab('缴费情况'))));
  await sleep(1600);
  await shot('06_jh_student_detail_fee.png');

  /* ---------- 5) 大学部 · 花名册 → 缴费情况 ---------- */
  console.log('=== 大学部 admin · 花名册 ===');
  await loginAs('admin');
  await nav('/class/roster');
  console.log('  行数=', await ev(rows()));
  console.log('  ' + (await ev(clickBtn('缴费情况'))));
  await sleep(2200);
  await shot('07_class_roster_fee_dialog.png');

  /* ---------- 6) 实训 · 学员档案 → 缴费记录 ---------- */
  console.log('=== 实训 admin · 班级信息管理 ===');
  await loginAs('admin');
  await nav('/class');
  console.log('  行数=', await ev(rows()));
  console.log('  ' + (await ev(clickBtn('详情'))));
  await sleep(2500);
  console.log('  tab: ' + (await ev(clickTab('缴费记录'))));
  await sleep(1800);
  await shot('08_job_student_fee_tab.png');

  /* ---------- 7) 权限管理 · 账号与角色 ---------- */
  console.log('=== 权限管理 linx · 账号列表 ===');
  const ok = await loginAs('linx');
  console.log('  登录项命中=', ok);
  await nav('/perm/user', 3000);
  console.log('  行数=', await ev(rows()));
  await shot('09_perm_account_roles.png');

  /* ============================================================
   * ★ 2026-10-06 第二轮需求取证
   *   ① 左侧导航不再有 4 个「未开放」空菜单项（legacy 空分组已滤掉）
   *   ② 校长账号 = 全模块（7 个分组都在）
   *   ③ 大学部「班级管理」第六阶段的「升实训」→ 弹窗选项目经理 + 就业指导老师
   * ============================================================ */
  console.log('=== 校长 qiansy · 左侧导航（应 7 个模块、无空菜单项） ===');
  await loginAs('qiansy');
  await nav('/class/info', 3000);
  const navInfo = await ev(`(() => {
    const groups = [...document.querySelectorAll('.el-sub-menu__title')]
      .map(e => e.innerText.replace(/\\s+/g, ' ').trim());
    const plain = [...document.querySelectorAll('.side-menu > .el-menu-item')]
      .map(e => e.innerText.trim());
    return { groups, plain };
  })()`);
  console.log('  分组(' + (navInfo?.groups?.length ?? 0) + '): ' + JSON.stringify(navInfo?.groups));
  console.log('  单层空项(' + (navInfo?.plain?.length ?? 0) + '): ' + JSON.stringify(navInfo?.plain));
  await shot('10_principal_sidebar_all_modules.png');

  console.log('=== 大学部 班级管理 · 升实训弹窗 ===');
  console.log('  ' + (await ev(clickBtn('升实训', 'U2601'))));
  await sleep(2200);
  const dlg = await ev(`(() => {
    const d = [...document.querySelectorAll('.el-dialog')].find(x => x.innerText.includes('升实训'));
    if (!d) return 'dialog-not-found';
    return [...d.querySelectorAll('.el-form-item__label')].map(e => e.innerText.trim()).join(' | ');
  })()`);
  console.log('  弹窗字段: ' + dlg);
  await shot('11_class_upgrade_dialog.png');

  // 真正执行升实训（走接口，确定性），这样第 12 张才是货真价实的「升实训后」取证
  // （seed 出来的 U2601 是六阶段·正式在读，尚未升实训）
  {
    const tk = await apiLogin('qiansy');
    const pms = await staffOf(tk, 'projectManager');
    const ets = await staffOf(tk, 'employmentTeacher');
    const pm = pms[0];
    const et = ets[0];
    const up = await apiCall(tk, 'POST', '/api/class/info/training/upgrade', {
      classId: 'CLS-U2601',
      projectManagerId: pm?.userId,
      projectManagerName: pm?.userName,
      employmentTeacherId: et?.userId,
      employmentTeacherName: et?.userName,
      remark: 'SHOT-UI',
    });
    console.log(
      `  执行升实训: 项目经理=${pm?.userName} 就业老师=${et?.userName} → ` +
        `http=${up.status} code=${up.json?.code} handoffNo=${up.json?.data?.handoffNo ?? '-'}`,
    );
    await sleep(800);
  }

  /* ============================================================
   * ★ 2026-10-06 第三轮需求取证
   *   ① 升实训后班主任仍能在「班级信息管理」看到该班学生
   *   ② 咨询「学生管理 → 入班」= 选学段（大学部/初高中）+ 选开放班级
   *   ③ 审批中心「分配咨询老师」下拉不再是「无数据」
   * ============================================================ */
  console.log('=== 班主任 zhanght · 班级信息管理（升实训交棒后：不再看到 U2601 实训学员） ===');
  await loginAs('zhanght');
  await nav('/class/roster', 3000);
  const roster = await ev(`(() => {
    const rows = [...document.querySelectorAll('.el-table__row')].map(r => r.innerText.replace(/\\s+/g, ' ').trim());
    // ⚠️ 用词边界匹配：学号 U26010 是 U2602 的学员，不能被 'U2601' 子串误伤
    const re = /(^|[^0-9A-Za-z])U2601([^0-9A-Za-z]|$)/;
    const u2601 = rows.filter(r => re.test(r)).length;
    return { n: rows.length, u2601, head: rows.slice(0, 2) };
  })()`);
  console.log(`  行数=${roster?.n} · 含 U2601 的实训学员行=${roster?.u2601}（交棒后应为 0）`);
  await shot('12_teacher_roster_after_upgrade.png');

  console.log('=== 咨询 wangjl · 学生管理「入班」弹窗（选学段 + 开放班级） ===');
  await loginAs('wangjl');
  await nav('/consult/student', 3000);
  console.log('  ' + (await ev(clickBtn('入班'))));
  await sleep(2200);
  const enrollDlg = await ev(`(() => {
    const d = [...document.querySelectorAll('.el-dialog')].find(x => x.innerText.includes('入班'));
    if (!d) return 'dialog-not-found';
    return d.innerText.replace(/\\s+/g, ' ').trim().slice(0, 220);
  })()`);
  console.log('  弹窗: ' + enrollDlg);
  await shot('13_consult_enroll_dialog.png');

  console.log('=== 咨询 wangjl · 审批中心「分配咨询老师」下拉 ===');
  await nav('/consult/approve', 3000);
  console.log('  ' + (await ev(clickBtn('分配'))));
  await sleep(1600);
  await ev(`(() => { const s = document.querySelector('.el-dialog .el-select'); if (s) s.click(); return !!s; })()`);
  await sleep(1200);
  const opts = await ev(`(() => {
    const items = [...document.querySelectorAll('.el-select-dropdown__item')].map(e => e.innerText.trim());
    const empty = document.querySelector('.el-select-dropdown__empty');
    return { items, empty: empty ? empty.innerText.trim() : null };
  })()`);
  console.log('  下拉项: ' + JSON.stringify(opts));
  await shot('14_consult_assign_consultant.png');

  try { await send('Browser.close'); } catch { /* ignore */ }
  child.kill();
  console.log('\n✅ 截图完成 → tools/_out/');
  process.exit(0);
})().catch(async (e) => {
  console.log('ERR: ' + (e?.stack || e));
  try { child.kill(); } catch { /* ignore */ }
  process.exit(1);
});
