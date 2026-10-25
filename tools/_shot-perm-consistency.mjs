/**
 * 取证截图：咨询经理的财务权限 & 身份头衔 & 左侧板块，五屏对齐
 *
 * 1) 王寒逸登录 → 工作台（头衔=咨询经理、左侧无「权限管理 / 财务管理」）
 * 2) 林晓 → 账号管理 → 王寒逸「查看」（有效权限里没有财务管理、35 项）
 * 3) 林晓 → 职位权限分配 → 咨询经理（只有工作台 / 市场咨询）
 * 4) 林晓 → 页面管理（职位模式）→ 咨询经理（财务管理 0/6）
 * 5) 林晓自己登录 → 工作台（权限管理员只见 工作台 + 权限管理，★ 2026-10-24 用户拍板）
 *
 * 用法：node tools/_shot-perm-consistency.mjs   （8004 + 5173 需在跑）
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUTDIR = path.join(ROOT, '输出', '权限修复取证');
fs.mkdirSync(OUTDIR, { recursive: true });
const PORT = 9341;
const BASE = 'http://localhost:5173';

const BROWSER = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].find((p) => fs.existsSync(p));
if (!BROWSER) { console.log('NO BROWSER'); process.exit(1); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-cons-'));
const child = spawn(BROWSER, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
  '--window-size=1520,1060', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws; let msgId = 0; const pending = new Map();

async function getTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
      const page = list.find((t) => t.type === 'page');
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
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r.result?.value;
}
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUTDIR, name), Buffer.from(r.data, 'base64'));
  console.log('  shot: ' + name);
}
async function nav(hash, wait = 2600) {
  await send('Page.navigate', { url: `${BASE}/?t=${Date.now()}#${hash}` });
  await sleep(wait);
}
const PWD = { wanghanyi: 'Wanghanyi123', qitiantian: 'Qtt123456', chenxf: 'qtt123456' };
const ACCT_NAME = { wanghanyi: '王寒逸' };

async function loginAs(account) {
  await ev(`(() => { try { localStorage.clear(); } catch(e){} return true; })()`);
  await nav('/login', 2200);

  // 演示账号里有就点它（快），没有就直接填表单
  const hit = await ev(`(() => {
    const items = [...document.querySelectorAll('.demo-item')];
    const el = items.find(x => x.innerText.includes('${ACCT_NAME[account] || account}'));
    if (el) { el.click(); return true; } return false;
  })()`);
  if (!hit) {
    await ev(`(() => {
      const set = (el, v) => {
        const d = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
        d.set.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const inputs = [...document.querySelectorAll('input')].filter(i => i.type !== 'checkbox');
      if (inputs[0]) set(inputs[0], ${JSON.stringify(account)});
      if (inputs[1]) set(inputs[1], ${JSON.stringify(PWD[account] || '123456')});
      return inputs.length;
    })()`);
    await sleep(400);
  }
  await ev(`(() => { const b = document.querySelector('.submit') || [...document.querySelectorAll('button')].find(x => (x.innerText||'').trim() === '登录'); if (b) b.click(); return !!b; })()`);
  await sleep(3600);
  const ok = await ev(`(() => !location.hash.includes('/login'))()`);
  console.log('  登录' + (ok ? '成功' : '失败'));
}
/** 点击「文字正好等于 / 包含」的最小可见元素 */
const clickText = (text, exact = true, wait = 1200) => ev(`(async () => {
  const ok = (el) => {
    if (!el || el.offsetParent === null) return false;
    const t = (el.innerText || '').trim();
    return ${exact} ? t === ${JSON.stringify(text)} : t.includes(${JSON.stringify(text)});
  };
  const all = [...document.querySelectorAll('button, a, .role-item, .item, li, span, div')];
  const hits = all.filter(ok);
  if (!hits.length) return false;
  hits.sort((a, b) => (a.innerText || '').length - (b.innerText || '').length);
  hits[0].click();
  await new Promise(r => setTimeout(r, ${wait}));
  return (hits[0].innerText || '').slice(0, 40);
})()`);

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
  await send('Page.enable');
  await send('Runtime.enable');

  /* 1. 王寒逸 → 工作台 */
  console.log('① 王寒逸 工作台');
  await loginAs('wanghanyi');
  await nav('/', 2600);
  console.log(
    '  头衔：',
    await ev(`(() => {
      const t = document.body.innerText;
      const m = t.match(/欢迎回来[，,]\\s*\\S+\\s*(\\S+)/);
      return m ? m[1] : '(未识别)';
    })()`),
  );
  console.log(
    '  左侧菜单：',
    await ev(`(() => [...document.querySelectorAll('.el-menu .el-sub-menu__title, .el-menu > li')]
      .map(e => (e.innerText || '').trim().split('\\n')[0]).filter(Boolean).slice(0, 12).join(' | '))()`),
  );
  await shot('1-王寒逸-工作台.png');

  /* 2. 林晓 → 账号管理 → 王寒逸详情 */
  console.log('② 账号详情');
  await loginAs('linx');
  await nav('/perm/user', 3000);
  await clickText('王寒逸', false, 600);
  await sleep(400);
  await clickText('查看', true, 2200);
  await shot('2-账号详情-王寒逸.png');
  /* ⚠️ 2026-10-24 起：页面管理给咨询经理勾了财务两页 → 联动自动补「查看」动作行，
   *   账号详情里出现「财务管理」是【正确】的；要警惕的是出现未授权页面的动作。 */
  console.log(
    '  弹窗内财务管理明细（应为：财务概览/缴费管理 仅查看）：',
    await ev(`(() => {
      const cands = [...document.querySelectorAll('body *')].filter((e) => {
        const t = e.innerText || '';
        return t.includes('账号详情') && t.includes('有效权限');
      });
      if (!cands.length) return '(弹窗未打开)';
      const dlg = cands.sort((a, b) => (a.innerText || '').length - (b.innerText || '').length)[0];
      const seg = (dlg.innerText || '').split('财务管理')[1] || '';
      return (seg.slice(0, 60).replace(/\\n+/g, '/')) || '（无财务管理卡片）';
    })()`),
  );

  /* 3. 职位权限分配 → 咨询经理 */
  console.log('③ 职位权限分配');
  await nav('/perm/assign', 3200);
  await clickText('咨询经理', false, 2400);
  await shot('3-职位权限分配-咨询经理.png');

  /* 4. 页面管理 → 咨询经理 */
  console.log('④ 页面管理');
  await nav('/perm/page', 3200);
  await clickText('咨询经理', false, 2600);
  await shot('4-页面管理-咨询经理.png');

  /* 5. ★ 2026-10-24 用户拍板：权限管理员的边界 = 账号级 modules（["perm"]）——
   *    林晓登录后左侧必须只有「工作台 + 权限管理」，
   *    my-paths 也只下发 /perm/*（两侧同源，见 myPaths.route.ts 的 SYS_ADMIN 分支）。 */
  console.log('⑤ 林晓(权限管理员) 工作台');
  await loginAs('linx');
  await nav('/', 2600);
  console.log(
    '  左侧菜单：',
    await ev(`(() => [...document.querySelectorAll('.el-menu .el-sub-menu__title, .el-menu > li')]
      .map(e => (e.innerText || '').trim().split('\\n')[0]).filter(Boolean).slice(0, 12).join(' | '))()`),
  );
  await shot('5-林晓-工作台.png');

  ws.close();
  child.kill();
  console.log('\n完成，输出目录：' + OUTDIR);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  child.kill();
  process.exit(1);
});
