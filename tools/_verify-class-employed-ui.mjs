/**
 * 回归验证（UI 层）：班级状态「实训 / 待就业 / 已就业」与【已就业】弹窗
 * ============================================================
 * 对应 2026-10-21 批注第 1/2/3 条（接口层见 _verify-class-employed-api.mjs）。
 *
 * 断言：
 *   · 实训部门统计卡片出现「实训 / 待就业 / 已就业」计数
 *   · 列表「状态」列分别显示 实训 / 待就业 / 已就业
 *   · 实训(5) 行 → 有【升就业】、没有【已就业】
 *   · 待就业(6) 行 → 有【待就业】(灰、不可点) + 【已就业】，没有【升就业】
 *   · 已就业(7) 行 → 两个按钮都没有
 *   · 点【已就业】→ 识别整班学生状态：
 *       全班已就业/退学（--settled）→ 显示班级人数 / 就业人数，一次确认；
 *       还有别的状态              → 标题「不可改为已就业」，列出人数 + 姓名，只有「我知道了」
 *       （★ 2026-10-23 批注推翻了原「强制确认 + 再次确认」的口径）
 *
 * 本脚本**只读**：弹窗一律点「我知道了 / 取消」关掉。
 * 前置：库里造好三种状态的实训班（见脚本注释 / SQL）。
 * 用法：node tools/_verify-class-employed-ui.mjs   （前后端需在跑：8004 + 5173）
 * 产物：tools/_out/verify_class_status_*.png
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUTDIR = path.join(HERE, '_out');
fs.mkdirSync(OUTDIR, { recursive: true });
const PORT = 9365;
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

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-cls-'));
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
let ws,
  msgId = 0;
const pending = new Map();
const pageErrors = [];

async function getTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const l = await r.json();
      const p = l.find((t) => t.type === 'page');
      if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl;
    } catch {}
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
async function msgBoxText() {
  return await ev(`(()=>{const b=[...document.querySelectorAll('.el-message-box')].filter(x=>x.getBoundingClientRect().width>0).pop();
    return b ? b.innerText.replace(/\\s+/g,' ') : '';})()`);
}
async function msgBoxClick(text) {
  const ok = await ev(`(()=>{const b=[...document.querySelectorAll('.el-message-box')].filter(x=>x.getBoundingClientRect().width>0).pop();
    if(!b)return false;const btn=[...b.querySelectorAll('button')].find(x=>x.innerText.trim()===${JSON.stringify(text)});
    if(!btn)return false;btn.click();return true;})()`);
  await sleep(800);
  return ok;
}
/** 表格某班所在行的按钮文本数组 */
async function rowButtons(code) {
  return await ev(`(()=>{const tr=[...document.querySelectorAll('.el-table__row')].find(x=>x.innerText.includes(${JSON.stringify(code)}));
    return tr?[...tr.querySelectorAll('button')].map(b=>b.innerText.trim()).filter(Boolean):null;})()`);
}
/** 表格某班所在行的状态列文本 */
async function rowStatus(code) {
  return await ev(`(()=>{const tr=[...document.querySelectorAll('.el-table__row')].find(x=>x.innerText.includes(${JSON.stringify(code)}));
    if(!tr)return null; const cells=[...tr.querySelectorAll('td')]; const tags=cells.flatMap(c=>[...c.querySelectorAll('.el-tag')].map(t=>t.innerText.trim()));
    return tags;})()`);
}

const fails = [];
const check = (n, ok, d = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  → ' + d : ''}`);
  if (!ok) fails.push(n);
};

async function loginAs(account) {
  for (let a = 1; a <= 3; a++) {
    await ev(`(()=>{try{localStorage.clear();}catch(e){}return true;})()`);
    await nav('/login', 3000);
    await ev(`(()=>{const el=[...document.querySelectorAll('.demo-item')].find(x=>x.innerText.includes('${account}'));if(el)el.click();return !!el;})()`);
    await sleep(800);
    await ev(`(()=>{const b=document.querySelector('.submit');if(b)b.click();return !!b;})()`);
    await sleep(4200);
    if (await ev(`document.body.innerText.includes('退出登录')`)) return true;
    console.log(`  （第 ${a} 次登录未成功，重试）`);
  }
  return false;
}

/** 部门筛选切到「实训」并查询 */
async function filterJobStage() {
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
    const item=[...panel.querySelectorAll('.el-select-dropdown__item')].find(x=>x.innerText.trim()==='实训');
    if(!item)return false; item.click(); return true;
  })()`);
  await sleep(600);
  await clickBtn('查询', '.tcv-filter');
  await sleep(2000);
  return ok;
}

(async () => {
  ws = new WebSocket(await getTarget());
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
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
      const { res, rej, to } = pending.get(m.id);
      clearTimeout(to);
      pending.delete(m.id);
      m.error ? rej(new Error(m.error.message)) : res(m.result);
    }
  };
  await send('Page.enable');
  await send('Runtime.enable');

  check('登录成功（校长 qiansy）', await loginAs('qiansy'));
  await nav('/teaching/class', 4000);
  check('筛选切到「实训」并查询', await filterJobStage());

  /* ---------- 统计卡片 ---------- */
  const cards = await ev(`(()=>{const c=[...document.querySelectorAll('.tcv-card')].map(x=>x.innerText.replace(/\\s+/g,' '));
    return c.find(t=>t.includes('实训班级'))||c[0]||'';})()`);
  console.log(`  卡片：${cards}`);
  check('统计卡片有「实训」「待就业」「已就业」计数', /实训\s*\d/.test(cards) && /待就业\s*\d/.test(cards) && /已就业\s*\d/.test(cards), cards);

  /* ---------- 三行状态 + 按钮 ---------- */
  const s1 = await rowStatus('SX20260001');
  const s2 = await rowStatus('SX20260002');
  const s3 = await rowStatus('SX2601');
  check('SX20260001 状态列显示「实训」', (s1 || []).includes('实训'), JSON.stringify(s1));
  check('SX20260002 状态列显示「待就业」', (s2 || []).includes('待就业'), JSON.stringify(s2));
  check('SX2601 状态列显示「已就业」', (s3 || []).includes('已就业'), JSON.stringify(s3));

  const b1 = await rowButtons('SX20260001');
  const b2 = await rowButtons('SX20260002');
  const b3 = await rowButtons('SX2601');
  check('实训行有【升就业】、无【已就业】', (b1 || []).includes('升就业') && !(b1 || []).includes('已就业'), JSON.stringify(b1));
  check('待就业行有【已就业】、无【升就业】', (b2 || []).includes('已就业') && !(b2 || []).includes('升就业'), JSON.stringify(b2));
  /* ★ 2026-10-23：升就业成功后按钮变【待就业】（灰、不可点） */
  check('待就业行还有灰的【待就业】', (b2 || []).includes('待就业'), JSON.stringify(b2));
  check('已就业行两个按钮都没有', !(b3 || []).includes('已就业') && !(b3 || []).includes('升就业'), JSON.stringify(b3));

  await shot(`verify_class_status_list_${Date.now()}.png`);

  /* ---------- 点【已就业】：识别整班学生状态 ---------- */
  const settledMode = process.argv.includes('--settled');
  const clicked = await ev(`(()=>{const tr=[...document.querySelectorAll('.el-table__row')].find(x=>x.innerText.includes('SX20260002'));
    const b=tr&&[...tr.querySelectorAll('button')].find(x=>x.innerText.trim()==='已就业'); if(!b)return false; b.click(); return true;})()`);
  await sleep(2200);
  const box = await msgBoxText();
  const boxTitle = await ev(`(()=>{const b=[...document.querySelectorAll('.el-message-box')].filter(x=>x.getBoundingClientRect().width>0).pop();
    return b ? (b.querySelector('.el-message-box__title')?.innerText.trim()||'') : '';})()`);
  console.log(`  弹窗：${box}`);
  check('点【已就业】弹出弹窗', clicked && !!box);
  if (settledMode) {
    // 全班学生都已是「已就业 / 退学」→ 提示班级人数 / 就业人数，一次确认
    check('全班已就业 → 显示班级人数与就业人数', /共?\s*6\s*人/.test(box) && /已就业\s*6\s*人/.test(box), box);
    check('全班已就业 → 不出现「强制」', !box.includes('强制'), box);
  } else {
    /* ★ 2026-10-23 批注改口径：班里还有别的状态 → 只提示人数 + 人员，**不可操作**
     *   （原「强制确认 + 再次确认」两条弹窗已删除） */
    check('标题是「不可改为已就业」', boxTitle === '不可改为已就业', boxTitle);
    check('弹窗列出各状态人数', /\d+\s*人/.test(box) && /待就业|实训中|已就业/.test(box), box);
    check('弹窗列出人员姓名', /请先在【教学管理/.test(box), '');
    check('弹窗不再提供「强制」', !box.includes('强制'), box);
    check('只有「我知道了」（没有确认按钮）', !box.includes('确认改为已就业'), '');
  }
  await shot(`verify_class_employed_dialog_${Date.now()}.png`);
  // 新口径下被拦时只有一个「我知道了」；settled 时仍有「取消」
  await msgBoxClick('我知道了');
  if (await msgBoxText()) await msgBoxClick('取消');
  check('弹窗关闭、数据不变', !(await msgBoxText()), '');

  check('无页面异常', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

  console.log(fails.length ? `\nFAILED ${fails.length} 项：${fails.join(' | ')}` : '\nALL PASS');
  ws.close();
  child.kill();
  process.exitCode = fails.length ? 1 : 0;
})();
