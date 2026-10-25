/** CDP 取证：编辑账号弹窗的「账号状态」下拉 —— 应只有 正常/停用 两档（锁定已移除） */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUTDIR = path.resolve(HERE, '..', '输出', '权限修复取证');
const BASEWEB = 'http://localhost:5173';
const BROWSER = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => fs.existsSync(p));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-status-'));
const child = spawn(BROWSER, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=9357', '--user-data-dir=' + profile, '--window-size=1520,1060', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws; let msgId = 0; const pending = new Map();
async function getTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch('http://127.0.0.1:9357/json/list');
      const page = (await r.json()).find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch { /* retry */ }
    await sleep(250);
  }
  throw new Error('no target');
}
const send = (m, p = {}) => new Promise((res, rej) => {
  const id = ++msgId; const to = setTimeout(() => rej(new Error('timeout ' + m)), 30000);
  pending.set(id, { res, rej, to });
  ws.send(JSON.stringify({ id, method: m, params: p }));
});
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.value;
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
    const { res, rej, to } = pending.get(m.id);
    clearTimeout(to); pending.delete(m.id);
    m.error ? rej(new Error(m.error.message)) : res(m.result);
  }
};
await send('Page.enable'); await send('Runtime.enable');

/* 表单登录 linx */
await ev(`(() => { try { localStorage.clear(); } catch(e){} return true; })()`);
await send('Page.navigate', { url: `${BASEWEB}/?t=${Date.now()}#/login` });
await sleep(3000);
await ev(`(() => {
  const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value');
    d.set.call(el, v); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); };
  const inputs = [...document.querySelectorAll('input')].filter(i => i.type !== 'checkbox');
  if (inputs[0]) set(inputs[0], 'linx');
  if (inputs[1]) set(inputs[1], '123456');
})()`);
await sleep(400);
await ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => (x.innerText||'').replace(/\\s/g,'') === '登录'); if (b) b.click(); })()`);
await sleep(3800);
console.log('登录:', await ev(`(() => !location.hash.includes('/login'))()`) ? '成功' : '失败');
await send('Page.navigate', { url: `${BASEWEB}/?t=${Date.now()}#/perm/user` });
await sleep(6000);

/* 打开第一页任一账号的编辑弹窗（弹窗与账号无关，状态下拉全局一致） */
const opened = await ev(`(async () => {
  for (let t = 0; t < 12; t++) {
    const links = [...document.querySelectorAll('span, a')].filter((x) => x.offsetParent !== null);
    const btn = links.find((x) => (x.textContent || '').trim() === '编辑');
    if (btn) { btn.click(); return true; }
    await new Promise((r) => setTimeout(r, 900));
  }
  return false;
})()`);
console.log('打开编辑弹窗:', opened);
await sleep(2500);
/* 杀过渡动画 */
await ev(`(() => {
  const st = document.createElement('style');
  st.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}';
  document.head.appendChild(st);
  return true;
})()`);
/* 弹窗内的「账号状态」下拉（原生 select，含 value='' 的「请选择」占位项） */
const openedSel = await ev(`(() => {
  const sels = [...document.querySelectorAll('select')]
    .filter((s) => [...s.options].some((o) => o.value === '正常'))
    .filter((s) => ![...s.options].some((o) => o.textContent.includes('全部状态')));
  if (!sels.length) return 'no-select';
  const sel = sels[sels.length - 1];
  return JSON.stringify([...sel.options].map((o) => o.value + '|' + o.textContent.trim()));
})()`);
console.log('状态下拉选项:', openedSel);
await sleep(600);
await shot('24-编辑账号-状态下拉-仅正常停用.png');
ws.close(); child.kill(); process.exit(0);
