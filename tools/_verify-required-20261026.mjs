/**
 * 回归验证：2026-10-26 三条红框批注
 * =========================================================
 * ① 新增学生：红框内字段（含家庭住址）必填 → 直接点保存要出提示
 * ② 新增班级：项目经理 / 就业老师 **只在部门 = 就业部时显示**（大学部要隐藏）
 * ③ 新增班级：除备注、开班日期、教室、助教外都是必选项 → 直接点保存要出提示
 *
 * 用法：node tools\_verify-required-20261026.mjs   （前后端需在跑：8004 + 5173）
 * 产物：tools/_out/req_*.png
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUTDIR = path.join(HERE, '_out');
fs.mkdirSync(OUTDIR, { recursive: true });
const PORT = 9357;
const BASE = 'http://localhost:5173';

const BROWSER = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].find((p) => fs.existsSync(p));
if (!BROWSER) { console.log('NO BROWSER'); process.exit(1); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-req-'));
const child = spawn(BROWSER, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
  '--window-size=1680,1050', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws; let msgId = 0; const pending = new Map();
const pageErrors = [];

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
}
async function nav(hash, wait = 3000) {
  await send('Page.navigate', { url: `${BASE}/#${hash}` }, 30000);
  await sleep(wait);
}
async function loginAs(account) {
  await ev(`(() => { try { localStorage.clear(); } catch(e){} return true; })()`);
  await nav('/', 2000);
  const r = await ev(`(async () => {
    const res = await fetch('/api/portal/account/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: '${account}', password: '123456' }),
    });
    const j = await res.json();
    if (j.code !== 200 || !j.data?.token) return 'FAIL:' + (j.message || j.code);
    localStorage.setItem('sms_token', j.data.token);
    return 'OK';
  })()`);
  if (r !== 'OK') throw new Error(`登录 ${account} 失败：${r}`);
  await sleep(600);
}

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
  if (!ok) fails.push(name);
};

/** 点按钮（按文字，限定在可见容器内） */
const clickBtn = (text, scope = 'document') => ev(`(() => {
  const root = ${scope};
  const b = [...root.querySelectorAll('button, .el-button')]
    .filter(x => x.offsetParent !== null && x.innerText.trim() === ${JSON.stringify(text)})[0];
  if (!b) return 'NOT_FOUND';
  b.click();
  return 'OK';
})()`);

/** 当前可见弹窗的 form-item 标签 + 是否有红星 + 错误提示 */
const dialogState = () => ev(`(() => {
  const d = [...document.querySelectorAll('.el-dialog')].filter(x => x.offsetParent !== null).pop();
  if (!d) return { ok: false, reason: 'no dialog' };
  const labels = [...d.querySelectorAll('.el-form-item')].map(it => {
    const lab = it.querySelector('.el-form-item__label');
    // ⚠️ element-plus 把 is-required 挂在 el-form-item 根节点上，不是子元素 → 用 classList 判断
    return { text: (lab?.innerText || '').trim(), required: it.classList.contains('is-required') };
  }).filter(x => x.text);
  const errors = [...d.querySelectorAll('.el-form-item__error')].map(e => e.innerText.trim());
  return { ok: true, title: d.querySelector('.el-dialog__title')?.innerText || '', labels, errors };
})()`);
const hasLabel = (st, t) => st.labels.some((l) => l.text.includes(t));

/** 把某个标签对应的输入框清空（触发 v-model），用于验证「编辑时也必填」 */
async function clearByLabel(label) {
  return ev(`(() => {
    const d = [...document.querySelectorAll('.el-dialog')].filter(x => x.offsetParent !== null).pop();
    if (!d) return 'NO_DIALOG';
    const it = [...d.querySelectorAll('.el-form-item')].find(x =>
      (x.querySelector('.el-form-item__label')?.innerText || '').trim() === ${JSON.stringify(label)});
    if (!it) return 'NO_ITEM';
    const inp = it.querySelector('input.el-input__inner');
    if (!inp) return 'NO_INPUT';
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inp, '');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    return 'OK';
  })()`);
}

/** 点第一条数据行的【编辑】 */
const clickRowEdit = () => ev(`(() => {
  const rows = [...document.querySelectorAll('.el-table__row')].filter(r => r.offsetParent !== null);
  if (!rows.length) return 'NO_ROW';
  const btn = [...rows[0].querySelectorAll('button, .el-button')].find(b => b.innerText.trim() === '编辑');
  if (!btn) return 'NO_BTN';
  btn.click();
  return 'OK';
})()`);

/** 在弹窗里打开第 n 个 el-select（0 = 部门）并点选指定文字的下拉项 */
async function pickSelect(text, index = 0) {
  const r1 = await ev(`(() => {
    const d = [...document.querySelectorAll('.el-dialog')].filter(x => x.offsetParent !== null).pop();
    if (!d) return 'NO_DIALOG';
    const sels = [...d.querySelectorAll('.el-select')].filter(x => x.offsetParent !== null);
    const sel = sels[${index}];
    if (!sel) return 'NO_SELECT';
    (sel.querySelector('.el-select__wrapper') || sel).click();
    return 'OK';
  })()`);
  await sleep(800);
  const r2 = await ev(`(() => {
    const pops = [...document.querySelectorAll('.el-select-dropdown')].filter(x => x.offsetParent !== null);
    const pop = pops[pops.length - 1];
    if (!pop) return 'NO_POPPER';
    const it = [...pop.querySelectorAll('.el-select-dropdown__item')]
      .find(x => x.innerText.trim() === ${JSON.stringify(text)});
    if (!it) return 'NO_ITEM:' + pop.innerText.replace(/\\n/g, '|');
    it.click();
    return 'OK';
  })()`);
  await sleep(1000);
  return r1 + '/' + r2;
}

(async () => {
  ws = new WebSocket(await getTarget());
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params?.exceptionDetails?.exception?.description || 'unknown');
    if (m.id && pending.has(m.id)) {
      const { resolve, reject, to } = pending.get(m.id);
      clearTimeout(to); pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    }
  };
  await send('Page.enable'); await send('Runtime.enable');
  await loginAs('qiansy');

  /* ---------- ② 新增班级（默认大学部）：项目经理/就业老师应隐藏 ---------- */
  console.log('\n=== ② 新增班级：非就业部（默认初高部）===');
  await nav('/teaching/class', 3500);
  pageErrors.length = 0;
  check('点【新增班级】', (await clickBtn('新增班级')) === 'OK');
  await sleep(1200);
  let st = await dialogState();
  console.log('  弹窗标题:', st.title);
  console.log('  字段:', st.labels.map((l) => l.text + (l.required ? '*' : '')).join(' / '));
  check('非就业部不显示「项目经理」', !hasLabel(st, '项目经理'));
  check('非就业部不显示「就业老师」', !hasLabel(st, '就业老师'));
  check('「班级名称」有红星', st.labels.some((l) => l.text.includes('班级名称') && l.required));
  check('「班主任」有红星', st.labels.some((l) => l.text.includes('班主任') && l.required));
  check('「教员」有红星', st.labels.some((l) => l.text.includes('教员') && l.required));
  check('「助教」无红星', st.labels.some((l) => l.text.includes('助教') && !l.required));
  // ★ 2026-10-26 补充批注：必选项前端只显示红星，输入/失焦不应弹红字
  await ev(`(() => {
    const d = [...document.querySelectorAll('.el-dialog')].filter(x => x.offsetParent !== null).pop();
    const inp = d.querySelector('input.el-input__inner');
    if (inp) { inp.focus(); inp.blur(); }
    return true;
  })()`);
  await sleep(600);
  st = await dialogState();
  check('失焦不实时弹红字（只在保存时提示）', st.errors.length === 0, st.errors.join(' | '));
  await shot('req_class_new_university.png');

  /* ---------- ③ 空表单点保存 → 必填提示 ---------- */
  console.log('\n=== ③ 新增班级：空表单点保存 ===');
  check('点【保存】', (await clickBtn('保存')) === 'OK');
  await sleep(1200);
  st = await dialogState();
  console.log('  报错:', st.errors.join(' | ') || '(无)');
  check('出现必填提示', st.errors.length > 0, `${st.errors.length} 条`);
  check('提示含「班级名称」', st.errors.some((e) => e.includes('班级名称')));
  check('提示含「班级编号」', st.errors.some((e) => e.includes('班级编号')));
  check('提示含「班主任」', st.errors.some((e) => e.includes('班主任')));
  check('弹窗未被关闭（校验拦住保存）', st.ok && !!st.title);
  check('无未捕获异常', pageErrors.length === 0, pageErrors[0] || '');
  await shot('req_class_empty_save.png');
  // ★ 2026-10-26：红字要能被「用户开始填写」收起（否则补完了提示还挂着，像没生效）
  await ev(`(() => {
    const d = [...document.querySelectorAll('.el-dialog')].filter(x => x.offsetParent !== null).pop();
    const inp = d.querySelector('input.el-input__inner');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inp, '冒烟测试班');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(600);
  st = await dialogState();
  check('开始填写后红字自动收起', st.errors.length === 0, st.errors.join(' | '));
  await clickBtn('取消');
  await sleep(600);

  /* ---------- ② 就业部新增：班主任 / 教员 不是必选项 ---------- */
  console.log('\n=== ② 就业部新增班级：班主任 / 教员 不是必选 ===');
  check('点【新增班级】', (await clickBtn('新增班级')) === 'OK');
  await sleep(1400);
  // 先在初高部点一次保存，把红字打出来 —— 后面切部门要验证这些旧红字会被清掉
  check('（初高部）点【保存】', (await clickBtn('保存')) === 'OK');
  await sleep(1300);
  st = await dialogState();
  check('初高部：保存后要求班主任/教员',
    st.errors.some((e) => e.includes('班主任')) && st.errors.some((e) => e.includes('教员')),
    st.errors.join(' | '));
  // ⚠️ 不能靠 URL 上的 ?stage=emp —— 页面没读它，openCreate 用的是 query.stage（页面过滤器）
  //    → 直接在弹窗里把「部门」切到就业部，走 onFormDeptChange 的真实联动
  check('部门切到「就业部」', (await pickSelect('就业部')) === 'OK/OK');
  st = await dialogState();
  console.log('  切部门后报错:', st.errors.join(' | ') || '(无)');
  // ★ 2026-10-26 批注：「进行部门的选择的时候，不显示必选项的文字提示」
  //   → 切部门本身不许再冒新红字，也不许留着「请选择班主任 / 请选择教员」这种已失效的旧红字
  check('切部门不再要求班主任', !st.errors.some((e) => e.includes('班主任')));
  check('切部门不再要求教员', !st.errors.some((e) => e.includes('教员')));
  check('切部门不冒新红字（就业部必填项未提前提示）',
    !st.errors.some((e) => e.includes('就业部班级必填')), st.errors.join(' | '));
  console.log('  字段:', st.labels.map((l) => l.text + (l.required ? '*' : '')).join(' / '));
  check('「班主任」无红星', st.labels.some((l) => l.text.includes('班主任') && !l.required));
  check('「教员」无红星', st.labels.some((l) => l.text.includes('教员') && !l.required));
  check('「项目经理」有红星', st.labels.some((l) => l.text.includes('项目经理') && l.required));
  check('「就业老师」有红星', st.labels.some((l) => l.text.includes('就业老师') && l.required));
  await shot('req_class_new_employment.png');
  check('点【保存】(就业部)', (await clickBtn('保存')) === 'OK');
  await sleep(1400);
  st = await dialogState();
  console.log('  报错:', st.errors.join(' | ') || '(无)');
  check('保存时不再要求班主任', !st.errors.some((e) => e.includes('班主任')));
  check('保存时不再要求教员', !st.errors.some((e) => e.includes('教员')));
  await clickBtn('取消');
  await sleep(600);

  /* ---------- ② 就业部班级编辑：项目经理/就业老师应显示 ---------- */
  console.log('\n=== ② 编辑就业部班级（应有项目经理/就业老师）===');
  const opened = await ev(`(() => {
    const rows = [...document.querySelectorAll('.el-table__row')].filter(r => r.offsetParent !== null);
    const row = rows.find(r => (r.innerText || '').includes('就业部'));
    if (!row) return 'NO_ROW';
    const btn = [...row.querySelectorAll('button, .el-button')].find(b => b.innerText.trim() === '编辑');
    if (!btn) return 'NO_BTN';
    btn.click();
    return 'OK';
  })()`);
  check('找到就业部班级并点【编辑】', opened === 'OK', opened);
  await sleep(1500);
  st = await dialogState();
  console.log('  弹窗标题:', st.title);
  console.log('  字段:', st.labels.map((l) => l.text + (l.required ? '*' : '')).join(' / '));
  check('就业部显示「项目经理」', hasLabel(st, '项目经理'));
  check('就业部显示「就业老师」', hasLabel(st, '就业老师'));
  await shot('req_class_edit_employment.png');
  await clickBtn('取消');
  await sleep(600);

  /* ---------- ① 新增学生：红框内必填 ---------- */
  console.log('\n=== ① 新增学生：空表单点保存 ===');
  await nav('/teaching/student', 3500);
  pageErrors.length = 0;
  check('点【新增学生】', (await clickBtn('新增学生')) === 'OK');
  await sleep(1200);
  st = await dialogState();
  console.log('  字段:', st.labels.map((l) => l.text + (l.required ? '*' : '')).join(' / '));
  const mustStar = ['姓名', '性别', '身份证号', '部门', '班级', '状态', '手机号', '家长姓名',
    '家长手机', '籍贯', '学历', '毕业学校', '入学日期', '家庭住址'];
  const missed = mustStar.filter((t) => !st.labels.some((l) => l.text.includes(t) && l.required));
  check('红框字段都有红星', missed.length === 0, missed.length ? '缺: ' + missed.join('/') : '');
  check('「备注」无红星', st.labels.some((l) => l.text.includes('备注') && !l.required));
  check('点【保存】', (await clickBtn('保存')) === 'OK');
  await sleep(1200);
  st = await dialogState();
  console.log('  报错:', st.errors.join(' | ') || '(无)');
  check('出现必填提示', st.errors.length > 0, `${st.errors.length} 条`);
  check('提示含「家庭住址」', st.errors.some((e) => e.includes('家庭住址')));
  check('提示含「家长手机」', st.errors.some((e) => e.includes('家长手机')));
  check('无未捕获异常', pageErrors.length === 0, pageErrors[0] || '');
  await shot('req_student_empty_save.png');

  /* ---------- ④ 编辑班级：必填项与新增同步 ---------- */
  console.log('\n=== ④ 编辑班级：必填项与新增同步 ===');
  await nav('/teaching/class', 3500);
  await sleep(800);
  check('打开【编辑班级】', (await clickRowEdit()) === 'OK');
  await sleep(1600);
  st = await dialogState();
  console.log('  字段:', st.labels.map((l) => l.text + (l.required ? '*' : '')).join(' / '));
  check('编辑：班级名称有红星', st.labels.some((l) => l.text.includes('班级名称') && l.required));
  check('编辑：部门有红星', st.labels.some((l) => l.text.includes('部门') && l.required));
  check('编辑：阶段方案有红星', st.labels.some((l) => l.text.includes('阶段方案') && l.required));
  check('编辑：班级编号无红星（只读，改不了）',
    st.labels.some((l) => l.text.includes('班级编号') && !l.required));
  check('清空「班级名称」', (await clearByLabel('班级名称')) === 'OK');
  check('点【保存】(编辑班级)', (await clickBtn('保存')) === 'OK');
  await sleep(1300);
  st = await dialogState();
  console.log('  报错:', st.errors.join(' | ') || '(无)');
  check('编辑班级：保存时同样拦必填', st.errors.some((e) => e.includes('班级名称')), st.errors.join('|'));
  await shot('req_class_edit_required.png');
  await clickBtn('取消');
  await sleep(700);

  /* ---------- ⑤ 编辑学生：必填项与新增同步 ---------- */
  console.log('\n=== ⑤ 编辑学生：必填项与新增同步 ===');
  await nav('/teaching/student', 3500);
  await sleep(800);
  check('打开【编辑学生】', (await clickRowEdit()) === 'OK');
  await sleep(1600);
  st = await dialogState();
  console.log('  字段:', st.labels.map((l) => l.text + (l.required ? '*' : '')).join(' / '));
  check('编辑：手机号有红星', st.labels.some((l) => l.text.includes('手机号') && l.required));
  check('编辑：家庭住址有红星', st.labels.some((l) => l.text.includes('家庭住址') && l.required));
  check('编辑：备注无红星', st.labels.some((l) => l.text.includes('备注') && !l.required));
  check('清空「手机号」', (await clearByLabel('手机号')) === 'OK');
  check('点【保存】(编辑学生)', (await clickBtn('保存')) === 'OK');
  await sleep(1300);
  st = await dialogState();
  console.log('  报错:', st.errors.join(' | ') || '(无)');
  check('编辑学生：保存时同样拦必填',
    st.errors.some((e) => e.includes('手机号')), st.errors.join('|'));
  await shot('req_student_edit_required.png');
  await clickBtn('取消');
  await sleep(600);

  console.log(`\n${fails.length ? 'FAILED: ' + fails.join(' / ') : 'ALL PASS'}`);
  child.kill();
  ws?.close?.();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('脚本异常：', e.message); child.kill(); process.exit(1); });
