/* 部门/职位/账号 摸底：列出权限库核心台账 */
import { db as permDb } from '../src/perm/utils/db';

async function main() {
  console.log('=== t_perm_dept 全部部门 ===');
  const depts = await permDb('t_perm_dept').where('is_deleted', 0).select();
  for (const d of depts) {
    console.log(`  [${d.id}] ${d.dept_name} | parent=${d.parent_id} | 说明=${d.dept_desc ?? ''}`);
  }

  console.log('\n=== t_perm_role 全部职位 ===');
  const roles = await permDb('t_perm_role').where('is_deleted', 0).select();
  for (const r of roles) {
    console.log(`  [${r.id}] ${r.role_name} | code=${r.role_code ?? ''} | dept=${r.dept_id ?? ''} | status=${r.status ?? ''}`);
  }

  console.log('\n=== t_perm_user 全部用户 ===');
  const users = await permDb('t_perm_user').where('is_deleted', 0).select();
  for (const u of users) {
    console.log(`  [${u.id}] ${u.user_name} | account=${u.account} | dept=${u.dept_id ?? u.dept ?? ''}`);
  }

  console.log('\n=== t_perm_user_role 绑定 ===');
  const ur = await permDb('t_perm_user_role').select();
  for (const x of ur) {
    console.log(`  user=${x.user_id} role=${x.role_id}`);
  }

  console.log('\n=== t_sys_account (account/title/modules/dept) ===');
  const accs = await permDb('t_sys_account').where('is_deleted', 0).select();
  for (const a of accs) {
    console.log(`  ${a.account} | title=${a.title} | modules=${a.modules} | dept=${(a as any).dept_id ?? (a as any).dept ?? ''}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
