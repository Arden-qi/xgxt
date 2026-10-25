import { db as permDb } from '../src/perm/utils/db';
import { db as portalDb } from '../src/portal/utils/db';
for (const acc of ['fengcx', 'leiyx', 'zhanght']) {
  const u = await permDb('t_perm_user').where({ account: acc, is_deleted: 0 }).first();
  if (!u) { console.log(acc, ': 无用户行'); continue; }
  const links = await permDb('t_perm_user_role').where({ user_id: u.id, is_deleted: 0 });
  const roles = await permDb('t_perm_role').whereIn('id', links.map((l: any) => l.role_id)).select('role_name', 'role_code');
  console.log(`${acc}(${u.id}) dept=${u.dept_id} roles=`, JSON.stringify(roles));
}
const t = await portalDb('t_sys_account').whereIn('account', ['zhanght', 'fengcx', 'leiyx']).select('account', 'title');
console.log('portal titles:', JSON.stringify(t));
process.exit(0);
