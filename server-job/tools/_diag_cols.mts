import { db } from '../src/utils/db';
async function main() {
  
  for (const t of ['t_uni_class', 't_uni_student', 't_uni_class_student']) {
    const cols = await db('information_schema.columns as c')
      .where({ table_schema: 'sms_common', table_name: t })
      .select('column_name', 'is_nullable', 'column_type', 'column_default', 'extra');
    console.log(`=== ${t} (${cols.length} 列) ===`);
    console.log(cols.map((c: any) => {
      const name = c.column_name || c.COLUMN_NAME;
      const nullable = c.is_nullable || c.IS_NULLABLE;
      const type = c.column_type || c.COLUMN_TYPE;
      const def = c.column_default ?? c.COLUMN_DEFAULT;
      const extra = c.extra || c.EXTRA || '';
      return `${name}:${type}${nullable === 'NO' && def === null ? ' NN' : ''}${String(extra).includes('GENERATED') ? ' GEN' : ''}`;
    }).join('\n'));
  }
  process.exit(0);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
