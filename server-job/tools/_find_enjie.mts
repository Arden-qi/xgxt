/* 找「恩杰」：portal 登录名 + 持 JOB_STAFF 职位的后台账号 */
import mysql from 'mysql2/promise';
const conn = await mysql.createConnection({ host: '127.0.0.1', port: 3306, user: 'root', password: 'xueguan123' });

const [portal] = await conn.query(
  `SELECT * FROM sms_portal.t_sys_account LIMIT 1`);
console.log('portal 列:', Object.keys(portal[0] || {}).join(', '));
const [en] = await conn.query(
  `SELECT id, account, user_name, title, modules, active FROM sms_portal.t_sys_account
    WHERE account LIKE '%恩%' OR user_name LIKE '%恩%'`);
console.log('portal 恩杰:', JSON.stringify(en));
const [all] = await conn.query(
  `SELECT account, user_name, title, modules, active FROM sms_portal.t_sys_account WHERE is_deleted = 0`);
for (const r of all as any[]) console.log(`${r.account} | ${r.user_name} | ${r.title} | modules=${r.modules} | active=${r.active}`);

const [job] = await conn.query(
  `SELECT u.user_name, u.account, u.user_status, r.role_code, r.role_name
     FROM sms_perm.t_perm_user u
     JOIN sms_perm.t_perm_user_role ur ON ur.user_id = u.id AND ur.is_deleted = 0
     JOIN sms_perm.t_perm_role r ON r.id = ur.role_id
    WHERE r.role_code = 'JOB_STAFF'`);
console.log('JOB_STAFF 持有者:', JSON.stringify(job));

await conn.end();
