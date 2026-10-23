/**
 * 回归验证：班级管理「状态」筛选下拉（2026-10-21 批注 · 第二批）
 * ============================================================
 * 批注原文：在班级管理的状态下拉里，把「已结业」这个选项删掉（红框标出 + “删除这个选择”）。
 *
 * 断言：
 *   · 状态下拉能打开，选项里**没有「已结业」**
 *   · 保留 开放 / 封班 / 实训 / 待就业 / 已就业
 *   · 列表「状态」列对已有班级照常渲染（不因删选项而白屏）
 *
 * 本脚本只读，不改任何数据。
 * 用法：node tools/_verify-class-status-filter.mjs   （前后端需在跑：8004 + 5173）
 * 产物：tools/_out/verify_class_status_filter_*.png
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

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-classstatus-'));
const child = spawn(BROWSER, ['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port='+PORT,'--user-data-dir='+profile,'--window-size=1680,1050','about:blank'], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, msgId = 0; const pending = new Map(); const pageErrors = [];
async function getTarget(){ for(let i=0;i<40;i++){ try{const r=await fetch(`http://127.0.0.1:${PORT}/json/list`);const l=await r.json();const p=l.find(t=>t.type==='page');if(p?.webSocketDebuggerUrl)return p.webSocketDebuggerUrl;}catch{} await sleep(250);} throw new Error('no target'); }
function send(m,p={}){ return new Promise((res,rej)=>{const i=++msgId;const to=setTimeout(()=>rej(new Error('timeout '+m)),30000);pending.set(i,{res,rej,to});ws.send(JSON.stringify({id:i,method:m,params:p}));}); }
async function ev(e){ const r=await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true}); return r.result?.value; }
async function shot(n){ const r=await send('Page.captureScreenshot',{format:'png'}); fs.writeFileSync(path.join(OUTDIR,n), Buffer.from(r.data,'base64')); }
async function nav(hash,wait=2800){ await send('Page.navigate',{url:`${BASE}/?t=${Date.now()}#${hash}`},30000); await sleep(wait); }
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
async function clickAt(x,y){
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});
}
/** 打开筛选行里 label=状态 的下拉，返回选项文本数组 */
async function readFilterStatusOptions(){
  const rect = await ev(`(()=>{
    const items=[...document.querySelectorAll('.tcv-filter .el-form-item')].filter(x=>x.offsetParent!==null);
    const item=items.find(it=>(it.querySelector('.el-form-item__label')?.innerText||'').trim()==='状态');
    const wrap=item?.querySelector('.el-select__wrapper');
    if(!wrap)return null;
    const r=wrap.getBoundingClientRect();
    return {x:r.left+r.width/2,y:r.top+r.height/2};
  })()`);
  if (!rect) return null;
  await clickAt(rect.x, rect.y);
  await sleep(800);
  const opts = await ev(`(()=>{
    const poppers=[...document.querySelectorAll('.el-select__popper')].filter(p=>p.getBoundingClientRect().width>0);
    const panel=poppers[poppers.length-1];
    if(!panel)return [];
    return [...panel.querySelectorAll('.el-select-dropdown__item')].map(x=>x.innerText.trim());
  })()`);
  await shot(`verify_class_status_filter_${Date.now()}.png`);
  await ev(`(()=>{document.body.click();return true;})()`);
  await sleep(300);
  return opts || [];
}
const fails=[];
const check=(n,ok,d='')=>{ console.log(`  ${ok?'PASS':'FAIL'}  ${n}${d?'  → '+d:''}`); if(!ok)fails.push(n); };

(async()=>{
  ws = new WebSocket(await getTarget());
  await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
  ws.onmessage=(e)=>{ let m; try{m=JSON.parse(e.data);}catch{return;}
    if(m.method==='Runtime.exceptionThrown') pageErrors.push(m.params?.exceptionDetails?.exception?.description||'unknown');
    if(m.id&&pending.has(m.id)){const {res,rej,to}=pending.get(m.id);clearTimeout(to);pending.delete(m.id);m.error?rej(new Error(m.error.message)):res(m.result);} };
  await send('Page.enable'); await send('Runtime.enable');

  check('登录成功（校长 qiansy）', await loginAs('qiansy'));
  await nav('/teaching/class', 3600);

  const head = await ev(`(()=>{const h=document.querySelector('.tcv-filter');return h?h.innerText.replace(/\\s+/g,' ').trim():'';})()`);
  check('班级管理筛选行已渲染', !!head, head);

  const opts = await readFilterStatusOptions();
  check('状态下拉能打开且有选项', Array.isArray(opts) && opts.length > 0, JSON.stringify(opts));
  check('★ 没有「已结业」选项（本次批注）', !(opts || []).includes('已结业'), JSON.stringify(opts));
  check('保留 开放/封班/实训/待就业/已就业',
    ['开放','封班','实训','待就业','已就业'].every((x)=>(opts||[]).includes(x)), JSON.stringify(opts));
  check('选项数正好 5 个', (opts||[]).length === 5, String((opts||[]).length));

  // 列表状态列照常渲染
  const rows = await ev(`(()=>{const r=[...document.querySelectorAll('.el-table__row')];
    return r.slice(0,5).map(tr=>tr.innerText.replace(/\\s+/g,' ').trim());})()`);
  check('列表有数据行且状态列可见', Array.isArray(rows) && rows.length > 0, JSON.stringify(rows.slice(0,2)));

  check('无未捕获异常', pageErrors.length === 0, pageErrors[0] || '');

  console.log(`\n${fails.length ? 'FAILED: ' + fails.join(' / ') : 'ALL PASS'}`);
  child.kill();
  process.exitCode = fails.length ? 1 : 0;
})().catch((e)=>{ console.error('脚本异常：', e.message); child.kill(); process.exitCode = 1; });
