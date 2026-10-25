import { db as jobDb } from '../src/utils/db';
const NOW = new Date(); const TAG = 'FIX-1024';
const cls = { id: 'CLS-JOB-SX2602', name: 'SX2602', pmId: 'U_chenxf', pmName: '陈晓峰' };
const students = [
  { sid: 'JSB-U26016', no: 'U26016', nm: '沈嘉豪' },
  { sid: 'JSB-U26017', no: 'U26017', nm: '苏雨桐' },
];
for (const s of students) {
  const stu = await jobDb('t_student_base').where('id', s.sid).first();
  if (!stu) {
    await jobDb('t_student_base').insert({
      id: s.sid, create_time: NOW, create_by: TAG, is_deleted: 0,
      student_no: s.no, student_name: s.nm, gender: 1, dept_code: 3,
      class_id: cls.id, class_name: cls.name,
      head_teacher_id: cls.pmId, head_teacher_name: cls.pmName,
      student_status: 8, stage_key: 'job', repeat_count: 0,
    });
    console.log(`insert 学生 ${s.nm}`);
  } else console.log(`学生 ${s.nm} 已存在`);
  const rel = await jobDb('t_job_class_student').where('id', `JCS-${s.no}`).first();
  if (!rel) {
    await jobDb('t_job_class_student').insert({
      id: `JCS-${s.no}`, create_time: NOW, create_by: TAG, is_deleted: 0,
      class_id: cls.id, class_name: cls.name, student_id: s.sid, student_no: s.no,
      student_name: s.nm, join_date: NOW, join_type: 1, status: 1,
      remark: '数据范围修复：新班入班',
    });
    console.log(`insert 关系 ${s.nm}`);
  } else console.log(`关系 ${s.nm} 已存在`);
}
const cnt = await jobDb('t_job_class_student').where('class_id', cls.id).where('is_deleted', 0).count('* as c');
await jobDb('t_job_class').where('id', cls.id).update({ student_count: cnt[0].c });
console.log('SX2602 student_count =', cnt[0].c);
process.exit(0);
