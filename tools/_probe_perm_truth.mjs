/**
 * 体检：咨询经理（R02）在四处的口径是否一致
 */
import mysql from '../server-job/node_modules/mysql2/promise.js';
import fs from 'node:fs';

const env = fs.readFileSync(new URL('../server-job/.env', import.meta.url), 'utf8');
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim();

const conn = await mysql.createConnection({
  host: get('DB_HOST') || '127.0.0.1',
  port: Number(get('DB_PORT') || 3306),
  user: get('DB_USER'),
  password: get('DB_PASSWORD'),
  multipleStatements: true,
});
const q = async (sql, args = []) => (await conn.query(sql, args))[0];

const roles = await q(
  `select id, role_name, role_code, perm_count from sms_perm.t_perm_role where is_deleted=0 order by sort_no`,
);
console.log('\n== 职位列表 ==');
roles.forEach((r) => console.log(`${r.id}\t${r.role_name}\t${r.role_code}\tperm_count=${r.perm_count}`));

console.log('\n== 每个职位：角色动作按板块统计 ==');
const byMod = await q(
  `select role_id, module_key, count(*) n, count(distinct item_name) items
     from sms_perm.t_perm_role_perm where is_deleted=0
    group by role_id, module_key order by role_id, module_key`,
);
const grouped = {};
byMod.forEach((r) => {
  grouped[r.role_id] = grouped[r.role_id] || [];
  grouped[r.role_id].push(`${r.module_key}:${r.n}(${r.items}页)`);
});
Object.keys(grouped).forEach((k) => console.log(`${k}\t${grouped[k].join('  ')}`));

console.log('\n== R02 咨询经理 finance 明细 ==');
const fin = await q(
  `select module_key, item_name, action_code from sms_perm.t_perm_role_perm
    where role_id='R02' and module_key='finance' and is_deleted=0`,
);
console.log(fin);

console.log('\n== 全部职位在 finance 的动作数 ==');
const finAll = await q(
  `select role_id, count(*) n, group_concat(distinct item_name) items from sms_perm.t_perm_role_perm
    where module_key='finance' and is_deleted=0 group by role_id`,
);
console.log(finAll);

console.log('\n== t_perm_role_page 全量 ==');
const pages = await q(
  `select role_id, module_key, page_path, enabled from sms_perm.t_perm_role_page
    where is_deleted=0 order by role_id, module_key, page_path`,
);
pages.forEach((r) => console.log(`${r.role_id}\t${r.module_key}\t${r.page_path}\t${r.enabled}`));

console.log('\n== 账号 ==');
const accs = await q(
  `select account, user_name, kind, title, dept, modules from sms_portal.t_sys_account where is_deleted=0 order by user_name`,
);
accs.forEach((a) =>
  console.log(`${a.account}\t${a.user_name}\tkind=${a.kind}\ttitle=${a.title}\tdept=${a.dept}\tmodules=${a.modules}`),
);

console.log('\n== 权限用户 ↔ 职位 ==');
const users = await q(
  `select u.id, u.account, u.user_name, group_concat(r.role_name) roles, group_concat(r.role_code) codes
     from sms_perm.t_perm_user u
     left join sms_perm.t_perm_user_role ur on ur.user_id=u.id and ur.is_deleted=0
     left join sms_perm.t_perm_role r on r.id=ur.role_id and r.is_deleted=0
    where u.is_deleted=0 group by u.id order by u.account`,
);
users.forEach((u) => console.log(`${u.id}\t${u.account}\t${u.user_name}\t${u.roles || '(无)'}\t${u.codes || ''}`));

await conn.end();
