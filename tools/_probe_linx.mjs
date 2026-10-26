import mysql from '../server-job/node_modules/mysql2/promise.js';
import fs from 'node:fs';
const BASE='http://127.0.0.1:8004';
const env=fs.readFileSync(new URL('../server-job/.env',import.meta.url),'utf8');
const getEnv=(k)=>(env.match(new RegExp(`^${k}=(.*)$`,'m'))||[])[1]?.trim();
const db=await mysql.createConnection({host:'127.0.0.1',port:Number(getEnv('DB_PORT')||3306),user:getEnv('DB_USER'),password:getEnv('DB_PASSWORD')});
const q=async(s,a=[])=>(await db.query(s,a))[0];
const acc=await q(`select account,user_name,title,kind,modules from sms_portal.t_sys_account where account='linx'`);
console.log('account:',JSON.stringify(acc));
const roles=await q(`select r.id,r.role_code,r.role_name from sms_perm.t_perm_user u join sms_perm.t_perm_user_role ur on ur.user_id=u.id and ur.is_deleted=0 join sms_perm.t_perm_role r on r.id=ur.role_id and r.is_deleted=0 where u.account='linx' and u.is_deleted=0`);
console.log('roles:',JSON.stringify(roles));
const lg=await fetch(`${BASE}/api/portal/account/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({account:'linx',password:'123456'})});
const lj=await lg.json();
console.log('login ok?',!!lj.data, lj.message||'');
if(lj.data){
  console.log('title:',lj.data.account?.title,'visible:',(lj.data.visibleModules||[]).map(m=>m.key));
  const pr=await fetch(`${BASE}/api/perm/page/my-paths`,{headers:{Authorization:`Bearer ${lj.data.token}`}});
  const pj=await pr.json();
  console.log('my-paths:',JSON.stringify(pj.data?.paths));
}
await db.end();
