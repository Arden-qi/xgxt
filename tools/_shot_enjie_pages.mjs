/** CDP 取证：就业老师(zhouj)登录 → 就业日志页 + 数据统计页，断言无「服务器错误」红条 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUTDIR = path.resolve(HERE, '..', '输出', '权限修复取证');
fs.mkdirSync(OUTDIR, { recursive: true });
const TOKEN_FILE = path.resolve(HERE, '..', 'server-job', 'tools', '_diag_token.txt'); // zhouj token
const TOKEN = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
const BASEWEB = 'http://localhost:5173';
const BROWSER = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => fs.existsSync(p));
if (!BROWSER) throw new Error('msedge not found');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-enjie-'));
const child = spawn(BROWSER, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=9359', '--user-data-dir=' + profile, '--window-size=1520,1060', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
process.on('exit', () => { try { child.kill(); } catch { /* noop */ } });

let ws; let msgId = 0; const pending = new Map();
async function getTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch('http://127.0.0.1:9359/json/list');
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

const KILL_ANIM = `(() => {
  const s = document.createElement('style');
  s.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}';
  document.head.appendChild(s); return true;
})()`;

async function visit(route, png) {
  await send('Page.navigate', { url: `${BASEWEB}/_harness_login.html#${encodeURIComponent(TOKEN)}#${route}?t=${Date.now()}` });
  await sleep(5000);
  await ev(KILL_ANIM);
  const probe = await ev(`(() => {
    const body = document.body.innerText;
    const hasErr = body.includes('服务器错误') || body.includes('Illegal mix') || body.includes('服务错误');
    return JSON.stringify({ route: location.hash.slice(0, 40), hasErr,
      errSnippet: (body.match(/服务器错误[^\\n]{0,80}/) || [''])[0] });
  })()`);
  await shot(png);
  return JSON.parse(probe);
}

const r1 = await visit('/employment-log', '就业老师_就业日志_修复后.png');
const r2 = await visit('/statistics', '就业老师_数据统计_修复后.png');
console.log('就业日志页:', JSON.stringify(r1));
console.log('数据统计页:', JSON.stringify(r2));

const assert = (cond, msg) => { if (!cond) { console.error('❌ FAIL:', msg); process.exitCode = 1; } else console.log('✅', msg); };
assert(r1.hasErr === false, '就业日志页无「服务器错误」提示');
assert(r2.hasErr === false, '数据统计页无「服务器错误」提示');
console.log(process.exitCode ? '== 有断言失败 ==' : '== 全部断言通过 ==');
