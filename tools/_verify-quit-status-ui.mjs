/**
 * 回归验证（UI）：退学学生在「班级管理 · 详情 · 花名册」里的状态列（2026-10-21 批注）
 * ============================================================
 * 批注原文（红框圈「状态」整列）：「学生状态为【退学】的，任何操作都不可更改该状态」
 *
 * 断言：
 *   ① 初高班 G2601 的详情抽屉里，退学学生的状态列显示「退学 · 锁定」（灰标签）
 *   ② 同一个花名册里，非退学学生仍是纯文本状态（没有被误标成锁定）
 *   ③ 悬停标签有「任何操作都不会更改该状态」的说明
 *
 * 用法：node tools/_verify-quit-status-ui.mjs   （前后端需在跑：8004 + 5173）
 * 产物：tools/_out/verify_quit_lock_*.png
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUTDIR = path.join(HERE, '_out');
fs.mkdirSync(OUTDIR, { recursive: true });
const PORT = 9361;
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

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-quit-'));
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
async function clickAt(x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
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
/** 部门筛选切到指定文本（初高部 / 大学部 / 就业部 / 实训） */
async function filterDept(label) {
  const rect = await ev(`(()=>{
    const item=[...document.querySelectorAll('.tcv-filter .el-form-item')].find(it=>(it.querySelector('.el-form-item__label')?.innerText||'').trim()==='部门');
    const wrap=item?.querySelector('.el-select__wrapper'); if(!wrap)return null;
    const r=wrap.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2};
  })()`);
  if (!rect) return false;
  await clickAt(rect.x, rect.y);
  await sleep(700);
  const ok = await ev(`(()=>{
    const poppers=[...document.querySelectorAll('.el-select__popper')].filter(p=>p.getBoundingClientRect().width>0);
    const panel=poppers[poppers.length-1]; if(!panel)return false;
    const item=[...panel.querySelectorAll('.el-select-dropdown__item')].find(x=>x.innerText.trim()===${JSON.stringify(label)});
    if(!item)return false; item.click(); return true;
  })()`);
  await sleep(600);
  await clickBtn('查询', '.tcv-filter');
  await sleep(2200);
  return ok;
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
  await nav('/teaching/class', 4000);
  check('部门切到「初高部」并查询', await filterDept('初高部'));

  // 打开 G2601 的详情抽屉
  const opened = await ev(`(()=>{
    const tr=[...document.querySelectorAll('.el-table__row')].find(x=>x.innerText.includes('G2601'));
    const b=tr&&[...tr.querySelectorAll('button')].find(x=>x.innerText.trim()==='详情');
    if(!b)return false; b.click(); return true;})()`);
  await sleep(2600);
  check('能打开班级详情抽屉', opened && !!(await ev(`!!document.querySelector('.el-drawer')`)));

  // 花名册里退学学生的状态单元格
  const quitCells = await ev(`(()=>{
    const drawer=[...document.querySelectorAll('.el-drawer')].filter(x=>x.getBoundingClientRect().width>0).pop();
    if(!drawer)return null;
    const rows=[...drawer.querySelectorAll('.el-table__row')];
    const out=[];
    for(const tr of rows){
      const txt=tr.innerText.replace(/\\s+/g,' ');
      if(/李芳|陈嘉豪/.test(txt)) out.push(txt.slice(0,80));
    }
    return out;})()`);
  console.log(`  退学学生行：${JSON.stringify(quitCells)}`);
  const lockedCount = await ev(`(()=>{
    const drawer=[...document.querySelectorAll('.el-drawer')].filter(x=>x.getBoundingClientRect().width>0).pop();
    if(!drawer)return 0;
    return [...drawer.querySelectorAll('.el-tag')].filter(t=>t.innerText.includes('退学')).length;})()`);
  check('① 退学学生在花名册里显示「退学 · 锁定」标签', Number(lockedCount) >= 2, `共 ${lockedCount} 个退学标签`);

  // 非退学学生不能被误标
  const otherTags = await ev(`(()=>{
    const drawer=[...document.querySelectorAll('.el-drawer')].filter(x=>x.getBoundingClientRect().width>0).pop();
    if(!drawer)return [];
    return [...drawer.querySelectorAll('.el-tag')].map(t=>t.innerText.trim());})()`);
  check('② 只有退学行带锁定标签', !otherTags.some((t) => /锁定/.test(t) && !/退学/.test(t)), JSON.stringify(otherTags));

  // 悬停标签看提示语
  const tipRect = await ev(`(()=>{
    const drawer=[...document.querySelectorAll('.el-drawer')].filter(x=>x.getBoundingClientRect().width>0).pop();
    const tag=drawer&&[...drawer.querySelectorAll('.el-tag')].find(t=>t.innerText.includes('退学'));
    if(!tag)return null; const r=tag.getBoundingClientRect();
    return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
  let tip = '';
  if (tipRect) {
    await clickAt(tipRect.x, tipRect.y);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: tipRect.x, y: tipRect.y });
    await sleep(1200);
    tip = await ev(`(()=>{const p=[...document.querySelectorAll('.el-popper')].filter(x=>x.getBoundingClientRect().width>0).pop();
      return p?p.innerText.replace(/\\s+/g,' '):'';})()`);
  }
  check('③ 悬停提示「任何操作都不会更改该状态」', /任何操作都不会更改该状态/.test(tip || ''), tip || '(无提示)');

  await shot(`verify_quit_lock_detail_${Date.now()}.png`);

  /* ============ ④ 学生档案 · 编辑退学学生 → 状态下拉锁死 ============ */
  await nav('/teaching/student', 4200);
  const typed = await ev(`(()=>{
    const inp=[...document.querySelectorAll('.tsv-filter input')].find(i=>(i.placeholder||'').includes('姓名'));
    if(!inp)return false;
    inp.focus(); inp.value='J26002';
    inp.dispatchEvent(new Event('input',{bubbles:true}));
    return true;})()`);
  await sleep(500);
  await clickBtn('查询', '.tsv-filter');
  await sleep(2200);
  const rowFound = await ev(`(()=>{
    const tr=[...document.querySelectorAll('.el-table__row')].find(x=>x.innerText.includes('J26002'));
    if(!tr)return null;
    const b=[...tr.querySelectorAll('button')].find(x=>x.innerText.trim()==='编辑');
    if(!b)return false; b.click(); return true;})()`);
  await sleep(2600);
  const dlg = await ev(`(()=>{
    const d=[...document.querySelectorAll('.el-dialog')].filter(x=>x.getBoundingClientRect().width>0).pop();
    if(!d)return null;
    const item=[...d.querySelectorAll('.el-form-item')].find(it=>(it.querySelector('.el-form-item__label')?.innerText||'').trim()==='状态');
    const wrap=item?.querySelector('.el-select__wrapper');
    return {disabled: !!wrap?.classList.contains('is-disabled'), tip: item?.innerText.replace(/\\s+/g,' ')||''};})()`);
  console.log(`  编辑弹窗状态字段：${JSON.stringify(dlg)}`);
  check('④ 编辑退学学生 → 状态下拉 disabled', typed && rowFound && !!dlg?.disabled, String(dlg?.disabled));
  check('④′ 下拉下方有「已退学…不可更改」提示', /已退学/.test(dlg?.tip || '') && /不可更改/.test(dlg?.tip || ''), dlg?.tip || '');
  await shot(`verify_quit_lock_edit_${Date.now()}.png`);

  check('无页面异常', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

  console.log(fails.length ? `\nFAILED ${fails.length} 项：${fails.join(' | ')}` : '\nALL PASS');
  ws.close();
  child.kill();
  process.exitCode = fails.length ? 1 : 0;
})().catch((e) => {
  console.error('异常：', e?.message || e);
  try {
    child.kill();
  } catch {
    /* ignore */
  }
  process.exitCode = 1;
});
