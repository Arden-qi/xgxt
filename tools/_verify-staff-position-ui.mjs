/**
 * 回归验证（UI 层）：教学管理 · 岗位选人按「职位 + 部门」过滤（2026-10-23 批注）
 * ============================================================
 * 批注原文：
 *   「将每个人员的选择改成职位：比如班主任姓名，改为班主任，教员姓名改为教员，
 *    同时同步职位列表，根据职位名称+部门进行选择：例如部门我选择初高中部，
 *    班主任选择就只会显示初高部的班主任，例如若没有部门，项目经理，
 *    那就根据项目经理职位名称，同步职位只显示项目经理人员进行的选择」
 *
 * 断言（班级管理 → 新建班级弹窗，全程不改数据）：
 *   · 标签不再带「姓名」：班主任 / 教员 / 助教 / 项目经理 / 就业老师
 *   · 部门 = 初高部 → 班主任下拉只有初高部的人（教学部本部孙敏）
 *   · 部门 = 大学部 → 班主任下拉 = 孙敏 + 张海涛（孙敏在教学部本部，两学段共用）
 *   · 部门 = 大学部 → 教员 = 陈晓峰、助教 = 赵梦雪
 *   · 大学部没有「项目经理」这个职位 → 兜底只按职位列人（孙建龙）
 *   · 部门 = 就业部 → 项目经理 = 孙建龙、就业老师 = 周杰
 *
 * 前置：权限管理里这些账号的职位 / 部门要对得上（见脚本末尾注释）。
 * 用法：node tools/_verify-staff-position-ui.mjs   （前后端需在跑：8004 + 5173）
 * 产物：tools/_out/verify_staff_position_*.png
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUTDIR = path.join(HERE, '_out');
fs.mkdirSync(OUTDIR, { recursive: true });
const PORT = 9371;
const BASE = 'http://localhost:5173';

const BROWSER = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].find((p) => fs.existsSync(p));
if (!BROWSER) { console.log('NO BROWSER'); process.exit(1); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-staff-'));
const child = spawn(BROWSER, ['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port='+PORT,'--user-data-dir='+profile,'--window-size=1680,1050','about:blank'], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, msgId = 0; const pending = new Map(); const pageErrors = [];

async function getTarget(){ for(let i=0;i<40;i++){ try{const r=await fetch(`http://127.0.0.1:${PORT}/json/list`);const l=await r.json();const p=l.find(t=>t.type==='page');if(p?.webSocketDebuggerUrl)return p.webSocketDebuggerUrl;}catch{} await sleep(250);} throw new Error('no target'); }
function send(m,p={}){ return new Promise((res,rej)=>{const i=++msgId;const to=setTimeout(()=>rej(new Error('timeout '+m)),30000);pending.set(i,{res,rej,to});ws.send(JSON.stringify({id:i,method:m,params:p}));}); }
async function ev(e){ const r=await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true}); return r.result?.value; }
async function shot(n){ const r=await send('Page.captureScreenshot',{format:'png'}); fs.writeFileSync(path.join(OUTDIR,n), Buffer.from(r.data,'base64')); }
async function nav(hash,wait=3000){ await send('Page.navigate',{url:`${BASE}/?t=${Date.now()}#${hash}`},30000); await sleep(wait); }
async function clickAt(x,y){
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});
}
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
async function clickBtn(text, rootSel='body'){
  const ok = await ev(`(()=>{
    const root=document.querySelector(${JSON.stringify(rootSel)})||document.body;
    const b=[...root.querySelectorAll('button')].find(x=>x.innerText.trim()===${JSON.stringify(text)} && x.getBoundingClientRect().width>0);
    if(!b)return false; b.click(); return true;
  })()`);
  await sleep(600);
  return ok;
}
/** 打开弹窗里 label=xxx 的下拉，返回选项文本数组（弹窗内表单） */
async function openSelectByLabel(label){
  const rect = await ev(`(()=>{
    const d=[...document.querySelectorAll('.el-dialog')].filter(x=>x.getBoundingClientRect().width>0).pop();
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
async function pickOption(text){
  const ok = await clickVisible('.el-select__popper .el-select-dropdown__item', text);
  await sleep(700);
  return ok;
}
async function closePopper(){ await ev(`(()=>{document.body.click();return true;})()`); await sleep(300); }
/** 弹窗里所有表单项的 label 文本 */
async function dialogLabels(){
  return await ev(`(()=>{
    const d=[...document.querySelectorAll('.el-dialog')].filter(x=>x.getBoundingClientRect().width>0).pop();
    if(!d)return [];
    return [...d.querySelectorAll('.el-form-item__label')].map(x=>x.innerText.trim());
  })()`);
}
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

const fails=[];
const check=(n,ok,d='')=>{ console.log(`  ${ok?'PASS':'FAIL'}  ${n}${d?'  → '+d:''}`); if(!ok)fails.push(n); };
const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

(async()=>{
  ws = new WebSocket(await getTarget());
  await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
  ws.onmessage=(e)=>{ let m; try{m=JSON.parse(e.data);}catch{return;}
    if(m.method==='Runtime.exceptionThrown') pageErrors.push(m.params?.exceptionDetails?.exception?.description||'unknown');
    if(m.id&&pending.has(m.id)){const {res,rej,to}=pending.get(m.id);clearTimeout(to);pending.delete(m.id);m.error?rej(new Error(m.error.message)):res(m.result);} };
  await send('Page.enable'); await send('Runtime.enable');

  check('登录成功（校长 qiansy）', await loginAs('qiansy'));
  await nav('/teaching/class', 4000);

  /* ---------- 打开「新建班级」 ---------- */
  check('能打开新增班级弹窗', await clickBtn('新增班级'));
  await sleep(1200);

  /* ---------- ① 标签不再带「姓名」 ---------- */
  const labels = await dialogLabels();
  console.log(`  表单标签：${JSON.stringify(labels)}`);
  check('标签是【班主任】', labels.includes('班主任'));
  check('标签是【教员】', labels.includes('教员'));
  check('标签是【助教】', labels.includes('助教'));
  check('不再有「班主任姓名 / 教员姓名 / 助教姓名」',
    !labels.some((l) => /(班主任|教员|助教|项目经理|就业老师)姓名/.test(l)), JSON.stringify(labels));

  /* ---------- ② 部门 = 初高部 → 班主任只有初高部的人 ---------- */
  const deptOpts = await openSelectByLabel('部门');
  check('部门下拉能打开', Array.isArray(deptOpts) && deptOpts.length > 0, JSON.stringify(deptOpts));
  await pickOption('初高部');
  await sleep(900);
  const jhHead = await openSelectByLabel('班主任');
  await shot(`verify_staff_position_jh_${Date.now()}.png`);
  await closePopper();
  check('初高部 · 班主任只列初高部的人', eq(jhHead, ['孙敏']), JSON.stringify(jhHead));

  /* ---------- ③ 部门 = 大学部 → 班主任 / 教员 / 助教 ---------- */
  await openSelectByLabel('部门');
  await pickOption('大学部');
  await sleep(900);
  const uniHead = await openSelectByLabel('班主任');
  await closePopper();
  check('大学部 · 班主任 = 孙敏 + 张海涛（教学部本部两学段共用）', eq(uniHead, ['孙敏', '张海涛']), JSON.stringify(uniHead));

  const uniTeacher = await openSelectByLabel('教员');
  await closePopper();
  check('大学部 · 教员只列教员', eq(uniTeacher, ['陈晓峰']), JSON.stringify(uniTeacher));

  const uniAssist = await openSelectByLabel('助教');
  await closePopper();
  check('大学部 · 助教只列助教', eq(uniAssist, ['赵梦雪']), JSON.stringify(uniAssist));

  /* ---------- ④ 大学部没有「项目经理」→ 兜底只按职位 ---------- */
  const uniPm = await openSelectByLabel('项目经理');
  await closePopper();
  check('大学部 · 项目经理按职位兜底列人', eq(uniPm, ['孙建龙']), JSON.stringify(uniPm));

  /* ---------- ⑤ 部门 = 就业部 → 项目经理 / 就业老师 ---------- */
  await openSelectByLabel('部门');
  await pickOption('就业部');
  await sleep(1000);
  const empPm = await openSelectByLabel('项目经理');
  await closePopper();
  check('就业部 · 项目经理 = 孙建龙', eq(empPm, ['孙建龙']), JSON.stringify(empPm));
  const empJob = await openSelectByLabel('就业老师');
  await shot(`verify_staff_position_emp_${Date.now()}.png`);
  await closePopper();
  check('就业部 · 就业老师 = 周杰', eq(empJob, ['周杰']), JSON.stringify(empJob));

  /* ---------- 关掉弹窗，不留数据 ---------- */
  await clickBtn('取消', '.el-dialog');
  await sleep(900);

  /* ---------- ⑥ 交接弹窗同样按职位过滤 ---------- */
  check('能打开【交接】弹窗', await clickVisible('.el-table__row button', '交接'));
  await sleep(1600);
  const hoRect = await ev(`(()=>{
    const d=[...document.querySelectorAll('.el-dialog')].filter(x=>x.getBoundingClientRect().width>0).pop();
    if(!d) return null;
    const tr=[...d.querySelectorAll('.el-table__row')].find(x=>x.innerText.trim().startsWith('班主任'));
    const w=tr?.querySelector('.el-select__wrapper');
    if(!w) return null;
    const b=w.getBoundingClientRect(); return {x:b.left+b.width/2, y:b.top+b.height/2};
  })()`);
  if (!hoRect) {
    check('交接弹窗里能打开「班主任 · 新负责人」下拉', false);
  } else {
    await clickAt(hoRect.x, hoRect.y);
    await sleep(800);
    const hoOpts = await ev(`(()=>{
      const poppers=[...document.querySelectorAll('.el-select__popper')].filter(p=>p.getBoundingClientRect().width>0);
      const panel=poppers[poppers.length-1];
      if(!panel)return [];
      return [...panel.querySelectorAll('.el-select-dropdown__item')].map(x=>x.innerText.trim());
    })()`);
    const known = ['孙敏', '张海涛']; // 系统里职位 = 班主任 的只有这两位
    check('交接 · 班主任下拉只列「班主任」职位的人',
      (hoOpts || []).length > 0 && (hoOpts || []).every((o) => known.includes(o)), JSON.stringify(hoOpts));
    await closePopper();
  }
  await clickBtn('取消', '.el-dialog');
  await sleep(600);

  /* ---------- ⑦ 升实训弹窗：项目经理 / 就业老师 固定按「就业部」过滤 ---------- */
  const trainOpened = await ev(`(()=>{
    const rows=[...document.querySelectorAll('.el-table__row')];
    for(const tr of rows){
      const b=[...tr.querySelectorAll('button')].find(x=>x.innerText.trim()==='升实训');
      if(b){ b.click(); return true; }
    }
    return false;
  })()`);
  await sleep(1600);
  check('能打开【升实训】弹窗', trainOpened === true);
  if (trainOpened) {
    const pm = await openSelectByLabel('项目经理');
    await closePopper();
    check('升实训 · 项目经理 = 孙建龙（就业部）', eq(pm, ['孙建龙']), JSON.stringify(pm));
    const ej = await openSelectByLabel('就业老师');
    await closePopper();
    check('升实训 · 就业老师 = 周杰（就业部）', eq(ej, ['周杰']), JSON.stringify(ej));
    await clickBtn('取消', '.el-dialog');
  }

  check('无未捕获异常', pageErrors.length === 0, pageErrors[0] || '');

  console.log(fails.length ? `\nFAILED: ${fails.join(' / ')}` : '\nALL PASS');
  child.kill();
  process.exitCode = fails.length ? 1 : 0;
})().catch((e)=>{ console.error('脚本异常：', e.message); child.kill(); process.exitCode = 1; });
