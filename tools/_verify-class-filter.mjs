/**
 * 回归：班级管理「部门 / 状态」筛选（2026-10-26）
 * =========================================================
 * 批注：「点击查询才可以查到，未点界面不动」——选部门时筛选行会插入「阶段」下拉，
 *       整排往右推，看着像"闪一下"。
 * 断言：
 *   ① 未点【查询】时：不发请求、行数不变、筛选行字段不变（不跳动）；
 *   ② 选部门 → 点查询：请求带 stage，行数正确；
 *   ③ 选状态 → 点查询：请求带 classStatus，行数正确；
 *   ④ 重置：回到全部。
 *
 * 用法：node tools\_verify-class-filter.mjs   （前后端需在跑：8004 + 5173）
 * 产物：tools/_out/filter_*.png
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUTDIR = path.join(HERE, '_out');
fs.mkdirSync(OUTDIR, { recursive: true });
const PORT = 9369;
const BASE = 'http://localhost:5173';
const BROWSER = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].find((p) => fs.existsSync(p));
if (!BROWSER) { console.log('NO BROWSER'); process.exit(1); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-filter-'));
const child = spawn(BROWSER, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
  '--window-size=1680,1050', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws; let msgId = 0; const pending = new Map();
const reqs = []; const errs = [];

async function getTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const page = (await r.json()).find((t) => t.type === 'page');
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
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUTDIR, name), Buffer.from(r.data, 'base64'));
}

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
  if (!ok) fails.push(name);
};

const snap = () => ev(`(() => {
  const rows = [...document.querySelectorAll('.el-table__row')].filter(r => r.offsetParent !== null);
  const items = [...document.querySelectorAll('.tcv-filter .el-form-item')].filter(x => x.offsetParent !== null)
    .map(x => (x.querySelector('.el-form-item__label')?.innerText || '').trim()).filter(Boolean);
  return { rows: rows.length, fields: items.join('|') };
})()`);

const clickBtn = (text) => ev(`(() => {
  const b = [...document.querySelectorAll('button, .el-button')]
    .filter(x => x.offsetParent !== null && x.innerText.trim() === ${JSON.stringify(text)})[0];
  if (!b) return 'NOT_FOUND';
  b.click();
  return 'OK';
})()`);

/** 按标签打开筛选下拉（部门/阶段/状态），再按选项文字点选 */
async function pickFilter(label, text) {
  const r1 = await ev(`(() => {
    const it = [...document.querySelectorAll('.tcv-filter .el-form-item')]
      .filter(x => x.offsetParent !== null)
      .find(x => (x.querySelector('.el-form-item__label')?.innerText || '').trim() === ${JSON.stringify(label)});
    if (!it) return 'NO_ITEM';
    const s = it.querySelector('.el-select');
    if (!s) return 'NO_SELECT';
    (s.querySelector('.el-select__wrapper') || s).click();
    return 'OK';
  })()`);
  await sleep(700);
  const r2 = await ev(`(() => {
    const pops = [...document.querySelectorAll('.el-select-dropdown')].filter(x => x.offsetParent !== null);
    const pop = pops[pops.length - 1];
    if (!pop) return 'NO_POPPER';
    const it = [...pop.querySelectorAll('.el-select-dropdown__item')]
      .find(x => x.innerText.trim() === ${JSON.stringify(text)});
    if (!it) return 'NO_ITEM[' + pop.innerText.replace(/\\n/g, '|') + ']';
    it.click();
    return 'OK';
  })()`);
  await sleep(400);
  return r1 + '/' + r2;
}

(async () => {
  ws = new WebSocket(await getTarget());
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    if (m.method === 'Runtime.exceptionThrown') errs.push(m.params?.exceptionDetails?.exception?.description || 'unknown');
    if (m.method === 'Network.requestWillBeSent') {
      const u = m.params?.request?.url || '';
      if (u.includes('/teaching/class/list')) reqs.push(u.replace(BASE, ''));
    }
    if (m.id && pending.has(m.id)) {
      const { resolve, reject, to } = pending.get(m.id);
      clearTimeout(to); pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    }
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');

  await send('Page.navigate', { url: `${BASE}/#/` }, 30000);
  await sleep(2000);
  await ev(`(async () => {
    localStorage.clear();
    const res = await fetch('/api/portal/account/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: 'qiansy', password: '123456' }),
    });
    const j = await res.json();
    localStorage.setItem('sms_token', j.data.token);
    return 'OK';
  })()`);
  await send('Page.navigate', { url: `${BASE}/#/teaching/class` }, 30000);
  await sleep(4500);

  const before = await snap();
  console.log('\n=== ① 只选条件、不点查询：界面不许动 ===');
  console.log('  初始:', JSON.stringify(before));
  check('筛选行含 部门/阶段/状态/关键字', before.fields === '部门|阶段|状态|关键字', before.fields);

  reqs.length = 0;
  console.log('  选部门=就业部:', await pickFilter('部门', '就业部'));
  await sleep(1500);
  const after = await snap();
  console.log('  选后:', JSON.stringify(after));
  check('未点查询不发请求', reqs.length === 0, reqs.join(' , '));
  check('行数不变（不闪）', after.rows === before.rows, `${before.rows} → ${after.rows}`);
  check('筛选行不跳动（阶段恒定占位）', after.fields === before.fields, after.fields);

  console.log('\n=== ② 点查询：部门生效 ===');
  reqs.length = 0;
  check('点【查询】', (await clickBtn('查询')) === 'OK');
  await sleep(2200);
  check('请求带 stage=emp', reqs.some((u) => u.includes('stage=emp')), reqs.join(' , '));
  const emp = await snap();
  check('就业部只有 4 行', emp.rows === 4, `实际 ${emp.rows}`);
  await shot('filter_dept_emp.png');

  console.log('\n=== ③ 点查询：状态生效 ===');
  check('重置', (await clickBtn('重置')) === 'OK');
  await sleep(1800);
  reqs.length = 0;
  check('选状态=待就业', (await pickFilter('状态', '待就业')) === 'OK/OK');
  check('点【查询】', (await clickBtn('查询')) === 'OK');
  await sleep(2200);
  check('请求带 classStatus=6', reqs.some((u) => u.includes('classStatus=6')), reqs.join(' , '));
  const st6 = await snap();
  check('待就业 4 行', st6.rows === 4, `实际 ${st6.rows}`);
  await shot('filter_status_pending.png');

  console.log('\n=== ④ 重置回全部 ===');
  check('重置', (await clickBtn('重置')) === 'OK');
  await sleep(2200);
  const all = await snap();
  check('回到 9 行', all.rows === before.rows, `实际 ${all.rows}`);
  check('无未捕获异常', errs.length === 0, errs[0] || '');

  console.log(`\n${fails.length ? 'FAILED: ' + fails.join(' / ') : 'ALL PASS'}`);
  child.kill(); ws?.close?.();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('异常:', e.message); child.kill(); process.exit(1); });
