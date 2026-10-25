/**
 * 数据范围修复 · 统一表版（sms_common 权威读路径）· 2026-10-24
 *
 * ① t_uni_class 责任列修正：
 *    SX2601  pm/head: U009 → U008 孙敏（孙敏是项目经理）
 *    G2601/J2602 head/teacher: U008 → U004 张海涛（项目经理不带初高班）
 *    U2601/U2602 assistant: → U_zhaomx 赵梦雪（助教原来无班）
 *    SX2601 学生行 head 同步 U008
 * ② 克隆 SX2601 → 新班 SX2602(陈晓峰 U_chenxf)、SX2603(孙建龙 U_sunjl)，各带 2 名学生
 *    （克隆 t_uni_class / t_uni_student / t_uni_class_student 现有行，保证必填列齐全）
 */
import { uniDb } from '../src/teaching/shared/uniTable';
import { db } from '../src/utils/db';

const NOW = new Date();
const TAG = 'FIX-1024';

async function main() {
  /* ① 责任列修正 */
  const n1 = await uniDb('t_uni_class').where('id', 'CLS-JOB-SX2601').update({
    project_manager_id: 'U008', project_manager_name: '孙敏',
    head_teacher_id: 'U008', head_teacher_name: '孙敏',
    update_by: TAG, update_time: NOW,
  });
  console.log(`① SX2601 pm→孙敏: ${n1}`);
  const n2 = await uniDb('t_uni_class').whereIn('id', ['CLS-JH-G2601', 'CLS-JH-J2602']).update({
    head_teacher_id: 'U004', head_teacher_name: '张海涛',
    teacher_id: 'U004', teacher_name: '张海涛',
    update_by: TAG, update_time: NOW,
  });
  console.log(`① 初高班 head→张海涛: ${n2}`);
  const n3 = await uniDb('t_uni_class').whereIn('id', ['CLS-U2601', 'CLS-U2602']).update({
    assistant_id: 'U_zhaomx', assistant_name: '赵梦雪',
    update_by: TAG, update_time: NOW,
  });
  console.log(`① 大学班 assist→赵梦雪: ${n3}`);
  const n4 = await uniDb('t_uni_student').where('class_id', 'CLS-JOB-SX2601').where('is_deleted', 0).update({
    head_teacher_id: 'U008', head_teacher_name: '孙敏',
    update_by: TAG, update_time: NOW,
  });
  console.log(`① SX2601 学生 head 同步: ${n4}`);

  /* ② 克隆新班 */
  const proto = await uniDb('t_uni_class').where('id', 'CLS-JOB-SX2601').first();
  if (!proto) throw new Error('原型班 SX2601 不存在');
  const protoStu = await uniDb('t_uni_student').where('class_id', 'CLS-JOB-SX2601').where('is_deleted', 0).first();
  if (!protoStu) throw new Error('原型学生不存在');
  const protoRel = await uniDb('t_uni_class_student').where('class_id', 'CLS-JOB-SX2601').where('is_deleted', 0).first();
  if (!protoRel) throw new Error('原型关系行不存在');

  const newClasses = [
    {
      id: 'CLS-JOB-SX2602', name: 'SX2602', pmId: 'U_chenxf', pmName: '陈晓峰', room: '实训基地 B-2',
      students: [
        { no: 'U26016', nm: '沈嘉豪' },
        { no: 'U26017', nm: '苏雨桐' },
      ],
    },
    {
      id: 'CLS-JOB-SX2603', name: 'SX2603', pmId: 'U_sunjl', pmName: '孙建龙', room: '实训基地 B-3',
      students: [
        { no: 'U26018', nm: '韩明轩' },
        { no: 'U26019', nm: '姜若彤' },
      ],
    },
  ];

  for (const c of newClasses) {
    const exist = await uniDb('t_uni_class').where('id', c.id).first();
    if (exist) { console.log(`② ${c.id} 已存在，跳过`); continue; }
    const row: Record<string, any> = { ...proto };
    delete (row as any).create_time;
    Object.assign(row, {
      id: c.id, class_name: c.name, class_code: c.name,
      head_teacher_id: c.pmId, head_teacher_name: c.pmName,
      project_manager_id: c.pmId, project_manager_name: c.pmName,
      classroom: c.room, remark: '数据范围修复：为该项目经理新建实训班',
      create_time: NOW, create_by: TAG, update_time: NOW, update_by: TAG, is_deleted: 0,
    });
    await uniDb('t_uni_class').insert(row);
    console.log(`② 建班 ${c.name}（${c.pmName}）`);

    let idx = 0;
    for (const s of c.students) {
      idx += 1;
      const sid = `JSB-${s.no}`;
      const stuExist = await uniDb('t_uni_student').where('id', sid).first();
      if (!stuExist) {
        const stu: Record<string, any> = { ...protoStu };
        delete (stu as any).create_time;
        Object.assign(stu, {
          id: sid, student_no: s.no, student_name: s.nm,
          class_id: c.id, class_name: c.name,
          head_teacher_id: c.pmId, head_teacher_name: c.pmName,
          create_time: NOW, create_by: TAG, update_time: NOW, update_by: TAG, is_deleted: 0,
        });
        await uniDb('t_uni_student').insert(stu);
        console.log(`   学生 ${s.nm}(${s.no}) 已插入`);
      } else {
        console.log(`   学生 ${s.nm} 已存在`);
      }
      const relId = `JCS-${s.no}`;
      const relExist = await uniDb('t_uni_class_student').where('id', relId).first();
      if (!relExist) {
        const rel: Record<string, any> = { ...protoRel };
        delete (rel as any).create_time;
        Object.assign(rel, {
          id: relId, class_id: c.id, class_name: c.name,
          student_id: sid, student_no: s.no, student_name: s.nm,
          remark: '数据范围修复：新班入班',
          create_time: NOW, create_by: TAG, is_deleted: 0,
        });
        await uniDb('t_uni_class_student').insert(rel);
        console.log(`   关系行 ${s.nm} 已插入`);
      }
    }
  }

  /* ③ 校验 */
  const check = await uniDb('t_uni_class').whereIn('edu_stage', ['job', 'emp']).where('is_deleted', 0)
    .select('id', 'class_name', 'project_manager_id');
  console.log('③ job/emp 班级:', JSON.stringify(check));
  const stuCnt = await uniDb('t_uni_student').where('is_deleted', 0).groupBy('edu_stage')
    .select('edu_stage').count('* as c');
  console.log('③ 学生分布:', stuCnt.map((x: any) => `${x.edu_stage}=${x.c}`).join(' '));

  await db.destroy();
  process.exit(0);
}
main().catch(async (e) => { console.error(e); process.exit(1); });
