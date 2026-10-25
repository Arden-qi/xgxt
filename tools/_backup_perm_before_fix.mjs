/** 备份：角色动作行 + 角色页面台账 + 门户账号（改权限前的安全网） */
import mysql from '../server-job/node_modules/mysql2/promise.js';
import fs from 'node:fs';

const env = fs.readFileSync(new URL('../server-job/.env', import.meta.url), 'utf8');
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim();
const c = await mysql.createConnection({
  host: '127.0.0.1',
  port: Number(get('DB_PORT') || 3306),
  user: get('DB_USER'),
  password: get('DB_PASSWORD'),
});

const stamp = '20261023';
const outDir = new URL('../输出/权限修复备份/', import.meta.url);
fs.mkdirSync(outDir, { recursive: true });

const dump = async (sql, name, cols) => {
  const [rows] = await c.query(sql);
  const lines = [cols.join('\t')];
  for (const r of rows) {
    lines.push(cols.map((k) => (r[k] === null ? '' : String(r[k]).replace(/\t/g, ' '))).join('\t'));
  }
  const p = new URL(`${name}_${stamp}.tsv`, outDir);
  fs.writeFileSync(p, '\uFEFF' + lines.join('\n'), 'utf8');
  console.log(`${name}: ${rows.length} 行 → ${p.pathname}`);
};

await dump(
  `select id,role_id,module_key,item_name,action_code,action_name,base_action from sms_perm.t_perm_role_perm where is_deleted=0`,
  't_perm_role_perm',
  ['id', 'role_id', 'module_key', 'item_name', 'action_code', 'action_name', 'base_action'],
);
await dump(
  `select id,role_id,module_key,page_path,enabled from sms_perm.t_perm_role_page where is_deleted=0`,
  't_perm_role_page',
  ['id', 'role_id', 'module_key', 'page_path', 'enabled'],
);
await dump(
  `select id,account,user_name,title,modules from sms_portal.t_sys_account where is_deleted=0`,
  't_sys_account',
  ['id', 'account', 'user_name', 'title', 'modules'],
);
await c.end();
