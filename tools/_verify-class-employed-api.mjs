/**
 * 回归验证：班级状态「实训 / 待就业 / 已就业」（2026-10-21 批注 1/2/3 条）
 * ============================================================
 * 批注原文：
 *   ① 「点击【升实训】，并且升实训成功后，则班级状态改为【实训】」
 *   ② 「点击【升就业】，并且升就业成功之后，则班级状态改为【待就业】，
 *      【升就业】按钮改为已就业」
 *   ③ 「点击【已就业】系统识别整个班级的学生状态…确认之后，班级的状态该为【已就业】；
 *      若识别班级内仍存在其他状态的学生，则提示班级各个状态的人数…再次确认之后状态改为已就业」
 *   ★ 2026-10-23 批注（推翻③的后半句）：「若识别班级内仍存在其他状态的学生，则进行提示班级
 *     各个状态的人数及人员，**不可进行【已就业】操作**」→ 不再有强制 / 二次确认。
 *
 * 本脚本只验 **接口层**（UI 层见 _verify-class-employed-ui.mjs）：
 *   · 升就业 → 班级状态 6（待就业），学生状态 9
 *   · employment-progress → 各状态人数 + 名单，settled=false（还有待就业）
 *   · 未结清时 employment-confirm → **40006 拒绝**，班级状态不变
 *   · 逐个学生确认已就业后 → confirm → 班级状态 7（已就业）；重复调 → changed=false
 *   · 改状态接口拒绝把状态手工改成系统态（实训/待就业/已就业）
 *
 * ⚠️ 会真实改动 demo 数据：跑之前用 _verify-class-employed-restore.mjs 备份，
 *    跑完再 restore 还原（见同目录脚本注释）。
 *
 * 用法：node tools/_verify-class-employed-api.mjs   （后端需在跑：8004）
 */
const BASE = 'http://localhost:8004';
const ACC = process.env.VERIFY_ACC || 'qiansy';
const PWD = process.env.VERIFY_PWD || '123456';

const fails = [];
const check = (n, ok, d = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  → ' + d : ''}`);
  if (!ok) fails.push(n);
};

const api = async (method, url, body, token) => {
  const r = await fetch(BASE + url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return await r.json().catch(() => ({}));
};

(async () => {
  const login = await api('POST', '/api/portal/account/login', { account: ACC, password: PWD });
  check('登录成功', login.code === 200, login.message || '');
  const token = login.data?.token || login.data?.accessToken;
  if (!token) {
    console.log('\nFAILED: 登录失败，后续跳过');
    process.exitCode = 1;
    return;
  }

  /* ---------- 1. 找一个还没到待就业/已就业的实训班 ---------- */
  const list = await api('GET', '/api/teaching/class/list?stage=job&size=50', null, token);
  const rows = list.data?.list || [];
  check('能查到实训班', rows.length > 0, `共 ${rows.length} 个`);
  const target =
    rows.find((r) => r.classCode === 'SX2601') ||
    rows.find((r) => ![6, 7].includes(Number(r.classStatus)));
  if (!target) {
    console.log('  没有可用样本，退出');
    process.exitCode = 1;
    return;
  }
  console.log(
    `  样本：${target.className}（${target.classCode}）id=${target.classId} 状态=${target.classStatusName}(${target.classStatus}) 人数=${target.studentCount}`,
  );

  /* ---------- 2. 升就业：班级状态 → 待就业(6) ---------- */
  const before = await api('GET', `/api/teaching/class/employment-progress?classId=${target.classId}`, null, token);
  console.log(`  升就业前学生状态：${(before.data?.items || []).map((i) => `${i.statusName}${i.count}`).join(' / ')}`);

  const up = await api('POST', '/api/teaching/class/employment-upgrade', { classId: target.classId }, token);
  check('升就业接口成功', up.code === 200, up.message || '');
  check('升就业后班级状态=6 待就业', Number(up.data?.classStatus) === 6, `${up.data?.classStatusName}(${up.data?.classStatus})`);

  const afterUp = await api('GET', `/api/teaching/class/list?stage=job&size=50`, null, token);
  const rowUp = (afterUp.data?.list || []).find((r) => r.classId === target.classId);
  check('列表状态列显示「待就业」', Number(rowUp?.classStatus) === 6, `${rowUp?.classStatusName}`);

  /* ---------- 3. 已就业：识别整班学生状态 ---------- */
  const prog = await api('GET', `/api/teaching/class/employment-progress?classId=${target.classId}`, null, token);
  const p = prog.data || {};
  console.log(`  识别结果：总 ${p.total} 人 / 已就业 ${p.employed} / 退学 ${p.quit} / 未结清 ${p.pending}`);
  check('返回各学生状态人数', Array.isArray(p.items) && p.items.length > 0, (p.items || []).map((i) => `${i.statusName}${i.count}`).join(' / '));
  check('刚升就业 → 全班未结清（settled=false）', p.settled === false, `pending=${p.pending}`);
  /* ★ 2026-10-23 批注：被拦时弹窗要显示「人员」→ 接口必须带名单 */
  const firstUnsettled = (p.items || []).find((i) => i.status !== 7 && i.status !== 10);
  check(
    '每个状态都带学生名单（姓名）',
    !!firstUnsettled && Array.isArray(firstUnsettled.students) && firstUnsettled.students.length === firstUnsettled.count,
    JSON.stringify((firstUnsettled?.students || []).slice(0, 3)),
  );

  /* ---------- 3.5 还有未结清学生 → 必须被拦（改口径前是「强制改为已就业」） ---------- */
  const blocked = await api('POST', '/api/teaching/class/employment-confirm', { classId: target.classId }, token);
  check('班里还有未结清学生 → 接口拒绝（40006）', Number(blocked.code) === 40006, `${blocked.code} ${blocked.message || ''}`);
  const stillWait = await api('GET', '/api/teaching/class/list?stage=job&size=50', null, token);
  const rowWait = (stillWait.data?.list || []).find((r) => r.classId === target.classId);
  check('被拦后班级状态仍是 6 待就业', Number(rowWait?.classStatus) === 6, `${rowWait?.classStatusName}(${rowWait?.classStatus})`);

  /* ---------- 4. 逐个学生确认「已就业」→ 再确认班级已就业 ---------- */
  for (const it of p.items || []) {
    if (it.status !== 9) continue; // 只把「待就业(9)」的学生改成已就业
    for (const stu of it.students || []) {
      const r = await api('POST', '/api/teaching/student/confirm-employed', { stage: 'job', id: stu.studentId }, token);
      if (r.code !== 200) console.log(`  学生 ${stu.studentName} 确认已就业失败：${r.code} ${r.message || ''}`);
    }
  }
  const prog2 = await api('GET', `/api/teaching/class/employment-progress?classId=${target.classId}`, null, token);
  check('全班都改成已就业后 settled=true', prog2.data?.settled === true, `pending=${prog2.data?.pending}`);

  const ok1 = await api('POST', '/api/teaching/class/employment-confirm', { classId: target.classId }, token);
  check('确认已就业接口成功', ok1.code === 200, ok1.message || '');
  check('班级状态=7 已就业', Number(ok1.data?.classStatus) === 7, `${ok1.data?.classStatusName}(${ok1.data?.classStatus})`);

  const ok2 = await api('POST', '/api/teaching/class/employment-confirm', { classId: target.classId }, token);
  check('重复确认 → changed=false', ok2.code === 200 && ok2.data?.changed === false, ok2.message || '');

  const afterEmp = await api('GET', `/api/teaching/class/list?stage=job&size=50`, null, token);
  const rowEmp = (afterEmp.data?.list || []).find((r) => r.classId === target.classId);
  check('列表状态列显示「已就业」', Number(rowEmp?.classStatus) === 7, `${rowEmp?.classStatusName}`);

  /* ---------- 5. 统计卡片计数 ---------- */
  const sum = await api('GET', '/api/teaching/class/summary?stage=job', null, token);
  const s = (sum.data || []).find((x) => x.stage === 'job') || {};
  check('统计卡片出现「已就业」计数', Number(s.employedCount) >= 1, `实训${s.trainingCount} 待就业${s.waitEmployCount} 已就业${s.employedCount}`);

  /* ---------- 6. 状态筛选能筛到 ---------- */
  const flt = await api('GET', '/api/teaching/class/list?stage=job&classStatus=7&size=50', null, token);
  check(
    '按「已就业」筛选能查到该班',
    (flt.data?.list || []).some((r) => r.classId === target.classId),
    `筛出 ${flt.data?.total} 条`,
  );

  /* ---------- 7. 系统态不允许手工改 ---------- */
  const bad = await api(
    'POST',
    '/api/teaching/class/save',
    { stage: 'job', id: target.classId, className: target.className, classStatus: 5 },
    token,
  );
  check('拒绝把班级状态手工改成「实训」', bad.code !== 200, bad.message || '');

  console.log(fails.length ? `\nFAILED ${fails.length} 项：${fails.join(' | ')}` : '\nALL PASS');
  process.exitCode = fails.length ? 1 : 0;
})();
