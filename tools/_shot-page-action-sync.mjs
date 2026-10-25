/**
 * 取证：页面管理 ↔ 职位权限分配 联动（★ 2026-10-24）
 * 7) 职位权限分配 → 咨询老师：财务管理卡片应显示「查看 已授权」
 * 8) 职位权限分配 → 咨询经理：同上
 * 9) 王寒逸（咨询经理）登录 → 财务管理/缴费管理 页面可用
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

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-sync-'));
const child = spawn(BROWSER, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=9352', '--user-data-dir=' + profile, '--window-size=1520,1060', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws; let msgId = 0; const pending = new Map();

async function getTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch('http://127.0.0.1:9352/json/list');
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
const PWD = { linx: '123456', wanghanyi: 'Wanghanyi123' };

async function loginAs(acc) {
  await ev(`(() => { try { localStorage.clear(); } catch(e){} return true; })()`);
  await send('Page.navigate', { url: `${BASEWEB}/?t=${Date.now()}#/login` });
  await sleep(2400);
  await ev(`(() => {
    const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value');
      d.set.call(el, v); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); };
    const inputs = [...document.querySelectorAll('input')].filter(i => i.type !== 'checkbox');
    if (inputs[0]) set(inputs[0], ${JSON.stringify(acc)});
    if (inputs[1]) set(inputs[1], ${JSON.stringify(PWD[acc] || '123456')});
  })()`);
  await sleep(400);
  await ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => (x.innerText||'').replace(/\\s/g,'') === '登录'); if (b) b.click(); })()`);
  await sleep(3800);
  console.log('  登录', await ev(`(() => !location.hash.includes('/login'))()`) ? '成功' : '失败');
}

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

const financeCardText = `(() => {
  const cards = [...document.querySelectorAll('section,div')].filter((e) => {
    const t = e.innerText || '';
    return t.includes('财务管理') && t.includes('财务概览') && t.includes('缴费管理') && t.length < 600;
  });
  if (!cards.length) return '(未找到财务卡片)';
  return (cards.sort((a, b) => a.innerText.length - b.innerText.length)[0].innerText || '').replace(/\\n+/g, ' / ').slice(0, 220);
})()`;

const pickRole = async (name) => {
  await ev(`(async () => {
    const cands = [...document.querySelectorAll('li,div,span,button')]
      .filter((e) => e.offsetParent !== null && (e.innerText || '').trim() === ${JSON.stringify(name)});
    if (!cands.length) return '(未找到 ' + ${JSON.stringify(name)} + ')';
    cands.sort((a, b) => (a.innerText || '').length - (b.innerText || '').length);
    cands[0].click();
    await new Promise((r) => setTimeout(r, 2600));
    return true;
  })()`);
};

/* 7/8. 职位权限分配 */
await loginAs('linx');
await send('Page.navigate', { url: `${BASEWEB}/?t=${Date.now()}#/perm/assign` });
await sleep(3400);
console.log('⑦ 咨询老师');
await pickRole('咨询老师');
console.log('  财务管理卡片:', await ev(financeCardText));
await shot('7-职位权限分配-咨询老师-财务已授权.png');
console.log('⑧ 咨询经理');
await pickRole('咨询经理');
console.log('  财务管理卡片:', await ev(financeCardText));
await shot('8-职位权限分配-咨询经理-财务已授权.png');

/* 9. 王寒逸 → 缴费管理 */
console.log('⑨ 王寒逸 → 缴费管理');
await loginAs('wanghanyi');
console.log('  左侧菜单:', await ev(`(() => [...document.querySelectorAll('.el-menu .el-sub-menu__title, .el-menu > li')]
  .map((e) => (e.innerText || '').trim().split('\\n')[0]).filter(Boolean).slice(0, 12).join(' | '))()`));
await send('Page.navigate', { url: `${BASEWEB}/?t=${Date.now()}#/finance/fee` });
await sleep(3800);
console.log('  当前页面:', await ev(`(() => location.hash + ' | ' + (document.body.innerText.includes('缴费') ? '缴费管理已渲染' : '页面未渲染'))()`));
await shot('9-王寒逸-缴费管理-可操作.png');
ws.close(); child.kill(); process.exit(0);
