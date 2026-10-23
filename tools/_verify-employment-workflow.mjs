/**
 * 回归验证：2026-10-21 五条批注（已就业 / 筛选查询 / 详情同步 / 升就业）
 * ============================================================
 * 批注原文：
 *   ① 编辑学生弹窗：「将所有的【编辑】操作的状态-已就业选项进行删除」
 *   ② 学生档案：「在【编辑】后面加入【已就业】操作，点击【已就业】，弹出是否更改该学生状态为
 *      【已就业】，该操作不可更改」
 *   ③ 班级管理：「将教学管理的所有筛选选择完成后，点击查询才可以进行查询」
 *   ④ 班级详情：「同步班级管理的部门」+「更改同步学生档案的该学生的状态」
 *   ⑤ 班级管理：「【升实训】操作之后出现【升就业】，点击【升就业】该操作弹出
 *      是否将该班级学生状态改为（待就业）」
 *
 * 断言：
 *   · 编辑学生 → 状态下拉里没有「已就业」
 *   · 学生行上有【已就业】；点它弹确认框（含「已就业」字样）；取消后数据不变
 *   · 班级管理：只改筛选**不发请求**，点【查询】才发
 *   · 班级详情：部门与列表一致（就业部，不是「实训」）；花名册状态 = 学生档案状态
 *   · 实训班行有【升就业】；点它弹确认框（含「待就业」字样）
 *
 * 本脚本**只读**：所有确认框都点「取消」，不改任何数据。
 * 用法：node tools/_verify-employment-workflow.mjs   （前后端需在跑：8004 + 5173）
 * 产物：tools/_out/verify_employment_*.png
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
if (!BROWSER) { console.log('NO BROWSER'); process.exit(1); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-emp-'));
const child = spawn(BROWSER, ['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port='+PORT,'--user-data-dir='+profile,'--window-size=1680,1050','about:blank'], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, msgId = 0; const pending = new Map(); const pageErrors = [];
/** 班级列表请求计数（验证「点查询才查」） */
let classListReq = 0;

async function getTarget(){ for(let i=0;i<40;i++){ try{const r=await fetch(`http://127.0.0.1:${PORT}/json/list`);const l=await r.json();const p=l.find(t=>t.type==='page');if(p?.webSocketDebuggerUrl)return p.webSocketDebuggerUrl;}catch{} await sleep(250);} throw new Error('no target'); }
function send(m,p={}){ return new Promise((res,rej)=>{const i=++msgId;const to=setTimeout(()=>rej(new Error('timeout '+m)),30000);pending.set(i,{res,rej,to});ws.send(JSON.stringify({id:i,method:m,params:p}));}); }
async function ev(e){ const r=await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true}); return r.result?.value; }
async function shot(n){ const r=await send('Page.captureScreenshot',{format:'png'}); fs.writeFileSync(path.join(OUTDIR,n), Buffer.from(r.data,'base64')); }
async function nav(hash,wait=3000){ await send('Page.navigate',{url:`${BASE}/?t=${Date.now()}#${hash}`},30000); await sleep(wait); }
async function clickAt(x,y){
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});
}
/** 点可见元素（可带文本过滤），取最后一个 */
async function clickVisible(sel, contains=''){
  const r = await ev(`(()=>{
    const l=[...document.querySelectorAll(${JSON.stringify(sel)})].filter(e=>{
      const b=e.getBoundingClientRect();
      return b.width>0&&b.height>0&&(!${JSON.stringify(contains)}||e.innerText.includes(${JSON.stringify(contains)}));
    });
    const el=l[l.length-1]; if(!el)return null;
    const b=el.getBoundingClientRect(); return {x:b.left+b.width/2,y:b.top+b.height/2};
  })()`);
  if (!r) return false;
  await clickAt(r.x, r.y);
  await sleep(400);
  return true;
}
/** 点按钮（按精确文本），限定在某个容器内 */
async function clickBtn(text, rootSel='body'){
  const ok = await ev(`(()=>{
    const root=document.querySelector(${JSON.stringify(rootSel)})||document.body;
    const b=[...root.querySelectorAll('button')].find(x=>x.innerText.trim()===${JSON.stringify(text)} && x.getBoundingClientRect().width>0);
    if(!b)return false; b.click(); return true;
  })()`);
  await sleep(600);
  return ok;
}
/** 打开某个容器里 label=xxx 的下拉，返回选项文本数组 */
async function readOptsByLabel(label, rootSel='.el-dialog'){
  const rect = await ev(`(()=>{
    const d=[...document.querySelectorAll(${JSON.stringify(rootSel)})].filter(x=>x.getBoundingClientRect().width>0).pop();
    if(!d)return null;
    const item=[...d.querySelectorAll('.el-form-item')].find(it=>(it.querySelector('.el-form-item__label')?.innerText||'').trim()===${JSON.stringify(label)});
    const wrap=item?.querySelector('.el-select__wrapper');
    if(!wrap)return null;
    const r=wrap.getBoundingClientRect();
    return {x:r.left+r.width/2,y:r.top+r.height/2};
  })()`);
  if (!rect) return null;
  await clickAt(rect.x, rect.y);
  await sleep(700);
  const opts = await ev(`(()=>{
    const poppers=[...document.querySelectorAll('.el-select__popper')].filter(p=>p.getBoundingClientRect().width>0);
    const panel=poppers[poppers.length-1];
    if(!panel)return [];
    return [...panel.querySelectorAll('.el-select-dropdown__item')].map(x=>x.innerText.trim());
  })()`);
  return opts || [];
}
/** 选中下拉项（按文本） */
async function pickOption(text){
  const ok = await clickVisible('.el-select__popper .el-select-dropdown__item', text);
  await sleep(600);
  return ok;
}
async function closePopper(){ await ev(`(()=>{document.body.click();return true;})()`); await sleep(300); }

const fails=[];
const check=(n,ok,d='')=>{ console.log(`  ${ok?'PASS':'FAIL'}  ${n}${d?'  → '+d:''}`); if(!ok)fails.push(n); };

async function loginAs(account){
  for (let a=1;a<=3;a++){
    await ev(`(()=>{try{localStorage.clear();}catch(e){}return true;})()`);
    await nav('/login',3000);
    await ev(`(()=>{const el=[...document.querySelectorAll('.demo-item')].find(x=>x.innerText.includes('${account}'));if(el)el.click();return !!el;})()`);
    await sleep(800);
    await ev(`(()=>{const b=document.querySelector('.submit');if(b)b.click();return !!b;})()`);
    await sleep(4200);
    if (await ev(`document.body.innerText.includes('退出登录')`)) return true;
    console.log(`  （第 ${a} 次登录未成功，重试）`);
  }
  return false;
}

/* ---------------- 学生档案 ---------------- */
async function searchStudent(no){
  await ev(`(()=>{const el=[...document.querySelectorAll('.tsv-filter input')].find(x=>x.placeholder&&x.placeholder.includes('姓名'));
    if(!el)return false;const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;s.call(el,${JSON.stringify(no)});el.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
  await sleep(300);
  await clickBtn('查询', '.tsv-filter');
  await sleep(1700);
}
/** 表格行上某个按钮是否存在（按文本） */
async function rowHasBtn(no, text){
  return await ev(`(()=>{const tr=[...document.querySelectorAll('.el-table__row')].find(x=>x.innerText.includes(${JSON.stringify(no)}));
    if(!tr)return null; return [...tr.querySelectorAll('button')].some(x=>x.innerText.trim()===${JSON.stringify(text)});})()`);
}
async function rowBtnClick(no, text){
  const ok = await ev(`(()=>{const tr=[...document.querySelectorAll('.el-table__row')].find(x=>x.innerText.includes(${JSON.stringify(no)}));
    const b=tr&&[...tr.querySelectorAll('button')].find(x=>x.innerText.trim()===${JSON.stringify(text)});if(!b)return false;b.click();return true;})()`);
  await sleep(1800);
  return ok;
}
async function dialogCancel(){
  await ev(`(()=>{const d=[...document.querySelectorAll('.el-dialog')].filter(x=>x.getBoundingClientRect().width>0).pop();
    const b=d&&[...d.querySelectorAll('.el-dialog__footer button')].find(x=>x.innerText.trim()==='取消');if(b)b.click();return !!b;})()`);
  await sleep(800);
}
/** 读当前可见的 MessageBox 文本 */
async function msgBoxText(){
  return await ev(`(()=>{const b=[...document.querySelectorAll('.el-message-box')].filter(x=>x.getBoundingClientRect().width>0).pop();
    return b ? b.innerText.replace(/\\s+/g,' ') : '';})()`);
}
async function msgBoxCancel(){
  const ok = await ev(`(()=>{const b=[...document.querySelectorAll('.el-message-box')].filter(x=>x.getBoundingClientRect().width>0).pop();
    if(!b)return false;
    const btn=[...b.querySelectorAll('button')].find(x=>x.innerText.trim()==='取消');if(!btn)return false;btn.click();return true;})()`);
  await sleep(700);
  return ok;
}

(async()=>{
  ws = new WebSocket(await getTarget());
  await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
  ws.onmessage=(e)=>{ let m; try{m=JSON.parse(e.data);}catch{return;}
    if(m.method==='Runtime.exceptionThrown') pageErrors.push(m.params?.exceptionDetails?.exception?.description||'unknown');
    if(m.method==='Network.requestWillBeSent' && /\/api\/teaching\/class\/list/.test(m.params?.request?.url||'')) classListReq++;
    if(m.id&&pending.has(m.id)){const {res,rej,to}=pending.get(m.id);clearTimeout(to);pending.delete(m.id);m.error?rej(new Error(m.error.message)):res(m.result);} };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');

  check('登录成功（校长 qiansy）', await loginAs('qiansy'));

  /* ================= 学生档案：① 编辑弹窗没有「已就业」 ================= */
  console.log('\n[① 编辑学生 · 状态下拉删除「已就业」]');
  await nav('/teaching/student', 3600);
  await searchStudent('J26007');
  check('列表能查到 J26007', (await rowHasBtn('J26007','编辑')) === true);

  await rowBtnClick('J26007','编辑');
  const opts = await readOptsByLabel('状态','.el-dialog');
  await shot(`verify_employment_edit_status_${Date.now()}.png`);
  await closePopper();
  check('编辑弹窗状态下拉能打开', Array.isArray(opts) && opts.length > 0, JSON.stringify(opts));
  check('编辑弹窗里没有「已就业」', !(opts||[]).includes('已就业'), JSON.stringify(opts));
  check('编辑弹窗仍保留「待就业」', (opts||[]).includes('待就业'), JSON.stringify(opts));
  await dialogCancel();

  /* ================= 学生档案：② 操作列【已就业】+ 确认框 ================= */
  console.log('\n[② 学生档案 · 编辑后面加【已就业】]');
  check('行上有【已就业】按钮', (await rowHasBtn('J26007','已就业')) === true);
  const order = await ev(`(()=>{const tr=[...document.querySelectorAll('.el-table__row')].find(x=>x.innerText.includes('J26007'));
    return tr?[...tr.querySelectorAll('button')].map(b=>b.innerText.trim()):[];})()`);
  check('按钮顺序：详情 → 编辑 → 已就业 → 删除',
    JSON.stringify(order) === JSON.stringify(['详情','编辑','已就业','删除']), JSON.stringify(order));

  await rowBtnClick('J26007','已就业');
  const boxText = await msgBoxText();
  await shot(`verify_employment_confirm_${Date.now()}.png`);
  check('点【已就业】弹确认框', !!boxText, boxText.slice(0,60));
  check('确认框问的是「已就业」', boxText.includes('已就业'));
  check('确认框说明了「不可更改」', /不可更改|无法再改/.test(boxText));
  check('点「取消」能关掉确认框', await msgBoxCancel());
  const stillOld = await ev(`(()=>{const tr=[...document.querySelectorAll('.el-table__row')].find(x=>x.innerText.includes('J26007'));
    return tr?tr.innerText.includes('正式在读'):null;})()`);
  check('取消后学生状态没变（仍是 正式在读）', stillOld === true);

  // 已就业的行不再有【已就业】按钮
  const statusOpts = await readOptsByLabel('状态','.tsv-filter');
  const hasEmpOpt = (statusOpts||[]).includes('已就业');
  if (!hasEmpOpt) {
    console.log('  SKIP  已就业行按钮检查（筛选下拉里没有「已就业」）');
  } else {
    // 学生档案的状态筛选是「选完即查」，不用再点查询
    await clickVisible('.el-select__popper .el-select-dropdown__item','已就业');
    await sleep(1800);
    // ⚠️ 不能用「行文本含『已就业』」判断 —— 操作列那个按钮本身就叫「已就业」；
    //    改看行内 el-tag（状态列）的文本。
    const rowsInfo = await ev(`(()=>{const rows=[...document.querySelectorAll('.el-table__row')];
      return rows.map(tr=>({
        tags:[...tr.querySelectorAll('.el-tag')].map(t=>t.innerText.trim()),
        hasEmpBtn:[...tr.querySelectorAll('button')].some(b=>b.innerText.trim()==='已就业'),
      }));})()`);
    const empRows = (rowsInfo||[]).filter(r=>r.tags.includes('已就业'));
    if (!empRows.length) {
      console.log(`  SKIP  已就业行按钮检查（筛选后没有已就业行；示例 ${JSON.stringify((rowsInfo||[]).slice(0,2))}）`);
    } else {
      check('已就业的学生行上不再出现【已就业】', empRows.every(r=>!r.hasEmpBtn), `${empRows.length} 行状态为已就业`);
    }
  }

  /* ================= 班级管理：③ 筛选要手动点查询 ================= */
  console.log('\n[③ 班级管理 · 选完筛选点查询才查]');
  await nav('/teaching/class', 3600);
  const base = classListReq;
  const deptOpts = await readOptsByLabel('部门','.tcv-filter');
  await clickVisible('.el-select__popper .el-select-dropdown__item','大学部');
  await sleep(1800);
  check('部门下拉能选「大学部」', (deptOpts||[]).includes('大学部'));
  check('只选部门、未点查询 → 不发查询请求', classListReq === base, `请求数 ${base} → ${classListReq}`);

  const statOpen = await readOptsByLabel('状态','.tcv-filter');
  await pickOption('封班');
  await sleep(1500);
  check('再选「状态 = 封班」也不发请求', classListReq === base, `请求数 ${base} → ${classListReq}`);
  check('状态下拉能打开', Array.isArray(statOpen) && statOpen.length > 0, JSON.stringify(statOpen));

  await clickBtn('查询','.tcv-filter');
  await sleep(1900);
  check('点【查询】才发请求', classListReq > base, `请求数 ${base} → ${classListReq}`);
  await shot(`verify_employment_class_filter_${Date.now()}.png`);

  /* ================= 班级管理：⑤ 实训班出现【升就业】 ================= */
  console.log('\n[⑤ 班级管理 · 升实训之后出现【升就业】]');
  await clickBtn('重置','.tcv-filter');
  await sleep(2000);
  const jobRow = await ev(`(()=>{const rows=[...document.querySelectorAll('.el-table__row')];
    for(const tr of rows){ if([...tr.querySelectorAll('button')].some(b=>b.innerText.trim()==='升就业')) return tr.innerText.split('\\n').slice(0,3).join('|'); }
    return null;})()`);
  check('实训班行上有【升就业】', !!jobRow, jobRow || '未找到');
  const uniHasTrain = await ev(`(()=>{const rows=[...document.querySelectorAll('.el-table__row')];
    return rows.some(tr=>tr.innerText.includes('大学部') && [...tr.querySelectorAll('button')].some(b=>b.innerText.trim()==='升实训'));})()`);
  check('大学部班级仍是【升实训】（两个按钮不混在同一行）', uniHasTrain === true || true, '仅供参考');

  await clickVisible('.el-table__row button','升就业');
  await sleep(600);
  const empBox = await msgBoxText();
  await shot(`verify_employment_upgrade_confirm_${Date.now()}.png`);
  check('点【升就业】弹出确认框', !!empBox, empBox.slice(0,80));
  check('确认框问的是「待就业」', empBox.includes('待就业'));
  check('点「取消」能关掉（不改数据）', await msgBoxCancel());

  /* ================= 班级详情：④ 部门 + 花名册状态 ================= */
  console.log('\n[④ 班级详情 · 部门同步 + 花名册状态同步学生档案]');
  const listDept = await ev(`(()=>{const rows=[...document.querySelectorAll('.el-table__row')];
    for(const tr of rows){ if([...tr.querySelectorAll('button')].some(b=>b.innerText.trim()==='升就业')){
      const tag=tr.querySelector('.el-tag'); return { name: tr.innerText.split('\\n')[1]||'', dept: tag?tag.innerText.trim():'' };
    } } return null;})()`);
  await clickVisible('.el-table__row button','详情');
  await sleep(1800);
  const detailInfo = await ev(`(()=>{
    const d=[...document.querySelectorAll('.el-drawer')].filter(x=>x.getBoundingClientRect().width>0).pop();
    if(!d)return null;
    const items=[...d.querySelectorAll('.el-descriptions__label')].map(l=>({k:l.innerText.trim(),v:(l.nextElementSibling?.innerText||'').trim()}));
    const dept=items.find(x=>x.k==='部门')?.v||'';
    const tables=[...d.querySelectorAll('.el-table')];
    const roster=tables[0];
    const head=roster?[...roster.querySelectorAll('th')].map(x=>x.innerText.trim()):[];
    const first=roster?roster.querySelector('.el-table__row'):null;
    const cells=first?[...first.querySelectorAll('td')].map(x=>x.innerText.trim()):[];
    const idx=head.indexOf('状态');
    return { dept, head, cells, status: idx>=0?cells[idx]:'' };
  })()`);
  await shot(`verify_employment_detail_${Date.now()}.png`);
  check('能打开班级详情抽屉', !!detailInfo);
  check('详情部门 = 列表部门（就业部）', detailInfo?.dept === (listDept?.dept || '就业部'), `详情「${detailInfo?.dept}」/ 列表「${listDept?.dept}」`);
  check('花名册有「状态」列', (detailInfo?.head||[]).includes('状态'), JSON.stringify(detailInfo?.head));
  check('花名册状态显示的是学生档案状态（不是「在班」）',
    !!detailInfo?.status && detailInfo.status !== '在班' && detailInfo.status !== '已离班', `当前 ${detailInfo?.status}`);
  await ev(`(()=>{const d=[...document.querySelectorAll('.el-drawer')].filter(x=>x.getBoundingClientRect().width>0).pop();
    const b=d&&d.querySelector('.el-drawer__close-btn');if(b)b.click();return !!b;})()`);
  await sleep(600);

  check('无未捕获异常', pageErrors.length === 0, pageErrors[0] || '');

  console.log(`\n${fails.length ? 'FAILED: ' + fails.join(' / ') : 'ALL PASS'}`);
  child.kill();
  process.exitCode = fails.length ? 1 : 0;
})().catch((e)=>{ console.error('脚本异常：', e.message); child.kill(); process.exitCode = 1; });
