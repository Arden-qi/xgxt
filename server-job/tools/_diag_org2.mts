/* 门户账号表 + 部门计数逻辑摸底 */
import { db as portalDb } from '../src/portal/utils/db';

async function main() {
  const accs = await portalDb('t_sys_account').where('is_deleted', 0).select();
  for (const a of accs) {
    console.log(`  ${a.account} | title=${a.title} | modules=${a.modules} | active=${a.active}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
