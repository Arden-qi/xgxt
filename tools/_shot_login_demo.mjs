/** 取证：登录页快捷账号显示实时职位（孙敏→项目经理） */
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
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-logindemo-'));
const child = spawn(BROWSER, ['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
  '--remote-debugging-port=9362','--user-data-dir='+profile,'--window-size=1180,760','about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws; let msgId = 0; const pending = new Map();
async function getTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch('http://127.0.0.1:9362/json/list');
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
ws = new WebSocket(await getTarget());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; }
  if (m.id && pending.has(m.id)) { const { res, rej, to } = pending.get(m.id); clearTimeout(to); pending.delete(m.id);
    m.error ? rej(new Error(m.error.message)) : res(m.result); } };
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: `${BASEWEB}/?t=${Date.now()}#/login` });
await sleep(3600);
console.log('快捷账号文案:', await ev(`(() => [...document.querySelectorAll('.demo-item')]
  .map((d) => [...d.children].map((c) => (c.innerText || '').trim()).join(' ')).join(' | '))()`));
const r = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(path.join(OUTDIR, '12-登录页-演示账号实时职位.png'), Buffer.from(r.data, 'base64'));
console.log('shot saved');
ws.close(); child.kill(); process.exit(0);
