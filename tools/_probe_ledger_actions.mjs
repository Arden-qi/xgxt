import mysql from '../server-job/node_modules/mysql2/promise.js';
import fs from 'node:fs';
const env = fs.readFileSync(new URL('../server-job/.env', import.meta.url), 'utf8');
const g = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim();
const db = await mysql.createConnection({ host: '127.0.0.1', port: Number(g('DB_PORT') || 3306), user: g('DB_USER'), password: g('DB_PASSWORD') });
const q = async (s, a = []) => (await db.query(s, a))[0];

const ledger = await q(`select l.role_id, r.role_name, l.module_key, l.page_path, l.enabled
  from sms_perm.t_perm_role_page l join sms_perm.t_perm_role r on r.id=l.role_id where l.is_deleted=0`);
const actions = await q(`select role_id, module_key, item_name, action_code from sms_perm.t_perm_role_perm where is_deleted=0`);
const pageRows = await q(`select module_key, page_title, page_path from sms_perm.t_perm_page where is_deleted=0`);
/* path → 页面名（item_name 存的是页面名） */
const titleByPath = new Map(pageRows.map((p) => [`${p.module_key}||${p.page_path}`, p.page_title]));

const roles = await q(`select id, role_name from sms_perm.t_perm_role where is_deleted=0`);
let gaps = 0;
for (const r of roles) {
  const enabled = ledger.filter((l) => l.role_id === r.id && l.enabled);
  const pageSet = new Set(actions.filter((a) => a.role_id === r.id).map((a) => `${a.module_key}||${a.item_name}`));
  const missing = enabled.filter((l) => !pageSet.has(`${l.module_key}||${titleByPath.get(`${l.module_key}||${l.page_path}`) || l.page_path}`));
  if (missing.length) { gaps += missing.length; console.log(`✘ ${r.role_name}(${r.id}) 台账启用但无动作：${missing.map((m) => m.module_key + '/' + m.page_path).join('、')}`); }
}
console.log(gaps ? `共 ${gaps} 个缺口` : '✔ 全部职位的「台账启用页面」都有动作行（联动完整）');
await db.end();
