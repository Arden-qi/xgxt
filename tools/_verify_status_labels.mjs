/**
 * 验证「状态选项文字」口径（★ 2026-10-24 用户要求：正常/停用/锁定，不写已X）
 * ① 后端字典 /api/perm/option/get 的 userStatuses
 * ② 前端 账号管理 → 编辑账号 弹窗里状态下拉的 option 文字（截图）
 * ③ 前端 账号管理 列表「状态」筛选下拉的 option 文字
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUTDIR = path.join(ROOT, '输出', '权限修复取证');
const BASE = 'http://127.0.0.1:8004';

/* ---- ① 后端字典 ---- */
const lg = await fetch(`${BASE}/api/portal/account/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ account: 'linx', password: '123456' }),
});
const lj = await lg.json();
const opt = await fetch(`${BASE}/api/perm/option/get`, { headers: { Authorization: `Bearer ${lj.data.token}` } });
const oj = await opt.json();
console.log('① 字典 userStatuses =', JSON.stringify(oj.data?.userStatuses));

/* ---- ②③ 前端 ---- */
const PORT = 9347;
const BASEWEB = 'http://localhost:5173';
const BROWSER = [
  'C://Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C://Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => fs.existsSync(p));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-status-'));
const child = spawn(BROWSER, ['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
  '--remote-debugging-port='+PORT,'--user-data-dir='+profile,'--window-size=1520,1060','about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let ws; let msgId = 0; const pending = new Map();
async function getTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const page = (await r.json()).find(t => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error('no target');
}
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++msgId; const to = setTimeout(() => reject(new Error('timeout '+method)), 30000);
  pending.set(id, { resolve, reject, to });
  ws.send(JSON.stringify({ id, method, params }));
});
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUTDIR, name), Buffer.from(r.data, 'base64'));
  console.log('  shot:', name);
};

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
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: `${BASEWEB}/?t=${Date.now()}#/login` });
await sleep(2400);
await ev(`(() => {
  const set = (el, v) => {
    const d = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    d.set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const inputs = [...document.querySelectorAll('input')].filter(i => i.type !== 'checkbox');
  if (inputs[0]) set(inputs[0], 'linx');
  if (inputs[1]) set(inputs[1], '123456');
  return inputs.length;
})()`);
await sleep(400);
/* ⚠️ 按钮文字是「登 录」（中间带空格），必须去掉全部空白再比 */
await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.innerText||'').replace(/\\s/g,'') === '登录');
  if (b) b.click();
  return !!b;
})()`);
await sleep(3800);
console.log('登录后 hash:', await ev(`(() => location.hash)()`));
await send('Page.navigate', { url: `${BASEWEB}/?t=${Date.now()}#/perm/user` });
await sleep(3200);

/* ③ 列表筛选下拉 */
console.log('③ 列表状态筛选 options =', await ev(`(() => {
  const sel = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === '正常'));
  return sel ? [...sel.options].map(o => o.value + '→' + o.text).join(' | ') : '(未找到)';
})()`));

/* ② 编辑弹窗（点齐田田行的编辑） */
const clicked = await ev(`(async () => {
  const rows = [...document.querySelectorAll('tr')].filter(r => (r.innerText||'').includes('齐田田'));
  if (!rows.length) return '(未找到齐田田行)';
  const btn = [...rows[0].querySelectorAll('a,button,span')].find(e => (e.innerText||'').trim() === '编辑');
  if (!btn) return '(行内没有编辑按钮)';
  btn.click();
  await new Promise(r => setTimeout(r, 1800));
  return true;
})()`);
console.log('② 打开编辑弹窗:', clicked);
console.log('② 弹窗状态下拉 options =', await ev(`(() => {
  const dlg = [...document.querySelectorAll('body *')].filter(e => {
    const t = e.innerText || '';
    return t.includes('编辑账号') && t.includes('账号状态');
  }).sort((a,b) => (a.innerText||'').length - (b.innerText||'').length)[0];
  if (!dlg) return '(弹窗未打开)';
  const sel = dlg.querySelector('select');
  if (!sel) return '(弹窗里没有 select)';
  return [...sel.options].map(o => o.value + '→' + o.text).join(' | ');
})()`));
await shot('6-编辑账号-状态选项.png');
ws.close(); child.kill();
process.exit(0);
