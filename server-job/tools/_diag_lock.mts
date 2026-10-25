import { db } from '../src/perm/utils/db';
const rows = await db('t_perm_user').where('is_deleted', 0)
  .groupBy('user_status').select('user_status').count('* as c');
for (const r of rows) console.log(r.user_status, '=', r.c);
process.exit(0);
