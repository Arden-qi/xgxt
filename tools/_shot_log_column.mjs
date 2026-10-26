/**
 * 取证（★ 2026-10-24）：操作日志列表已删除「操作前 → 后」列
 * 注意：后端 8004 已停止，列表数据加载失败属预期；表头渲染不受影响，足以验证列已删。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUTDIR = path.resolve(HERE, '..', '输出', '权限修复取证');
fs.mkdirSync(OUTDIR, { recursive: true });
const BASEWEB = 'http://localhost:5173';
const BROWSER = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => fs.existsSync(p));
if (!BROWSER) { console.log('NO BROWSER'); process.exit(1); }
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-logcol-'));
const child = spawn(BROWSER, ['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
  '--remote-debugging-port=9358','--user-data-dir='+profile,'--window-size=1520,900','about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws; let msgId = 0; const pending = new Map();
async function getTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch('http://127.0.0.1:9358/json/list');
      const page = (await r.json()).find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
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
ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; }
  if (m.id && pending.has(m.id)) { const { res, rej, to } = pending.get(m.id); clearTimeout(to); pending.delete(m.id);
    m.error ? rej(new Error(m.error.message)) : res(m.result); } };
await send('Page.enable'); await send('Runtime.enable');

/* 登录 linx */
await send('Page.navigate', { url: `${BASEWEB}/?t=${Date.now()}#/login` });
await sleep(2400);
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

/* 操作日志页 */
await send('Page.navigate', { url: `${BASEWEB}/?t=${Date.now()}#/perm/log` });
await sleep(3400);
console.log('表头:', await ev(`(() => [...document.querySelectorAll('.tb thead th')].map(t => (t.innerText||'').trim()).filter(Boolean).join(' | '))()`));
console.log('是否还有「操作前 → 后」:', await ev(`(() => [...document.querySelectorAll('.tb thead th')].some(t => (t.innerText||'').includes('操作前')) ? '是（异常）' : '否')()`));
await shot('11-操作日志-已删操作前后列.png');
ws.close(); child.kill(); process.exit(0);
