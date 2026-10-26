import { db } from '../src/perm/utils/db';
async function main() {
  for (const t of ['t_perm_role', 't_perm_role_page', 't_perm_role_perm', 't_perm_user_role']) {
    const cols = await db('information_schema.columns as c')
      .where({ table_schema: 'sms_perm', table_name: t })
      .select('column_name', 'column_type', 'column_key', 'extra');
    console.log(`=== ${t} ===`);
    console.log(cols.map((c: any) => `${c.column_name}:${c.column_type}${c.column_key === 'PRI' ? ' PK' : ''}`).join('\n'));
  }
  const idx = await db('information_schema.statistics as s').where({ table_schema: 'sms_perm', table_name: 't_perm_role' }).select('index_name', 'column_name');
  console.log('t_perm_role indexes:', JSON.stringify(idx));
  process.exit(0);
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
