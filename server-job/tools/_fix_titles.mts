import { db as permDb } from '../src/perm/utils/db';
import { syncPortalAccountTitle } from '../src/perm/services/perm.service';
const users = await permDb('t_perm_user').where('is_deleted', 0).select('id', 'account');
let n = 0;
for (const u of users) {
  if (!u.account) continue;
  const links = await permDb('t_perm_user_role').where({ user_id: u.id, is_deleted: 0 });
  const roles = links.length
    ? await permDb('t_perm_role').whereIn('id', links.map((l: any) => l.role_id)).andWhere('is_deleted', 0).select('role_name')
    : [];
  const title = [...new Set(roles.map((r: any) => r.role_name))].join('、');
  if (title) {
    const okFlag = await syncPortalAccountTitle(u.account, title);
    if (okFlag) n++;
  }
}
console.log('title 同步完成:', n, '个账号');
process.exit(0);
