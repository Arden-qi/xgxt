import { db as jobDb } from '../src/utils/db';
import { db as classDb } from '../src/class/db';
import { db as classJhDb } from '../src/class-jh/utils/db';
const stat = async (conn: any, table: string, label: string) => {
  try {
    const junk = await conn(table).where('is_deleted', 0).where('student_name', 'like', '自检%').count('* as c');
    const total = await conn(table).where('is_deleted', 0).count('* as c');
    const unassigned = await conn(table).where('is_deleted', 0).whereNull('class_id').count('* as c');
    console.log(`${label}: 总${total[0].c} 自检${junk[0].c} 未分班${unassigned[0].c}`);
  } catch (e: any) { console.log(`${label}: ERR ${e.message}`); }
};
await stat(jobDb, 't_student_base', '实训(job)');
await stat(classDb, 't_class_student', '大学(class)');
await stat(classJhDb, 't_class_student', '初高(jh)');
process.exit(0);
