/**
 * 自检 · 学生换班（末班 / 升班）
 * ============================================================
 * 覆盖点：
 *   ① 权限：班主任（只有成绩权限）能不能用 —— 这是拆独立前缀的原因；
 *      市场咨询这种无关角色必须被拦
 *   ② 旧路径已下线（防止前端漏改还能偷偷调通）
 *   ③ 落库：学生班籍 / repeat_count / 末班记录 / 转班记录
 *   ④ 进度规则：末班只能往「进度≤当前」，升班只能往「进度>当前」
 *
 * 运行：node scripts/_e2e-transfer-check.mjs
 * 依赖：后端 8004 + 前端 5173 + 数据库可用
 */

import { BASE, conn, killAll, login, req, startServices } from './_e2e-lib.mjs';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`  ${pass ? '✅' : '❌'} ${name}${detail ? '  —— ' + detail : ''}`);
};

const FROM = 'CLS-U2601'; // 大学部 阶段206
const TO = 'CLS-U2602'; // 大学部 阶段203（更慢）

await startServices();
const tokens = {};
for (const a of ['zhanght', 'sunjl', 'qiansy', 'lilx']) tokens[a] = await login(a);

const db = conn('sms_common');
const sid = 'TEST-XFER-' + Date.now();
const cleanup = async () => {
  await db('t_uni_repeat').where({ student_id: sid }).del().catch(() => {});
  await db('t_uni_class_transfer').where({ student_id: sid }).del().catch(() => {});
  await db('t_uni_student').where({ id: sid }).del().catch(() => {});
  await db.destroy().catch(() => {});
};

try {
  /* ---------- 1. 可选目标班级（权限） ---------- */
  const targets = {};
  for (const a of ['zhanght', 'sunjl', 'qiansy', 'lilx']) {
    targets[a] = await req(`${BASE}/api/teaching/class-transfer/targets?stage=class&fromClassId=${FROM}&mode=repeat`, {
      token: tokens[a],
    });
  }
  check('★ 班主任(只有成绩权限)能取目标班级', targets.zhanght.json?.code === 200, `code=${targets.zhanght.json?.code} ${targets.zhanght.json?.message || ''}`);
  check('★ 项目经理能取目标班级', targets.sunjl.json?.code === 200, `code=${targets.sunjl.json?.code}`);
  check('★ 校长能取目标班级', targets.qiansy.json?.code === 200, `code=${targets.qiansy.json?.code}`);
  check('★ 市场咨询(无关角色)被拦', targets.lilx.json?.code === 40302, `code=${targets.lilx.json?.code}`);
  check('★ 目标班级按进度过滤（不含自己）', !(targets.qiansy.json?.data || []).some((x) => x.id === FROM));

  /* ---------- 2. 旧路径已下线 ---------- */
  const legacy = await req(`${BASE}/api/teaching/class/transfer-targets?stage=class&fromClassId=${FROM}`, { token: tokens.qiansy });
  check('★ 旧路径 /api/teaching/class/transfer-targets 已下线', legacy.json?.code !== 200, `code=${legacy.json?.code}`);

  /* ---------- 3. 班主任执行末班 ---------- */
  await db('t_uni_student').insert({
    id: sid,
    edu_stage: 'class',
    student_no: 'X' + Date.now(),
    student_name: '自检-换班生',
    gender: 1,
    class_id: FROM,
    class_name: 'U2601',
    student_status: 5,
    repeat_count: 0,
    is_deleted: 0,
    create_time: new Date(),
  });

  const doRes = await req(`${BASE}/api/teaching/class-transfer/do`, {
    method: 'POST',
    token: tokens.zhanght,
    body: { stage: 'class', studentId: sid, fromClassId: FROM, toClassId: TO, mode: 'repeat', reason: '自检' },
  });
  check('★ 班主任执行末班成功（不再 403）', doRes.json?.code === 200, `code=${doRes.json?.code} ${doRes.json?.message || ''}`);

  const stu = await db('t_uni_student').where({ id: sid }).first();
  check('★ 学生班籍已改到目标班', stu?.class_name === 'U2602', `class_name=${stu?.class_name}`);
  check('★ repeat_count +1', Number(stu?.repeat_count) === 1, `repeat_count=${stu?.repeat_count}`);

  const rep = await db('t_uni_repeat').where({ student_id: sid }).first();
  check('★ 末班记录已写入（含 from→to）', !!rep && rep.from_class_name === 'U2601' && rep.to_class_name === 'U2602');

  const tr = await db('t_uni_class_transfer').where({ student_id: sid }).first();
  check('★ 转班留痕已写入', !!tr && tr.to_class_name === 'U2602', `reason=${tr?.transfer_reason}`);

  /* ---------- 4. 进度规则 ---------- */
  // 末班往更快班（U2602→U2601）必须被拒
  const badRepeat = await req(`${BASE}/api/teaching/class-transfer/do`, {
    method: 'POST',
    token: tokens.zhanght,
    body: { stage: 'class', studentId: sid, fromClassId: 'CLS-U2602', toClassId: FROM, mode: 'repeat' },
  });
  check('★ 末班不许往进度更快的班', badRepeat.json?.code === 40000 && /更快|更慢/.test(badRepeat.json?.message || ''), `${badRepeat.json?.code} ${badRepeat.json?.message || ''}`);

  // 升班往更慢班（U2601→U2602）必须被拒
  await db('t_uni_student').where({ id: sid }).update({ class_id: FROM, class_name: 'U2601' });
  const badPromote = await req(`${BASE}/api/teaching/class-transfer/do`, {
    method: 'POST',
    token: tokens.zhanght,
    body: { stage: 'class', studentId: sid, fromClassId: FROM, toClassId: TO, mode: 'promote' },
  });
  check('★ 升班不许往进度更慢的班', badPromote.json?.code === 40000, `${badPromote.json?.code} ${badPromote.json?.message || ''}`);

  /* ---------- 5. 无关角色写入被拦 ---------- */
  const lilxWrite = await req(`${BASE}/api/teaching/class-transfer/do`, {
    method: 'POST',
    token: tokens.lilx,
    body: { stage: 'class', studentId: sid, fromClassId: FROM, toClassId: TO, mode: 'repeat' },
  });
  check('★ 无关角色写入被拦', lilxWrite.json?.code === 40302, `code=${lilxWrite.json?.code}`);
} finally {
  await cleanup();
  killAll();
}

const pass = results.filter((r) => r.pass).length;
console.log(`\n===== 结果：${pass}/${results.length} 通过 =====`);
if (pass !== results.length) {
  console.log('  失败：' + results.filter((r) => !r.pass).map((r) => r.name).join(' / '));
  process.exitCode = 1;
}
