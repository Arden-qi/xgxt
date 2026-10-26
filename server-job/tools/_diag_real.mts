import { db as jobDb } from '../src/utils/db';
const rows = await jobDb('t_student_base').where('is_deleted', 0).whereNotNull('class_id')
  .select('id', 'student_no', 'student_name', 'class_id', 'class_name', 'student_status', 'dept_code');
console.log('实训真学生:', JSON.stringify(rows, null, 1));
const rel = await jobDb('t_job_class_student').where('is_deleted', 0).select('id', 'class_id', 'student_id', 'student_no', 'student_name', 'uk_in_class');
console.log('关系行:', JSON.stringify(rel, null, 1));
process.exit(0);
