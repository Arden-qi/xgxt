/**
 * 回归验证（UI）：班级管理 —— 部门下拉 / 查询按钮 / 已结业下线（2026-10-22 批注）
 * ============================================================
 * 批注原文（截图红框圈「部门」）：三句话
 *   ① 「将部门里的前后端实训都删除」        → 部门下拉只剩 初高部 / 大学部 / 就业部
 *   ② 「选择部门时不进行查询，点击查询，才可以按照所选内容进行查询」
 *   ③ 「班级状态没有已结业，前后端以及上方的说明全都删除已结业」
 *
 * 断言：
 *   ① 部门下拉没有任何一项叫「实训」；选「就业部」能查到 stage_key=job 的实训班
 *   ② 只选部门、不点【查询】→ 列表条数 / 列不变；点【查询】→ 条数变 4、部门列隐藏
 *   ③ 页面全文本（说明条 + 统计卡 + 状态下拉）里没有「已结业」
 *   ④ 统计卡只有 3 张（初高部 / 大学部 / 就业部），无「实训班级」卡
 *
 * 用法：node tools/_verify-class-dept-query.mjs   （前后端需在跑：8004 + 5173）
 * 产物：tools/_out/verify_dept_query_*.png
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUTDIR = path.join(HERE, '_out');
fs.mkdirSync(OUTDIR, { recursive: true });
const PORT = 9363;
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

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-deptq-'));
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

/** 打开「部门」下拉，读出全部选项（不选、不查询） */
async function openDeptDropdown() {
  const rect = await ev(`(()=>{
    const item=[...document.querySelectorAll('.tcv-filter .el-form-item')].find(it=>(it.querySelector('.el-form-item__label')?.innerText||'').trim()==='部门');
    const wrap=item?.querySelector('.el-select__wrapper'); if(!wrap)return null;
    const r=wrap.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2};
  })()`);
  if (!rect) return null;
  await clickAt(rect.x, rect.y);
  await sleep(700);
  return ev(`(()=>{
    const poppers=[...document.querySelectorAll('.el-select__popper')].filter(p=>p.getBoundingClientRect().width>0);
    const panel=poppers[poppers.length-1]; if(!panel)return null;
    return [...panel.querySelectorAll('.el-select-dropdown__item')].map(x=>x.innerText.trim());
  })()`);
}

/** 在已打开的部门下拉里选中一项（不点查询） */
async function pickDept(label) {
  const ok = await ev(`(()=>{
    const poppers=[...document.querySelectorAll('.el-select__popper')].filter(p=>p.getBoundingClientRect().width>0);
    const panel=poppers[poppers.length-1]; if(!panel)return false;
    const item=[...panel.querySelectorAll('.el-select-dropdown__item')].find(x=>x.innerText.trim()===${JSON.stringify(label)});
    if(!item)return false; item.click(); return true;
  })()`);
  await sleep(900);
  return ok;
}

/** 列表当前条数（分页 total 文本「共 N 条」）+ 首列表头 */
async function listState() {
  return ev(`(()=>{
    const txt=document.body.innerText;
    const m=txt.match(/共\\s*(\\d+)\\s*条/);
    const heads=[...document.querySelectorAll('.el-table__header-wrapper th')].map(t=>t.innerText.trim()).filter(Boolean);
    const body=document.querySelectorAll('.el-table__body-wrapper .el-table__row').length;
    return { total: m?Number(m[1]):-1, heads, body };
  })()`);
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
  await shot('verify_dept_query_01_all.png');

  /* ---------- ① 部门下拉不再有「实训」 ---------- */
  const deptOpts = await openDeptDropdown();
  console.log(`  部门下拉选项：${JSON.stringify(deptOpts)}`);
  check('① 部门下拉不含「实训」', Array.isArray(deptOpts) && !deptOpts.includes('实训'));
  check(
    '① 部门下拉 = 初高部 / 大学部 / 就业部',
    Array.isArray(deptOpts) &&
      deptOpts.join(',') === '初高部,大学部,就业部',
    Array.isArray(deptOpts) ? deptOpts.join(',') : 'null',
  );

  /* ---------- ③ 页面（说明条 + 统计卡）里没有「已结业」 ---------- */
  const pageText = await ev(`document.body.innerText`);
  check('③ 说明条 / 统计卡无「已结业」', !pageText.includes('已结业'));
  const cards = await ev(`[...document.querySelectorAll('.tcv-card__k')].map(x=>x.innerText.trim())`);
  console.log(`  统计卡：${JSON.stringify(cards)}`);
  check('④ 统计卡只有 3 张（无「实训班级」卡）', Array.isArray(cards) && cards.length === 3, cards.join(','));
  check('④ 统计卡里有「就业部班级」', Array.isArray(cards) && cards.includes('就业部班级'));

  /* ---------- ③ 状态筛选下拉没有「已结业」 ---------- */
  const statusOpts = await ev(`(()=>{
    const item=[...document.querySelectorAll('.tcv-filter .el-form-item')].find(it=>(it.querySelector('.el-form-item__label')?.innerText||'').trim()==='状态');
    const wrap=item?.querySelector('.el-select__wrapper'); if(!wrap)return null;
    const r=wrap.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2};
  })()`);
  if (statusOpts) {
    await clickAt(statusOpts.x, statusOpts.y);
    await sleep(700);
  }
  const stList = await ev(`(()=>{
    const poppers=[...document.querySelectorAll('.el-select__popper')].filter(p=>p.getBoundingClientRect().width>0);
    const panel=poppers[poppers.length-1]; if(!panel)return null;
    return [...panel.querySelectorAll('.el-select-dropdown__item')].map(x=>x.innerText.trim());
  })()`);
  console.log(`  状态下拉选项：${JSON.stringify(stList)}`);
  check('③ 状态下拉无「已结业」', Array.isArray(stList) && !stList.includes('已结业'));
  await clickAt(statusOpts.x, statusOpts.y); // 关掉
  await sleep(500);

  /* ---------- ② 选部门不查询，点查询才查 ---------- */
  const before = await listState();
  console.log(`  初始：${JSON.stringify(before)}`);

  await openDeptDropdown();
  check('② 能选中「就业部」', await pickDept('就业部'));
  await shot('verify_dept_query_02_selected_no_query.png');

  const afterPick = await listState();
  console.log(`  只选不查：${JSON.stringify(afterPick)}`);
  check(
    '② 只选部门、未点查询 → 列表条数不变',
    afterPick.total === before.total,
    `${before.total} → ${afterPick.total}`,
  );
  check(
    '② 只选部门、未点查询 → 列表列不变（部门列仍在）',
    JSON.stringify(afterPick.heads) === JSON.stringify(before.heads),
    afterPick.heads.join(','),
  );

  check('② 点【查询】', await clickBtn('查询', '.tcv-filter'));
  await sleep(2200);
  const afterQuery = await listState();
  console.log(`  查询后：${JSON.stringify(afterQuery)}`);
  check('② 点查询后按所选部门查（就业部 4 条）', afterQuery.total === 4, `total=${afterQuery.total}`);
  check('② 查询后部门列隐藏（已选定部门）', !afterQuery.heads.includes('部门'), afterQuery.heads.join(','));
  await shot('verify_dept_query_03_after_query.png');

  /* ---------- ① 就业部里能看到实训班（stage_key=job） ---------- */
  const rows = await ev(`(()=>{
    return [...document.querySelectorAll('.el-table__body-wrapper .el-table__row')].map(tr=>tr.innerText.replace(/\\s+/g,' ').trim().slice(0,60));
  })()`);
  console.log(`  就业部行：\n    ${rows.join('\n    ')}`);
  check('① 就业部包含实训班（SX 编号）', rows.some((r) => /SX\d{4,}/.test(r)), `${rows.length} 行`);

  console.log(`\n页面异常：${pageErrors.length ? pageErrors.join(' | ') : '无'}`);
  check('无 JS 异常', pageErrors.length === 0);

  console.log(`\n${fails.length ? 'FAILED: ' + fails.join(' / ') : 'ALL PASS'}`);
  ws.close();
  child.kill();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('ERROR', e);
  try {
    child.kill();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
