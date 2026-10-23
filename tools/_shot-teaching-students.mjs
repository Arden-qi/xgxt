/** 教学管理页面截图（登录走后端接口拿 token 写 localStorage，避开登录页交互） */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const OUT = 'C:/Users/24935/Desktop/xueguan/xgxt/tools/_out';
const PORT = 9361;
const BASE = 'http://localhost:5173';

const BROWSER = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].find((p) => fs.existsSync(p));

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-t-'));
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
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
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
  fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
}
async function nav(hash, wait = 3500) {
  await send('Page.navigate', { url: `${BASE}/#${hash}` }, 30000);
  await sleep(wait);
}

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
  await send('Page.enable'); await send('Runtime.enable');

  await nav('/', 2500);
  const token = await ev(`(async () => {
    const r = await fetch('/api/portal/account/login', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({account:'qiansy', password:'123456'})});
    const j = await r.json();
    if (j.code !== 200) return 'LOGIN_FAIL:' + j.message;
    localStorage.setItem('sms_token', j.data.token);
    return 'OK';
  })()`);
  console.log('login:', token);

  for (const [name, route] of [['student', '/teaching/student'], ['class', '/teaching/class']]) {
    await send('Page.navigate', { url: `${BASE}/#${route}` }, 30000);
    await sleep(1500);
    // hash 变了但 SPA 可能不重载：再点一次确保进入目标路由
    await send('Page.reload', { ignoreCache: false }).catch(() => {});
    await sleep(5000);
    const info = await ev(`(() => {
      const rows = [...document.querySelectorAll('.el-table__row')].filter(r => r.offsetParent !== null);
      return { href: location.href, rows: rows.length, first: rows[0] ? rows[0].innerText.replace(/\\n/g,' | ') : '', body: document.body.innerText.slice(0,150).replace(/\\n/g,' / ') };
    })()`);
    console.log(name, JSON.stringify(info));
    await shot(`demo2_${name}.png`);
  }

  await send('Browser.close').catch(() => {});
  child.kill();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
