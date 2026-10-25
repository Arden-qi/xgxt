import { uniDb } from '../src/teaching/shared/uniTable';
const cls = await uniDb('t_uni_class').where('is_deleted', 0)
  .select('id','class_name','edu_stage','dept_code','head_teacher_id','teacher_id','assistant_id','project_manager_id','employment_teacher_id');
console.log('=== t_uni_class 全部 ===');
for (const c of cls) console.log(JSON.stringify(c));
const stuCnt = await uniDb('t_uni_student').where('is_deleted', 0).count('* as c');
console.log('t_uni_student 总行数:', stuCnt[0].c);
const byStage = await uniDb('t_uni_student').where('is_deleted', 0).groupBy('edu_stage').select('edu_stage').count('* as c');
for (const b of byStage) console.log(`  ${b.edu_stage}: ${b.c}`);
const relCnt = await uniDb('t_uni_class_student').where('is_deleted', 0).count('* as c');
console.log('t_uni_class_student:', relCnt[0].c);
process.exit(0);
