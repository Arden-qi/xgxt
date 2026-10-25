/** 查 role_page 台账全量（含时间/操作人） */
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
const [rows] = await c.query(
  `select role_id, module_key, page_path, enabled, create_time, update_time, update_by
     from sms_perm.t_perm_role_page where is_deleted=0 order by role_id, module_key`,
);
console.table(rows);
const [logs] = await c.query(
  `select log_time, operator_name, module_name, action_type, target_obj, after_value
     from sms_perm.t_perm_log where module_name like '%页面%' or target_obj like '%页面%'
     order by log_time desc limit 15`,
);
console.table(logs);
await c.end();
