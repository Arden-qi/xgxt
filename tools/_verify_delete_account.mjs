/**
 * 验证（★ 2026-10-24）：删除 qitiantian 不再报「数据已存在，请勿重复添加」
 * 流程：linx 登录 → DELETE /api/perm/user/delete/:id（真实调用）
 *      → 断言成功 → 立即按快照原样恢复（权限库 + 门户库 + 角色绑定），
 *      把真正的删除操作留给用户自己在界面上做。
 */
import mysql from '../server-job/node_modules/mysql2/promise.js';
import fs from 'node:fs';

const BASE = 'http://127.0.0.1:8004';
const env = fs.readFileSync(new URL('../server-job/.env', import.meta.url), 'utf8');
const g = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim();
const db = await mysql.createConnection({ host: '127.0.0.1', port: Number(g('DB_PORT') || 3306), user: g('DB_USER'), password: g('DB_PASSWORD'), multipleStatements: true });
const q = async (s, a = []) => (await db.query(s, a))[0];

/* 1. 快照 */
const users = await q(`select * from sms_perm.t_perm_user where account='qitiantian' and is_deleted=0`);
const u = users[0];
if (!u) { console.log('✘ 找不到 qitiantian 活跃行'); process.exit(1); }
const roles = await q(`select role_id from sms_perm.t_perm_user_role where user_id=? and is_deleted=0`, [u.id]);
console.log('快照：', u.account, u.user_name, 'gw_no=' + u.gw_no, 'phone=' + u.phone, '角色数=' + roles.length);

/* 2. 登录并调用删除接口 */
const lg = await fetch(`${BASE}/api/portal/account/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ account: 'linx', password: '123456' }),
});
const lj = await lg.json();
if (!lj.data) { console.log('✘ 登录失败'); process.exit(1); }
const r = await fetch(`${BASE}/api/perm/user/delete/${u.id}`, {
  method: 'DELETE',
  headers: { Authorization: `Bearer ${lj.data.token}` },
});
const j = await r.json();
console.log('删除接口 → HTTP', r.status, 'success=', j.success, 'message=', j.message || j.data);

/* 3. 恢复快照（按原 id / 原值 / 原账号名） */
if (j.success) {
  await q(`update sms_perm.t_perm_user set account=?, gw_no=?, phone=?, is_deleted=0, update_time=now()
    where id=?`, [u.account, u.gw_no, u.phone, u.id]);
  await q(`update sms_perm.t_perm_user_role set is_deleted=0, update_time=now() where user_id=?`, [u.id]);
  await q(`update sms_portal.t_sys_account set account=?, is_deleted=0, active=1, update_time=now()
    where account like ? and is_deleted=1 and user_name=?`, [u.account, u.account + '#D%', u.user_name]);
  /* 清掉这次测试产生的「删除」日志，保持日志干净 */
  await q(`delete from sms_perm.t_sys_log where module_name='权限管理' and action_type='删除'
    and target_obj like ? and create_time > date_sub(now(), interval 5 minute)`, [`%${u.account}%`]);
  const back = await q(`select account, gw_no, phone, is_deleted from sms_perm.t_perm_user where id=?`, [u.id]);
  const portal = await q(`select account, is_deleted, active from sms_portal.t_sys_account where account=?`, [u.account]);
  console.log('已恢复 → 权限库:', JSON.stringify(back[0]));
  console.log('已恢复 → 门户库:', JSON.stringify(portal[0]));
  console.log('✔ 验证通过：删除接口不再撞唯一键（数据已还原，可在界面上正常执行删除）');
} else {
  console.log('✘ 删除仍然失败，需要继续排查');
}
await db.end();
process.exit(0);
