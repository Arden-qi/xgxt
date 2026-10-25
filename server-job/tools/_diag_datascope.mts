/**
 * 诊断：孙敏等账号在各学段的数据范围 vs 库里实际数据量
 * 用法: node tsx tools/_diag_datascope.mts [account]
 */
import { db as jobDb } from '../src/utils/db';
import { db as classDb } from '../src/class/db';
import { db as classJhDb } from '../src/class-jh/utils/db';
import { db as permDb } from '../src/perm/utils/db';
import { db as empDb } from '../src/utils/db';

async function main() {
  const ACCOUNT = process.argv[2] || '';

  // ⓪ 各学段学生总量
  const cnt = async (conn: any, dbName: string, table: string, label: string) => {
    try {
      const r = await conn(table).where('is_deleted', 0).count('* as c');
      console.log(`${label}: ${r[0].c}`);
    } catch (e: any) {
      console.log(`${label}: ERR ${e.message}`);
    }
  };
  console.log('=== 各库学生总量 ===');
  await cnt(jobDb, 'sms_job', 't_student_base', '实训(job) 学生');
  await cnt(classDb, 'sms_class', 't_class_student', '大学(class) 学生');
  await cnt(classJhDb, 'sms_class_jh', 't_class_student', '初高(jh) 学生');
  try {
    const r = await (empDb as any)('t_emp_student').where('is_deleted', 0).count('* as c');
    console.log(`就业(emp) 学生: ${r[0].c}`);
  } catch (e: any) {
    console.log(`就业(emp) 学生: ERR ${e.message}`);
  }

  // ① 班级及其责任人
  console.log('=== 实训班 t_job_class ===');
  const jobCls = await jobDb('t_job_class').where('is_deleted', 0)
    .select('id', 'class_name', 'class_status', 'project_manager_id', 'employment_teacher_id');
  for (const c of jobCls) console.log(`  ${c.id} ${c.class_name} status=${c.class_status} pm=${c.project_manager_id} emp=${c.employment_teacher_id}`);

  console.log('=== 大学班 t_class_info (前10) ===');
  const uniCls = await classDb('t_class_info').where('is_deleted', 0).limit(10)
    .select('id', 'class_name', 'head_teacher_id', 'teacher_id', 'assistant_id');
  for (const c of uniCls) console.log(`  ${c.id} ${c.class_name} head=${c.head_teacher_id} teacher=${c.teacher_id} assist=${c.assistant_id}`);

  console.log('=== 初高班 t_class_info (前10) ===');
  const jhCls = await classJhDb('t_class_info').where('is_deleted', 0).limit(10)
    .select('id', 'class_name', 'head_teacher_id', 'teacher_id', 'assistant_id');
  for (const c of jhCls) console.log(`  ${c.id} ${c.class_name} head=${c.head_teacher_id} teacher=${c.teacher_id} assist=${c.assistant_id}`);

  // 就业部（emp）学生量：t_uni_student 域
  console.log('=== emp 学段探测 ===');
  try {
    const r = await jobDb('sms_common.t_uni_student as s').where('s.is_deleted', 0).count('* as c');
    console.log('sms_common.t_uni_student:', r[0].c);
  } catch (e: any) { console.log('t_uni_student ERR', e.message); }
  try {
    const r = await jobDb('sms_common.t_uni_class_student as s').where('s.is_deleted', 0).count('* as c');
    console.log('sms_common.t_uni_class_student:', r[0].c);
  } catch (e: any) { console.log('t_uni_class_student ERR', e.message); }

  console.log('=== t_perm_user 全表 ===');
  const users = await permDb('sms_perm.t_perm_user as u').where('u.is_deleted', 0)
    .leftJoin('sms_perm.t_perm_user_role as ur', 'ur.user_id', 'u.id')
    .leftJoin('sms_perm.t_perm_role as r', 'r.id', 'ur.role_id')
    .select('u.id', 'u.account', 'u.user_name', 'r.role_code');
  for (const x of users) console.log(`  ${x.id} ${x.account} ${x.user_name} ${x.role_code || '(无角色)'}`);

  // ② 全账号角色映射
  console.log('=== 全账号角色映射 ===');
  const all = await permDb('sms_perm.t_perm_user as u')
    .leftJoin('sms_perm.t_perm_user_role as ur', 'ur.user_id', 'u.id')
    .leftJoin('sms_perm.t_perm_role as r', 'r.id', 'ur.role_id')
    .where('u.is_deleted', 0)
    .select('u.id', 'u.account', 'u.user_name', 'r.role_code', 'r.role_name');
  for (const x of all) console.log(`  ${x.id} ${x.account} ${x.user_name} -> ${x.role_code}(${x.role_name})`);

  // ③ 就业部学生表探测
  console.log('=== 就业部表探测 ===');
  const tables = await permDb('information_schema.tables as t')
    .where('t.table_schema', 'sms_job').where('t.table_name', 'like', '%emp%')
    .select('table_name');
  console.log('sms_job 中 emp 表:', tables.map((t: any) => t.table_name || t.TABLE_NAME));
  const tables2 = await permDb('information_schema.tables as t')
    .where('t.table_schema', 'like', 'sms%').where('t.table_name', 'like', '%student%')
    .select('table_schema', 'table_name');
  for (const t of tables2) console.log(`  ${(t.table_schema || t.TABLE_SCHEMA)}.${(t.table_name || t.TABLE_NAME)}`);

  // ② 若指定账号：查其权限库角色 + 业务 userId 两种口径
  if (ACCOUNT) {
    console.log(`=== 账号 ${ACCOUNT} ===`);
    const u = await permDb('sms_perm.t_perm_user as u')
      .leftJoin('sms_perm.t_perm_user_role as ur', 'ur.user_id', 'u.id')
      .leftJoin('sms_perm.t_perm_role as r', 'r.id', 'ur.role_id')
      .where('u.account', ACCOUNT).where('u.is_deleted', 0)
      .select('u.id', 'u.user_name', 'r.role_code', 'r.role_name');
    console.log(u);
    const ids = [...new Set(u.map((x: any) => x.id))];
    console.log('权限库 userId:', ids);
    // 该 userId 是否出现在任何责任人列
    const pmHits = await jobDb('t_job_class').where('is_deleted', 0)
      .where((q: any) => q.whereIn('project_manager_id', ids).orWhereIn('employment_teacher_id', ids));
    console.log('实训/就业班命中:', pmHits.map((c: any) => `${c.class_name}(pm=${c.project_manager_id})`));
    const uniHits = await classDb('t_class_info').where('is_deleted', 0)
      .where((q: any) => q.whereIn('head_teacher_id', ids).orWhereIn('teacher_id', ids).orWhereIn('assistant_id', ids));
    console.log('大学班命中:', uniHits.map((c: any) => c.class_name));
    const jhHits = await classJhDb('t_class_info').where('is_deleted', 0)
      .where((q: any) => q.whereIn('head_teacher_id', ids).orWhereIn('teacher_id', ids).orWhereIn('assistant_id', ids));
    console.log('初高班命中:', jhHits.map((c: any) => c.class_name));
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
