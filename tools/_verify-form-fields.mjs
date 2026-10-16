/**
 * 回归验证：2026-10-16 第二批批注（两个弹窗的表单字段）
 * ============================================================
 * 图1 · 班级管理「新增班级」：删掉五个交棒字段
 *    项目经理 / 项目经理姓名 / 就业老师 / 就业老师姓名 / 大学学号
 * 图2 · 学生档案「新增学生」：
 *    ① 删掉「上网账号 / 初始密码」两个输入框；
 *    ② 状态下拉里删掉「预在读」；
 *    ③ 姓名必填仍然生效（不填 → 提示「姓名必填」并拦住保存）。
 *
 * 用法：node tools\_verify-form-fields.mjs      （前后端需在跑：8004 + 5173）
 * 产物：tools/_out/verify_form_*.png
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUTDIR = path.join(HERE, '_out');
fs.mkdirSync(OUTDIR, { recursive: true });
const PORT = 9347;
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

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-probe-'));
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
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const page = (await r.json()).find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch { /* retry */ }
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
  fs.writeFileSync(path.join(OUTDIR, name), Buffer.from(r.data, 'base64'));
  console.log('  shot: ' + name);
}
async function nav(hash, wait = 2600) {
  await send('Page.navigate', { url: `${BASE}/?t=${Date.now()}#${hash}` }, 30000);
  await sleep(wait);
}
async function loginAs(account) {
  await ev(`(() => { try { localStorage.clear(); } catch(e){} return true; })()`);
  await nav('/login', 2200);
  await ev(`(() => { const el=[...document.querySelectorAll('.demo-item')].find(x=>x.innerText.includes('${account}')); if(el) el.click(); return !!el; })()`);
  await sleep(500);
  await ev(`(() => { const b=document.querySelector('.submit'); if(b) b.click(); return !!b; })()`);
  await sleep(3400);
}

/** 弹窗里的所有 label */
const DIALOG_LABELS = `[...document.querySelectorAll('.el-dialog .el-form-item__label')].map(e=>e.innerText.trim()).join(' | ')`;
/** 点弹窗里的按钮 */
const clickDialogBtn = (text) => `(() => {
  const b=[...document.querySelectorAll('.el-dialog__footer button')].find(x=>x.innerText.trim()==='${text}');
  if(b){b.click();return true;} return false;
})()`;
/** 用**真实鼠标事件**点元素（CDP Input）——
 *  合成 MouseEvent 打不开 Element Plus 的下拉，必须走原生输入事件 */
async function mouseClickAt(expr) {
  const box = await ev(`(() => {
    const el = ${expr};
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  if (!box) return false;
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', {
      type, x: box.x, y: box.y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0,
    });
    await sleep(60);
  }
  return true;
}
const dialogSelectEl = (label) => `(() => {
  const it=[...document.querySelectorAll('.el-dialog .el-form-item')].find(x=>x.querySelector('.el-form-item__label')?.innerText.trim()==='${label}');
  return it ? (it.querySelector('.el-select__wrapper') || it.querySelector('.el-select')) : null;
})()`;
const visibleItemEl = (text) => `[...document.querySelectorAll('.el-select-dropdown__item')].filter(${VISIBLE_ITEM}).find(e=>e.innerText.trim()==='${text}')`;
/** 可见的下拉项：Element Plus 的下拉挂在 body 上的 fixed popper 里，
 *  offsetParent 恒为 null，所以用 popper 的 display + 元素高度判断可见性 */
const VISIBLE_ITEM = `(e) => {
  const dd = e.closest('.el-select-dropdown');
  if (dd && getComputedStyle(dd).display === 'none') return false;
  const r = e.getBoundingClientRect();
  return r.height > 0 && r.width > 0;
}`;
const visibleOptions = `[...document.querySelectorAll('.el-select-dropdown__item')].filter(${VISIBLE_ITEM}).map(e=>e.innerText.trim()).join('/')`;
const pickVisibleOption = (text) => `(() => {
  const el=[...document.querySelectorAll('.el-select-dropdown__item')].filter(${VISIBLE_ITEM}).find(e=>e.innerText.trim()==='${text}');
  if(el){el.dispatchEvent(new MouseEvent('click',{bubbles:true}));return true;} return false;
})()`;

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
  if (!ok) fails.push(name);
};

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
  await loginAs('qiansy');

  /* ================= 图2：新增学生 ================= */
  console.log('=== 学生档案 · 新增学生 ===');
  await nav('/teaching/student', 3000);
  await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='新增学生'); if(b) b.click(); return !!b; })()`);
  await sleep(1200);
  const sLabels = await ev(DIALOG_LABELS);
  console.log('  labels:', sLabels);
  check('已删除「上网账号」', !sLabels.includes('上网账号'));
  check('已删除「初始密码」', !sLabels.includes('初始密码'));
  check('仍保留「家庭住址 / 备注」', sLabels.includes('家庭住址') && sLabels.includes('备注'));

  await mouseClickAt(dialogSelectEl('状态'));
  await sleep(800);
  const statusOpts = await ev(visibleOptions);
  console.log('  状态选项:', statusOpts);
  check('状态下拉已无「预在读」', !/预在读/.test(statusOpts));
  check('状态仍保留「正式在读 / 休学」', /正式在读/.test(statusOpts) && /休学/.test(statusOpts));
  await shot('verify_form_student_status.png');
  await ev(`document.body.click()`);
  await sleep(300);

  console.log('--- 姓名必填：直接点保存 ---');
  await ev(clickDialogBtn('保存'));
  await sleep(1500);
  const msg = await ev(`[...document.querySelectorAll('.el-message__content, .el-form-item__error')].map(e=>e.innerText.trim()).join(' || ')`);
  const stillOpen = await ev(`!!document.querySelector('.el-dialog__body')`);
  check('不填姓名 → 提示「姓名必填」', /姓名必填/.test(msg), msg);
  check('不填姓名 → 弹窗不关闭（保存被拦住）', stillOpen === true);
  await shot('verify_form_student_name_required.png');
  await ev(clickDialogBtn('取消'));
  await sleep(500);

  /* ================= 图1：新增班级 ================= */
  console.log('=== 班级管理 · 新增班级（部门=大学部）===');
  await nav('/teaching/class', 3000);
  await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='新增班级'); if(b) b.click(); return !!b; })()`);
  await sleep(1200);
  await mouseClickAt(dialogSelectEl('部门'));
  await sleep(800);
  await mouseClickAt(visibleItemEl('大学部'));
  await sleep(600);
  const cLabels = await ev(DIALOG_LABELS);
  console.log('  labels:', cLabels);
  for (const f of ['项目经理', '项目经理姓名', '就业老师', '就业老师姓名', '大学学号']) {
    check(`已删除「${f}」`, !cLabels.includes(f));
  }
  check('仍保留「教室 / 开班日期」', cLabels.includes('教室') && cLabels.includes('开班日期'));
  check('仍保留「班主任姓名 / 教员姓名 / 助教姓名」', cLabels.includes('班主任姓名') && cLabels.includes('教员姓名') && cLabels.includes('助教姓名'));
  await shot('verify_form_class_no_handover.png');

  console.log(`\n${fails.length ? 'FAILED: ' + fails.join(' / ') : 'ALL PASS'}`);
  child.kill();
  process.exitCode = fails.length ? 1 : 0;
})().catch((e) => { console.error('脚本异常：', e.message); child.kill(); process.exitCode = 1; });
