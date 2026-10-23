/**
 * 回归验证（UI）：班级管理 · 删除守卫（2026-10-22 批注）
 * ============================================================
 * 批注原文（截图红字 + 红框）：「不可删除有人的班级」
 *
 * 断言：
 *   ① 点有学生班级（初高 G2601，3 人）的【删除】→ 弹窗标题是「不可删除有人的班级」
 *   ② 正文带上该班人数，且只有【我知道了】一个按钮（没有"确定删除"）
 *   ③ 点【我知道了】弹窗关闭，班级还在列表里（没被删）
 *
 * 用法：node tools/_verify-class-delete-guard.mjs   （前后端需在跑：8004 + 5173）
 * 产物：tools/_out/verify_class_delete_*.png
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUTDIR = path.join(HERE, '_out');
fs.mkdirSync(OUTDIR, { recursive: true });
const PORT = 9362;
const BASE = 'http://localhost:5173';

const BROWSER = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].find((p) => fs.existsSync(p));
if (!BROWSER) {
  console.log('NO BROWSER');
  process.exit(1);
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-delguard-'));
const child = spawn(
  BROWSER,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + profile,
    '--window-size=1680,1050',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
let msgId = 0;
const pending = new Map();
const pageErrors = [];

async function getTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const l = await r.json();
      const p = l.find((t) => t.type === 'page');
      if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl;
    } catch {
      /* 等浏览器起来 */
    }
    await sleep(250);
  }
  throw new Error('no target');
}
function send(m, p = {}) {
  return new Promise((res, rej) => {
    const i = ++msgId;
    const to = setTimeout(() => rej(new Error('timeout ' + m)), 30000);
    pending.set(i, { res, rej, to });
    ws.send(JSON.stringify({ id: i, method: m, params: p }));
  });
}
async function ev(e) {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  return r.result?.value;
}
async function shot(n) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUTDIR, n), Buffer.from(r.data, 'base64'));
}
async function nav(hash, wait = 3000) {
  await send('Page.navigate', { url: `${BASE}/?t=${Date.now()}#${hash}` }, 30000);
  await sleep(wait);
}
async function clickBtn(text, rootSel = 'body') {
  const ok = await ev(`(()=>{
    const root=document.querySelector(${JSON.stringify(rootSel)})||document.body;
    const b=[...root.querySelectorAll('button')].find(x=>x.innerText.trim()===${JSON.stringify(text)} && x.getBoundingClientRect().width>0);
    if(!b)return false; b.click(); return true;
  })()`);
  await sleep(700);
  return ok;
}
async function loginAs(account) {
  for (let a = 1; a <= 3; a++) {
    await ev(`(()=>{try{localStorage.clear();}catch(e){}return true;})()`);
    await nav('/login', 3000);
    await ev(`(()=>{const el=[...document.querySelectorAll('.demo-item')].find(x=>x.innerText.includes('${account}'));if(el)el.click();return !!el;})()`);
    await sleep(800);
    await ev(`(()=>{const b=document.querySelector('.submit');if(b)b.click();return !!b;})()`);
    await sleep(4200);
    if (await ev(`document.body.innerText.includes('退出登录')`)) return true;
  }
  return false;
}

/** 读当前可见的 MessageBox（标题 / 正文 / 按钮） */
function readBox() {
  return ev(`(()=>{
    const boxes=[...document.querySelectorAll('.el-message-box')].filter(b=>b.getBoundingClientRect().width>0);
    const b=boxes[boxes.length-1]; if(!b)return null;
    return {
      title: (b.querySelector('.el-message-box__title')?.innerText||'').trim(),
      content: (b.querySelector('.el-message-box__message')?.innerText||'').trim(),
      buttons: [...b.querySelectorAll('button')].map(x=>x.innerText.trim()),
    };})()`);
}

const fails = [];
const check = (n, ok, d = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  → ' + d : ''}`);
  if (!ok) fails.push(n);
};

(async () => {
  ws = new WebSocket(await getTarget());
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
    ws.onmessage = (e) => {
      let m;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      if (m.method === 'Runtime.exceptionThrown')
        pageErrors.push(m.params?.exceptionDetails?.exception?.description || 'unknown');
      if (m.id && pending.has(m.id)) {
        const { res: r, rej: j, to } = pending.get(m.id);
        clearTimeout(to);
        pending.delete(m.id);
        m.error ? j(new Error(m.error.message)) : r(m.result);
      }
    };
  });
  await send('Page.enable');
  await send('Runtime.enable');

  check('登录成功（校长 qiansy）', await loginAs('qiansy'));
  await nav('/teaching/class', 4500);

  // 找一个有学生的班（默认列表第一行就是初高 G2601 / 3 人）
  const target = await ev(`(()=>{
    const tr=[...document.querySelectorAll('.el-table__row')].find(x=>/G2601/.test(x.innerText));
    if(!tr)return null;
    const cells=[...tr.querySelectorAll('td')].map(td=>td.innerText.trim());
    const b=[...tr.querySelectorAll('button')].find(x=>x.innerText.trim()==='删除');
    if(!b)return null; b.click();
    return {row: tr.innerText.replace(/\\s+/g,' ').slice(0,120), cells};})()`);
  check('找到有学生的班并点了【删除】（G2601）', !!target, target ? target.cells.join(' | ') : '未找到行');
  await sleep(1200);
  await shot('verify_class_delete_alert.png');

  const box = await readBox();
  console.log('  弹窗：', JSON.stringify(box));
  check('① 弹窗标题 = 「不可删除有人的班级」', box?.title === '不可删除有人的班级', box?.title || '无弹窗');
  check('② 正文带人数提示', /名学生/.test(box?.content || ''), box?.content || '');
  // ⚠️ ElMessageBox 右上角的关闭按钮也是个 <button>（innerText 为空），先滤掉再数
  const namedButtons = (box?.buttons || []).filter((b) => b);
  check(
    '② 只有一个【我知道了】按钮（没有"确定删除"）',
    namedButtons.length === 1 && namedButtons[0] === '我知道了',
    JSON.stringify(namedButtons),
  );

  await clickBtn('我知道了');
  await sleep(900);
  check('③ 弹窗已关闭', !(await readBox()));
  check(
    '③ 班级仍在列表里（没有被删）',
    await ev(`document.body.innerText.includes('G2601')`),
  );
  await shot('verify_class_delete_after.png');

  console.log(`\n页面 JS 异常：${pageErrors.length ? pageErrors.join(' / ') : '无'}`);
  console.log(fails.length ? `\n❌ 失败 ${fails.length} 项：${fails.join('；')}` : '\n✅ 全部通过');
  ws.close();
  child.kill();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('脚本异常：', e.message);
  try {
    child.kill();
  } catch {}
  process.exit(1);
});
