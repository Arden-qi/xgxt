import mysql from '../server-job/node_modules/mysql2/promise.js';
import fs from 'node:fs';
const env = fs.readFileSync(new URL('../server-job/.env', import.meta.url), 'utf8');
const g = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim();
const db = await mysql.createConnection({ host: '127.0.0.1', port: Number(g('DB_PORT') || 3306), user: g('DB_USER'), password: g('DB_PASSWORD') });
const q = async (s, a = []) => (await db.query(s, a))[0];
const rows = await q(`select u.account, u.user_name, r.role_code, r.role_name
  from sms_perm.t_perm_user u
  join sms_perm.t_perm_user_role ur on ur.user_id=u.id and ur.is_deleted=0
  join sms_perm.t_perm_role r on r.id=ur.role_id and r.is_deleted=0
 where u.is_deleted=0 and r.role_code='SYS_ADMIN'`);
console.log('SYS_ADMIN 持有者:', JSON.stringify(rows));
await db.end();
