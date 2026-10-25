/**
 * 数据范围修复 · 2026-10-24
 * ============================================================
 * 目标：让「有权限的账号」在自己学段能看到真实数据（种子数据责任错位修复）
 *
 * ① 软删三个学段库的「自检%」残留学生（历次自检脚本遗留，未分班不隔离，污染所有人列表）
 * ② 实训班 SX2601：项目经理 周杰(U009) → 孙敏(U008)（孙敏是项目经理，周杰是就业老师）
 * ③ 初高班 G2601/J2602：班主任 孙敏(U008) → 张海涛(U004)（项目经理不带初高班）
 * ④ 大学班 U2601/U2602：补助教 赵梦雪(U_zhaomx)（助教原来一个班都没挂）
 * ⑤ 新造实训班 SX2602(陈晓峰)/SX2603(孙建龙) 各带 2 名学生（两位新项目经理原来无班）
 *
 * 回滚：软删行改回 is_deleted=0；②③④ 按备份 JSON 还原；⑤ 删除新增行。
 */
import { db as jobDb } from '../src/utils/db';
import { db as classDb } from '../src/class/db';
import { db as classJhDb } from '../src/class-jh/utils/db';

const NOW = new Date();
const TAG = 'FIX-1024';

async function main() {
  /* ① 软删自检残留 */
  for (const [conn, table, label] of [
    [jobDb, 't_student_base', '实训'],
    [classDb, 't_class_student', '大学'],
    [classJhDb, 't_class_student', '初高'],
  ] as const) {
    const n = await conn(table).where('is_deleted', 0).where('student_name', 'like', '自检%')
      .update({ is_deleted: 1, update_by: TAG, update_time: NOW });
    console.log(`① ${label} 软删自检残留: ${n} 行`);
  }

  /* ② SX2601 项目经理 → 孙敏 */
  const n2 = await jobDb('t_job_class').where('id', 'CLS-JOB-SX2601').update({
    project_manager_id: 'U008', project_manager_name: '孙敏',
    head_teacher_id: 'U008', head_teacher_name: '孙敏',
    update_by: TAG, update_time: NOW,
  });
  console.log(`② SX2601 项目经理→孙敏: ${n2} 行`);

  /* ③ 初高班班主任 → 张海涛 */
  const n3 = await classJhDb('t_class_info').whereIn('id', ['CLS-JH-G2601', 'CLS-JH-J2602']).update({
    head_teacher_id: 'U004', head_teacher_name: '张海涛',
    teacher_id: 'U004', teacher_name: '张海涛',
    update_by: TAG, update_time: NOW,
  });
  console.log(`③ 初高班班主任→张海涛: ${n3} 行`);

  /* ④ 大学班补助教 → 赵梦雪 */
  const n4 = await classDb('t_class_info').whereIn('id', ['CLS-U2601', 'CLS-U2602']).update({
    assistant_id: 'U_zhaomx', assistant_name: '赵梦雪',
    update_by: TAG, update_time: NOW,
  });
  console.log(`④ 大学班助教→赵梦雪: ${n4} 行`);

  /* ⑤ 新造实训班 + 学生（各 2 名） */
  const newClasses = [
    {
      id: 'CLS-JOB-SX2602', name: 'SX2602', pmId: 'U_chenxf', pmName: '陈晓峰', room: '实训基地 B-2',
      students: [
        { sid: 'JSB-U26016', no: 'U26016', nm: '沈嘉豪' },
        { sid: 'JSB-U26017', no: 'U26017', nm: '苏雨桐' },
      ],
    },
    {
      id: 'CLS-JOB-SX2603', name: 'SX2603', pmId: 'U_sunjl', pmName: '孙建龙', room: '实训基地 B-3',
      students: [
        { sid: 'JSB-U26018', no: 'U26018', nm: '韩明轩' },
        { sid: 'JSB-U26019', no: 'U26019', nm: '姜若彤' },
      ],
    },
  ];
  for (const c of newClasses) {
    const exist = await jobDb('t_job_class').where('id', c.id).first();
    if (exist) { console.log(`⑤ ${c.id} 已存在，跳过建班`); continue; }
    await jobDb('t_job_class').insert({
      id: c.id, create_time: NOW, create_by: TAG, update_time: NOW, update_by: TAG,
      is_deleted: 0, class_name: c.name, class_code: c.name, dept_code: 3, stage: 301,
      head_teacher_id: c.pmId, head_teacher_name: c.pmName,
      classroom: c.room, open_date: NOW, student_count: c.students.length,
      class_status: 1, attendance_rate: '95.00',
      remark: '数据范围修复：为该项目经理新建实训班',
      project_manager_id: c.pmId, project_manager_name: c.pmName,
      employment_teacher_id: 'U009', employment_teacher_name: '周杰',
      stage_key: 'job',
    });
    for (const s of c.students) {
      const stuExist = await jobDb('t_student_base').where('id', s.sid).first();
      if (stuExist) { console.log(`   学生 ${s.nm} 已存在，跳过`); continue; }
      await jobDb('t_student_base').insert({
        id: s.sid, create_time: NOW, create_by: TAG, is_deleted: 0,
        student_no: s.no, student_name: s.nm, gender: 1, dept_code: 3,
        class_id: c.id, class_name: c.name,
        head_teacher_id: c.pmId, head_teacher_name: c.pmName,
        student_status: 8, stage_key: 'job', repeat_count: 0,
      });
      const relExist = await jobDb('t_job_class_student').where('id', `JCS-${s.no}`).first();
      if (!relExist) {
        await jobDb('t_job_class_student').insert({
          id: `JCS-${s.no}`, create_time: NOW, create_by: TAG, is_deleted: 0,
          class_id: c.id, class_name: c.name,
          student_id: s.sid, student_no: s.no, student_name: s.nm,
          join_date: NOW, join_type: 1, status: 1,
          remark: '数据范围修复：新班入班',
        });
      }
    }
    console.log(`⑤ 建班 ${c.name}（${c.pmName}）+ ${c.students.length} 名学生 完成`);
  }

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
