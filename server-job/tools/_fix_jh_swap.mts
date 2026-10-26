/* 按 stage_code 纠正初高班级责任人：102-104=初中部 → 冯春霞组；105-107=高中部 → 雷雨欣组 */
import { uniDb } from '../src/teaching/shared/uniTable';
import { db as jhDb } from '../src/class-jh/utils/db';
import { db as permDb } from '../src/perm/utils/db';
const NOW = new Date();
const ids: Record<string, string> = {};
for (const acc of ['fengcx', 'gaowb', 'hanxy', 'leiyx', 'liuzq', 'mengxh']) {
  const u = await permDb('t_perm_user').where({ account: acc, is_deleted: 0 }).first();
  ids[acc] = u?.id || '';
}
const GZ = { head: [ids.fengcx, '冯春霞'], tutor: [ids.gaowb, '高文博'], assist: [ids.hanxy, '韩雪莹'] };
const SEN = { head: [ids.leiyx, '雷雨欣'], tutor: [ids.liuzq, '刘志强'], assist: [ids.mengxh, '孟晓晗'] } as any;
const cls = await uniDb('t_uni_class').where('is_deleted', 0).where('dept_code', 1)
  .select('id', 'class_name', 'stage_code');
for (const c of cls) {
  const junior = (c.stage_code || 0) <= 104;
  const grp = junior ? GZ : SEN;
  const upd = {
    head_teacher_id: grp.head[0], head_teacher_name: grp.head[1],
    teacher_id: grp.tutor[0], teacher_name: grp.tutor[1],
    assistant_id: grp.assist[0], assistant_name: grp.assist[1],
  };
  await uniDb('t_uni_class').where('id', c.id).update({ ...upd, update_time: NOW, update_by: 'ORG-1024-SWAP' });
  await uniDb('t_uni_student').where('class_id', c.id).where('is_deleted', 0).update({
    head_teacher_id: upd.head_teacher_id, head_teacher_name: upd.head_teacher_name,
    teacher_id: upd.teacher_id, teacher_name: upd.teacher_name,
    assistant_id: upd.assistant_id, assistant_name: upd.assistant_name,
  });
  try { await jhDb('t_class_info').where('class_name', c.class_name).update(upd); } catch { /* 统一表为准 */ }
  console.log(`${c.class_name}(stage=${c.stage_code}) → ${junior ? '初中部' : '高中部'} ${grp.head[1]}组`);
}
process.exit(0);
