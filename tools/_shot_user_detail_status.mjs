/** CDP 取证：账号详情弹窗「所属职位」状态列 ——
 *  ①停用账号（任文静）：职位行应显示「停用 + 账号已停用」，不得再出现绿色「启用」
 *  ②正常账号（齐志远）：职位行仍按职位自身状态显示「启用」（回归对照）
 *  前置：由调用方先用 API 把任文静置为「已停用」，跑完再恢复。 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUTDIR = path.resolve(HERE, '..', '输出', '权限修复取证');
fs.mkdirSync(OUTDIR, { recursive: true });
const TOKEN_FILE = path.resolve(HERE, '..', '输出', '_token_linx_1024.txt');
const TOKEN = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
const BASEWEB = 'http://localhost:5173';
const BROWSER = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => fs.existsSync(p));
if (!BROWSER) throw new Error('msedge not found');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-udetail-'));
const child = spawn(BROWSER, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=9357', '--user-data-dir=' + profile, '--window-size=1520,1060', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
process.on('exit', () => { try { child.kill(); } catch { /* noop */ } });

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

/* 杀动画，避免截图时机问题 */
const KILL_ANIM = `(() => {
  const s = document.createElement('style');
  s.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}';
  document.head.appendChild(s); return true;
})()`;

/* 进账号管理页（经 harness 写 token，路由守卫不会再弹回） */
await send('Page.navigate', { url: `${BASEWEB}/_harness_login.html#${encodeURIComponent(TOKEN)}#/perm/user?t=${Date.now()}` });
await sleep(4500);
await ev(KILL_ANIM);
/** 重新进一遍账号管理页（绕开弹窗关闭的时序不确定性） */
async function reenter() {
  await send('Page.navigate', { url: `${BASEWEB}/_harness_login.html#${encodeURIComponent(TOKEN)}#/perm/user?t=${Date.now()}` });
  await sleep(4500);
  await ev(KILL_ANIM);
}

/** 点某账号行的「查看」打开详情，返回 {headerTag, rows:[{role, status}]} */
async function openDetail(name) {
  await reenter();
  let clicked = 'NO_ROW';
  for (let i = 0; i < 5; i++) {
    clicked = await ev(`(() => {
      const rows = [...document.querySelectorAll('table tbody tr')];
      const row = rows.find((r) => r.textContent.includes('${name}'));
      if (!row) return 'NO_ROW';
      const btn = [...row.querySelectorAll('a,span,button')].find((el) => el.textContent.trim() === '查看');
      if (!btn) return 'NO_BTN';
      btn.click(); return 'OK';
    })()`);
    if (clicked === 'OK') break;
    await sleep(1200);
  }
  if (clicked !== 'OK') {
    const dump = await ev(`(() => {
      const tables = [...document.querySelectorAll('table')];
      const trs = [...document.querySelectorAll('tbody tr')];
      return JSON.stringify({
        url: location.href.slice(0, 90),
        tables: tables.length,
        trs: trs.length,
        first3: trs.slice(0, 3).map((r) => r.textContent.trim().slice(0, 30)),
        hasName: document.body.textContent.includes('${name}'),
        bodyLen: document.body.innerText.length,
      });
    })()`);
    await shot(`诊断_找不到行_${name}.png`);
    throw new Error(`openDetail(${name}) -> ${clicked} | ${dump}`);
  }
  await sleep(2800); // 等详情 + 权限并集拉取
  const data = await ev(`(() => {
    const tables = [...document.querySelectorAll('table')];
    const tb = tables.find((t) => {
      const h = t.querySelector('thead')?.textContent || '';
      return h.includes('职位') && h.includes('权限数') && h.includes('状态');
    });
    if (!tb) return { err: 'NO_TABLE' };
    /* 状态标签只从详情弹窗容器里取（页面上列表行也有状态 tag，不能全页扫） */
    const dlg = [...document.querySelectorAll('div')].reverse().find((d) => d.querySelector('thead') && d.textContent.includes('账号详情'));
    const header = dlg ? [...dlg.querySelectorAll('span')].map((s) => s.textContent.trim()).find((x) => x === '正常' || x === '已停用' || x === '已锁定') : '';
    const rows = [...tb.querySelectorAll('tbody tr')].map((tr) => {
      const tds = [...tr.querySelectorAll('td')];
      return { role: tds[0]?.textContent.trim().replace(/^\\S+\\s/, ''), status: tds[2]?.textContent.trim() || '' };
    });
    return { headerTag: header, rows };
  })()`);
  const png = `详情状态_${name}_修复后.png`;
  await shot(png);
  return data;
}

const offRes = await openDetail('任文静'); // 已停用
const onRes = await openDetail('齐志远'); // 正常对照

console.log('任文静(已停用):', JSON.stringify(offRes));
console.log('齐志远(正常):  ', JSON.stringify(onRes));

/* 断言 */
const assert = (cond, msg) => { if (!cond) { console.error('❌ FAIL:', msg); process.exitCode = 1; } else console.log('✅', msg); };
assert(offRes.headerTag === '已停用', '任文静详情头部标签=已停用');
assert(offRes.rows.length > 0 && offRes.rows.every((r) => r.status.includes('停用') && r.status.includes('账号已停用')),
  '任文静职位行状态=停用（账号已停用）');
assert(offRes.rows.every((r) => !r.status.includes('启用')), '任文静职位行不再出现「启用」');
assert(onRes.rows.some((r) => r.status.includes('启用')), '齐志远（正常账号）职位行仍显示职位自身「启用」');
console.log(process.exitCode ? '== 有断言失败 ==' : '== 全部断言通过 ==');
