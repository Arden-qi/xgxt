import mysql from '../server-job/node_modules/mysql2/promise.js';
import fs from 'node:fs';
const env = fs.readFileSync(new URL('../server-job/.env', import.meta.url), 'utf8');
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim();
const c = await mysql.createConnection({host:'127.0.0.1',port:Number(get('DB_PORT')||3306),user:get('DB_USER'),password:get('DB_PASSWORD')});
const [r] = await c.query('select account,user_name,password,kind,title from sms_portal.t_sys_account where is_deleted=0');
console.log(r.map(x=>`${x.account}\t${x.user_name}\t${x.password}\t${x.kind}\t${x.title}`).join('\n'));
await c.end();
