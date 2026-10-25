/** 补拍：职位权限分配 → 咨询经理（财务管理 2/6，查看 已授权） */
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
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-sync2-'));
const child = spawn(BROWSER, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=9353', '--user-data-dir=' + profile, '--window-size=1520,1060', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws; let msgId = 0; const pending = new Map();
async function getTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch('http://127.0.0.1:9353/json/list');
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

/* 登录 linx */
await ev(`(() => { try { localStorage.clear(); } catch(e){} return true; })()`);
await send('Page.navigate', { url: `http://localhost:5173/?t=${Date.now()}#/login` });
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

await send('Page.navigate', { url: `http://localhost:5173/?t=${Date.now()}#/perm/assign` });
await sleep(3400);

/* 点「咨询经理」：左列表项 innerText 形如 “咨询经理\n37”，用 includes 匹配最小可见元素 */

const clickRes = await ev(`(async () => {
  const all = [...document.querySelectorAll('li,div,span,button')]
    .filter((e) => e.offsetParent !== null)
    .map((e) => (e.innerText || '').trim())
    .filter((t) => t.includes('咨询经理'));
  return JSON.stringify([...new Set(all)].slice(0, 10));
})()`);
console.log('候选元素文本:', clickRes);


/* 右上角当前职位名 + 财务卡片 */
console.log('当前职位:', await ev(`(() => {
  const h = [...document.querySelectorAll('div,span,h2,h3')].filter((e) => {
    const t = (e.innerText || '').trim();
    return t.startsWith('咨询经理') && t.includes('市场咨询部') && t.length < 60;
  });
  return h.length ? h[0].innerText.replace(/\\n/g, ' ').slice(0, 40) : '(未识别)';
})()`));
console.log('财务管理卡片:', await ev(`(() => {
  const cards = [...document.querySelectorAll('section,div')].filter((e) => {
    const t = e.innerText || '';
    return t.includes('财务管理') && t.includes('财务概览') && t.includes('缴费管理') && t.length < 600;
  });
  if (!cards.length) return '(未找到财务卡片)';
  return (cards.sort((a, b) => a.innerText.length - b.innerText.length)[0].innerText || '').replace(/\\n+/g, ' / ').slice(0, 220);
})()`));
await shot('8-职位权限分配-咨询经理-财务已授权.png');
ws.close(); child.kill(); process.exit(0);
