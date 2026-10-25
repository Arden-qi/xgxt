import { writeFileSync } from 'fs';
import { db as jobDb } from '../src/utils/db';
import { db as classDb } from '../src/class/db';
import { db as classJhDb } from '../src/class-jh/utils/db';
import { db as permDb } from '../src/perm/utils/db';
const OUT = '../../输出/数据修复备份';
async function dump(conn: any, table: string, name: string) {
  try {
    const rows = await conn(table).select();
    writeFileSync(new URL(`${OUT}/${name}.json`, import.meta.url), JSON.stringify(rows, null, 1), 'utf8');
    console.log(`${name}: ${rows.length} 行`);
  } catch (e: any) { console.log(`${name}: ERR ${e.message}`); }
}
await dump(jobDb, 't_job_class', 'sms_job_t_job_class');
await dump(jobDb, 't_student_base', 'sms_job_t_student_base');
await dump(jobDb, 't_job_class_student', 'sms_job_t_job_class_student');
await dump(classDb, 't_class_info', 'sms_class_t_class_info');
await dump(classJhDb, 't_class_info', 'sms_class_jh_t_class_info');
process.exit(0);
