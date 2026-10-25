import { uniDb } from '../src/teaching/shared/uniTable';
const cls = await uniDb('t_uni_class').where('is_deleted', 0).where('dept_code', 1)
  .select('id', 'class_name', 'stage_code', 'stage_key', 'head_teacher_id', 'head_teacher_name', 'edu_stage');
for (const c of cls) console.log(JSON.stringify(c));
const stu = await uniDb('t_uni_student').where('is_deleted', 0).where('dept_code', 1)
  .select('class_name', 'stage_code');
const m: Record<string, number> = {};
for (const s of stu) m[`${s.class_name}|${s.stage_code}`] = (m[`${s.class_name}|${s.stage_code}`] || 0) + 1;
console.log('学生分布:', JSON.stringify(m));
process.exit(0);
