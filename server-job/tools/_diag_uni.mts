import { uniDb } from '../src/teaching/shared/uniTable';
const cls = await uniDb('t_uni_class').whereIn('edu_stage', ['job','emp']).andWhere('dept_code', 3)
  .select('id','class_name','project_manager_id','employment_teacher_id','is_deleted','edu_stage');
console.log('t_uni_class(job/emp):', JSON.stringify(cls, null, 1));
const stu = await uniDb('t_uni_student').whereIn('edu_stage', ['job','emp']).andWhere('dept_code', 3)
  .where('is_deleted', 0)
  .select('id','student_no','student_name','class_id','class_name','student_status','head_teacher_id','edu_stage');
console.log('t_uni_student(job/emp) 行数:', stu.length);
for (const s of stu) console.log(`  ${s.student_no} ${s.student_name} cls=${s.class_id} st=${s.student_status} head=${s.head_teacher_id} ${s.edu_stage}`);
process.exit(0);
