import { BASE, conn, killAll, login, req, startServices } from './scripts/_e2e-lib.mjs';

await startServices();

const ACCOUNTS = ['zhanght', 'sunjl', 'qiansy', 'lilx', 'congym'];
const tokens = {};
for (const a of ACCOUNTS) tokens[a] = await login(a);

console.log('\n=== 1. 新入口 GET /api/teaching/class-transfer/targets（大学班 U2601）===');
for (const a of ACCOUNTS) {
  const r = await req(`${BASE}/api/teaching/class-transfer/targets?stage=class&fromClassId=CLS-U2601&mode=repeat`, {
    token: tokens[a],
  });
  const n = (r.json?.data || []).length;
  console.log(`${a.padEnd(8)} code=${r.json?.code} ${r.json?.message || ''} 目标班=${n}`);
}

console.log('\n=== 2. 旧入口（应已下线）===');
{
  const r = await req(`${BASE}/api/teaching/class/transfer-targets?stage=class&fromClassId=CLS-U2601`, { token: tokens.qiansy });
  console.log(`旧路径 code=${r.json?.code} ${r.json?.message || '(无此路由)'}`);
}

console.log('\n=== 3. 班主任（只有成绩权限）真正执行一次换班 ===');
const db = conn('sms_common');
const sid = 'TEST-XFER-' + Date.now();
await db('t_uni_student').insert({
  id: sid,
  edu_stage: 'class',
  student_no: 'X' + Date.now(),
  student_name: '自检-权限换班',
  gender: 1,
  class_id: 'CLS-U2601',
  class_name: 'U2601',
  student_status: 5,
  repeat_count: 0,
  is_deleted: 0,
  create_time: new Date(),
});

const doRes = await req(`${BASE}/api/teaching/class-transfer/do`, {
  method: 'POST',
  token: tokens.zhanght,
  body: {
    stage: 'class',
    studentId: sid,
    fromClassId: 'CLS-U2601',
    toClassId: 'CLS-U2602',
    mode: 'repeat',
    reason: '自检-权限验证',
  },
});
console.log('POST /do  zhanght ->', doRes.json?.code, doRes.json?.message);
const after = await db('t_uni_student').where({ id: sid }).first();
console.log('  换班后班级 =', after?.class_name, '| repeat_count =', after?.repeat_count);
const rep = await db('t_uni_repeat').where({ student_id: sid }).first();
console.log('  末班记录 =', rep ? `${rep.from_class_name}→${rep.to_class_name}` : '无');
const tr = await db('t_uni_class_transfer').where({ student_id: sid }).first();
console.log('  转班记录 =', tr ? `${tr.from_class_name}→${tr.to_class_name} (${tr.transfer_reason})` : '无');

console.log('\n=== 4. 反向校验：进度更慢的班不能被升班 ===');
{
  // U2602(203) → U2601(206) 是升班；反过来 U2601→U2602 当 promote 应被拒
  const bad = await req(`${BASE}/api/teaching/class-transfer/do`, {
    method: 'POST',
    token: tokens.zhanght,
    body: { stage: 'class', studentId: sid, fromClassId: 'CLS-U2602', toClassId: 'CLS-U2601', mode: 'repeat' },
  });
  console.log('repeat 往更快班 ->', bad.json?.code, bad.json?.message);
}

console.log('\n=== 5. 无权限账号尝试写入 ===');
{
  const r = await req(`${BASE}/api/teaching/class-transfer/do`, {
    method: 'POST',
    token: tokens.lilx,
    body: { stage: 'class', studentId: sid, fromClassId: 'CLS-U2602', toClassId: 'CLS-U2601', mode: 'promote' },
  });
  console.log('lilx(市场) ->', r.json?.code, r.json?.message);
}

/* 清理 */
await db('t_uni_repeat').where({ student_id: sid }).del();
await db('t_uni_class_transfer').where({ student_id: sid }).del();
await db('t_uni_student').where({ id: sid }).del();
await db.destroy();
console.log('\n测试数据已清理');
killAll();
