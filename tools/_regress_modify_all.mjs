/**
 * 全系统「修改类」操作回归（★ 2026-10-24 用户要求顺一遍）
 * 覆盖：改职位(周铭 gender=0)/编辑账号/职位权限分配/页面管理(职位)/职位管理(改+状态)/
 *       部门管理/账号停用启用/重置密码/演示账号接口
 * 每项：真实调用 → 断言 success → 数据回滚到测试前。
 */
import mysql from '../server-job/node_modules/mysql2/promise.js';
import fs from 'node:fs';

const BASE = 'http://127.0.0.1:8004';
const env = fs.readFileSync(new URL('../server-job/.env', import.meta.url), 'utf8');
const g = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim();
const db = await mysql.createConnection({ host: '127.0.0.1', port: Number(g('DB_PORT') || 3306), user: g('DB_USER'), password: g('DB_PASSWORD') });
const q = async (s, a = []) => (await db.query(s, a))[0];

const lg = await fetch(`${BASE}/api/portal/account/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ account: 'linx', password: '123456' }),
});
const lj = await lg.json();
if (!lj.data) { console.log('✘ linx 登录失败'); process.exit(1); }
const H = { Authorization: `Bearer ${lj.data.token}`, 'Content-Type': 'application/json' };
const call = async (method, url, body) => {
  const r = await fetch(BASE + url, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j, ok: r.status >= 200 && r.status < 300 && (j ? j.code === undefined || j.code === 0 || j.code === 200 : false) };
};
let pass = 0; let fail = 0;
function report(name, ok, extra = '') {
  if (ok) { pass++; console.log(`✔ ${name}${extra ? '  ' + extra : ''}`); }
  else { fail++; console.log(`✘ ${name}${extra ? '  ' + extra : ''}`); }
}

/* ---------- 基础数据 ---------- */
const zm = (await q(`select * from sms_perm.t_perm_user where account='zhoum' and is_deleted=0`))[0];
const rmProject = (await q(`select id,role_name,dept_id from sms_perm.t_perm_role where role_code='RM_PROJECT' and is_deleted=0`))[0];
const finStaff = (await q(`select id from sms_perm.t_perm_role where role_code='FIN_STAFF' and is_deleted=0`))[0];
const sxDept = (await q(`select id from sms_perm.t_perm_dept where dept_name like '%实训管理%' and is_deleted=0`))[0];
const finDept = (await q(`select id,dept_name,parent_id,remark from sms_perm.t_perm_dept where dept_name='财务管理部' and is_deleted=0`))[0];
const r01 = (await q(`select * from sms_perm.t_perm_role where id='R01' and is_deleted=0`))[0];
if (!zm || !rmProject || !finStaff) { console.log('✘ 基础数据缺失', !!zm, !!rmProject, !!finStaff); process.exit(1); }
const zmRolesBefore = (await q(`select role_id from sms_perm.t_perm_user_role where user_id=? and is_deleted=0`, [zm.id])).map((x) => x.role_id);

/* ---------- ① 演示账号实时信息 ---------- */
{
  const { ok, j } = await call('GET', '/api/portal/account/demo');
  const sm = (j?.data || []).find((x) => x.account === 'sunmin');
  const zmo = (j?.data || []).find((x) => x.account === 'zhoum');
  report('① 登录页演示账号接口', ok && sm?.title === '项目经理' && !!zmo?.title,
    `孙敏=${sm?.title} 周铭=${zmo?.title}`);
}

/* ---------- ② 周铭改职位（gender=0 不再被卡） ---------- */
{
  const body = {
    id: zm.id, userName: zm.user_name, account: zm.account, phone: zm.phone,
    gender: zm.gender, age: zm.age,
    deptId: sxDept?.id || zm.dept_id,
    roleIds: [rmProject.id], userStatus: zm.user_status,
  };
  const { ok, j, status } = await call('PUT', '/api/perm/user/update', body);
  const after = (await q(`select group_concat(r.role_name separator '、') t from sms_perm.t_perm_user_role ur join sms_perm.t_perm_role r on r.id=ur.role_id where ur.user_id=? and ur.is_deleted=0`, [zm.id]))[0]?.t;
  report('② 周铭 改职位→项目经理（gender=0）', ok && after === '项目经理', `HTTP ${status} ${j?.message || ''} 职位=${after}`);
  /* 回滚 */
  await q(`delete from sms_perm.t_perm_user_role where user_id=?`, [zm.id]);
  for (const rid of zmRolesBefore) await q(`insert into sms_perm.t_perm_user_role (id,user_id,role_id,is_deleted,create_time) values (uuid(),?,?,0,now())`, [zm.id, rid]);
  await q(`update sms_perm.t_perm_user set dept_id=? where id=?`, [zm.dept_id, zm.id]);
  await q(`update sms_portal.t_sys_account set title=? where account=? and is_deleted=0`, ['财务', zm.account]);
}

/* ---------- ③ 编辑账号（原样保存，gender=0） ---------- */
{
  const body = {
    id: zm.id, userName: zm.user_name, account: zm.account, phone: zm.phone,
    gender: zm.gender, age: zm.age, deptId: zm.dept_id,
    roleIds: zmRolesBefore, userStatus: zm.user_status,
  };
  const { ok, status, j } = await call('PUT', '/api/perm/user/update', body);
  const back = (await q(`select group_concat(r.role_name separator '、') t from sms_perm.t_perm_user_role ur join sms_perm.t_perm_role r on r.id=ur.role_id where ur.user_id=? and ur.is_deleted=0`, [zm.id]))[0]?.t;
  report('③ 编辑账号 原样保存（gender=0）', ok && back === '财务', `HTTP ${status} ${j?.message || ''} 职位=${back}`);
  await q(`update sms_portal.t_sys_account set title='财务' where account='zhoum' and is_deleted=0`);
}

/* ---------- ④ 职位权限分配（R01 原样重存） ---------- */
{
  const d = await call('GET', '/api/perm/role/detail?id=' + r01.id);
  const perms = d.j?.data?.perms || {};
  const { ok, status, j } = await call('PUT', '/api/perm/assign/save', { roleId: r01.id, perms });
  report('④ 职位权限分配 保存（R01 原样重存）', ok, `HTTP ${status} ${j?.message || ''}`);
}

/* ---------- ⑤ 页面管理（R01 台账原样重存） ---------- */
{
  const rows = await q(`select module_key, page_path, enabled from sms_perm.t_perm_role_page where role_id=? and is_deleted=0`, [r01.id]);
  const items = rows.map((x) => ({ moduleKey: x.module_key, pagePath: x.page_path, enabled: !!x.enabled }));
  const { ok, status, j } = await call('PUT', '/api/perm/page/role-save', { roleId: r01.id, items });
  report('⑤ 页面管理 保存（R01 台账原样重存）', ok, `HTTP ${status} ${j?.message || ''}`);
}

/* ---------- ⑥ 职位管理（R01 改名再改回） ---------- */
{
  const newName = r01.role_name + 'X';
  const a = await call('PUT', '/api/perm/role/update', {
    id: r01.id, roleName: newName, deptId: r01.dept_id, remark: r01.remark || '', roleStatus: r01.role_status,
  });
  const got1 = (await q(`select role_name from sms_perm.t_perm_role where id=?`, [r01.id]))[0]?.role_name;
  const b = await call('PUT', '/api/perm/role/update', {
    id: r01.id, roleName: r01.role_name, deptId: r01.dept_id, remark: r01.remark || '', roleStatus: r01.role_status,
  });
  const got2 = (await q(`select role_name from sms_perm.t_perm_role where id=?`, [r01.id]))[0]?.role_name;
  report('⑥ 职位管理 改名+改回', a.ok && b.ok && got1 === newName && got2 === r01.role_name, `→${got1}→${got2}`);
}

/* ---------- ⑦ 职位启停（R01 停用→启用） ---------- */
{
  const a = await call('PUT', '/api/perm/role/status', { id: r01.id, roleStatus: '停用' });
  const b = await call('PUT', '/api/perm/role/status', { id: r01.id, roleStatus: '启用' });
  const st = (await q(`select role_status from sms_perm.t_perm_role where id=?`, [r01.id]))[0]?.role_status;
  report('⑦ 职位 停用→启用', a.ok && b.ok && st === '启用', `终态=${st}`);
}

/* ---------- ⑧ 部门管理（财务管理部 备注改回） ---------- */
{
  const newRemark = (finDept.remark || '') + 'T';
  const a = await call('PUT', '/api/perm/dept/update', { id: finDept.id, deptName: finDept.dept_name, parentId: finDept.parent_id, remark: newRemark });
  const b = await call('PUT', '/api/perm/dept/update', { id: finDept.id, deptName: finDept.dept_name, parentId: finDept.parent_id, remark: finDept.remark || '' });
  report('⑧ 部门管理 编辑保存', a.ok && b.ok);
}

/* ---------- ⑨ 账号停用→启用（周铭） ---------- */
{
  const a = await call('PUT', '/api/perm/user/status', { id: zm.id, userStatus: '已停用' });
  const mid = (await q(`select user_status from sms_perm.t_perm_user where id=?`, [zm.id]))[0]?.user_status;
  const b = await call('PUT', '/api/perm/user/status', { id: zm.id, userStatus: '正常' });
  const end = (await q(`select user_status from sms_perm.t_perm_user where id=?`, [zm.id]))[0]?.user_status;
  report('⑨ 账号 停用→启用', a.ok && b.ok && mid === '已停用' && end === '正常', `中间=${mid} 终态=${end}`);
}

/* ---------- ⑩ 重置密码（周铭，重置后还原） ---------- */
{
  const before = (await q(`select password, pwd_algo, need_change_pwd from sms_perm.t_perm_user where id=?`, [zm.id]))[0];
  const beforePortal = (await q(`select password from sms_portal.t_sys_account where account='zhoum' and is_deleted=0`))[0];
  const { ok, status, j } = await call('PUT', '/api/perm/user/reset-pwd', { userId: zm.id, newPassword: 'Zm#Test2026x' });
  const after = (await q(`select password from sms_perm.t_perm_user where id=?`, [zm.id]))[0]?.password;
  await q(`update sms_perm.t_perm_user set password=?, pwd_algo=?, need_change_pwd=? where id=?`, [before.password, before.pwd_algo, before.need_change_pwd, zm.id]);
  if (beforePortal) await q(`update sms_portal.t_sys_account set password=? where account='zhoum' and is_deleted=0`, [beforePortal.password]);
  report('⑩ 重置密码', ok && !!after && after !== before.password, `HTTP ${status} ${j?.message || ''}（密码已还原）`);
}

/* ---------- ⑪ 账号一致审计复跑前置检查：周铭/孙敏 title 与职位 ---------- */
{
  const rows = await q(`select a.account, a.title, (select group_concat(r.role_name order by r.role_name separator '、') from sms_perm.t_perm_user_role ur join sms_perm.t_perm_role r on r.id=ur.role_id where ur.user_id=u.id and ur.is_deleted=0) roles
    from sms_portal.t_sys_account a join sms_perm.t_perm_user u on u.account=a.account and u.is_deleted=0 where a.is_deleted=0`);
  let mismatch = 0;
  for (const x of rows) {
    if (x.roles && x.title !== x.roles) { mismatch++; console.log(`  ✘ ${x.account}: title=${x.title} vs 职位=${x.roles}`); }
  }
  report('⑪ 全部账号 头衔 == 当前职位名', mismatch === 0, `${rows.length} 个账号`);
}

console.log(`\n===== 回归结果：通过 ${pass} / 失败 ${fail} =====`);
await db.end();
process.exit(fail ? 1 : 0);
