/* 全系统审计：每个账号的部门 == 其职位的部门 */
import { db as permDb } from '../src/perm/utils/db';
const users = await permDb('t_perm_user').where('is_deleted', 0).select('id', 'account', 'user_name', 'dept_id');
let bad = 0;
for (const u of users) {
  const links = await permDb('t_perm_user_role').where({ user_id: u.id, is_deleted: 0 });
  const roles = links.length ? await permDb('t_perm_role').whereIn('id', links.map((l: any) => l.role_id)).andWhere('is_deleted', 0).select('role_name', 'dept_id') : [];
  const mism = roles.filter((r: any) => r.dept_id && r.dept_id !== u.dept_id);
  if (mism.length || !roles.length) {
    bad++;
    console.log(`✗ ${u.user_name}(${u.account}) 账号部门=${u.dept_id} 职位=[${roles.map((r: any) => r.role_name + '@' + r.dept_id).join('、') || '无职位'}]`);
  }
}
console.log(bad === 0 ? '✓ 全部账号 部门与职位归属一致' : `✗ ${bad} 个账号不一致`);
const dts = await permDb('t_perm_dept').where('is_deleted', 0).select('id', 'dept_name');
for (const d of dts) {
  const rc = await permDb('t_perm_role').where({ dept_id: d.id, is_deleted: 0 }).count('* as c');
  const uc = await permDb('t_perm_user').where({ dept_id: d.id, is_deleted: 0 }).count('* as c');
  console.log(`  ${d.dept_name}(${d.id}): 职位${rc[0].c} 账号${uc[0].c}`);
}
process.exit(0);
