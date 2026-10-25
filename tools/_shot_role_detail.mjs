/**
 * 取证（★ 2026-10-24）：职位详情弹窗卡片格式与「账号详情」对齐
 *   10-职位详情-咨询老师-新卡片格式.png
 * 流程：linx 登录 → 权限管理/职位管理 → 点「咨询老师」行的「预览」（职位详情）
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
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-roledetail-'));
const child = spawn(BROWSER, ['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
  '--remote-debugging-port=9355','--user-data-dir='+profile,'--window-size=1520,1060','about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws; let msgId = 0; const pending = new Map();
async function getTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch('http://127.0.0.1:9355/json/list');
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

/* 职位管理 */
await send('Page.navigate', { url: `${BASEWEB}/?t=${Date.now()}#/perm/role` });
await sleep(3400);

/* 点「咨询老师」行的 预览（职位详情） */
const opened = await ev(`(async () => {
  const rows = [...document.querySelectorAll('tr')].filter((r) => (r.innerText||'').includes('咨询老师'));
  if (!rows.length) return '(未找到咨询老师行)';
  const btn = [...rows[0].querySelectorAll('a,button,span')]
    .find((e) => ['预览','详情','查看'].includes((e.innerText||'').trim()));
  if (!btn) return '(行内按钮: ' + [...rows[0].querySelectorAll('a,button,span')].map(e=>(e.innerText||'').trim()).filter(Boolean).join('/') + ')';
  btn.click();
  await new Promise((r) => setTimeout(r, 2200));
  return true;
})()`);
console.log('打开职位详情:', opened);
console.log('弹窗内卡片文本:', await ev(`(() => {
  const cands = [...document.querySelectorAll('body *')].filter((e) => {
    const t = e.innerText || '';
    return t.includes('职位详情') && t.includes('权限覆盖情况');
  });
  if (!cands.length) return '(弹窗未打开)';
  const dlg = cands.sort((a,b)=>(a.innerText||'').length-(b.innerText||'').length)[0];
  const seg = (dlg.innerText||'').split('权限覆盖情况')[1] || '';
  return seg.replace(/\\n+/g, ' / ').slice(0, 400);
})()`));
await shot('10-职位详情-咨询老师-新卡片格式.png');
ws.close(); child.kill(); process.exit(0);
