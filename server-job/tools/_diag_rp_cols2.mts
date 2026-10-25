import { db } from '../src/perm/utils/db';
async function main() {
  const r = await db('t_perm_role').where('id', 'R03').first();
  console.log('R03:', JSON.stringify(r, null, 1));
  const rp = await db('t_perm_role_perm').where('role_id', 'R03').limit(2);
  console.log('role_perm rows:', JSON.stringify(rp));
  const pg = await db('t_perm_role_page').where('role_id', 'R03').limit(3);
  console.log('role_page rows:', JSON.stringify(pg, null, 1));
  const pgCols = pg[0] ? Object.keys(pg[0]) : [];
  console.log('role_page cols:', pgCols.join(','));
  process.exit(0);
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
