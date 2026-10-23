/**
 * 回归验证：学生档案【已就业】接口（2026-10-21 批注 ②）
 * ============================================================
 * 只验接口层（UI 层见 tools/_verify-employment-workflow.mjs）：
 *   · POST /api/teaching/student/confirm-employed 把学生状态改成 10
 *   · 同一个学生再调一次 → 被拒绝（终态，不可重复 / 不可逆）
 *   · 列表按「已就业」筛能查到该生
 *   · 结束后**还原**成原状态（直接走 save），保证不改动 demo 数据
 *
 * 用法：node tools/_verify-employed-api.mjs   （后端需在跑：8004）
 */
const BASE = 'http://localhost:8004';
const ACC = process.env.VERIFY_ACC || 'qiansy';
const PWD = process.env.VERIFY_PWD || '123456';

const fails = [];
const check = (n, ok, d = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  → ' + d : ''}`); if (!ok) fails.push(n); };

const api = async (method, url, body, token) => {
  const r = await fetch(BASE + url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await r.json().catch(() => ({}));
  return json;
};

(async () => {
  const login = await api('POST', '/api/portal/account/login', { account: ACC, password: PWD });
  check('登录成功', login.code === 200, login.message || '');
  const token = login.data?.token || login.data?.accessToken;
  check('拿到 token', !!token);
  if (!token) { console.log('\nFAILED: 登录失败，后续跳过'); process.exitCode = 1; return; }

  // 取一个「实训中」的学生（升实训后的状态，最贴近真实场景）
  const list = await api('GET', '/api/teaching/student/list?stage=job&size=50', null, token);
  const rows = list.data?.list || [];
  check('能查到就业部学生', rows.length > 0, `共 ${rows.length} 人`);
  const target = rows.find((r) => Number(r.studentStatus) === 8) || rows[0];
  if (!target) { console.log('  没有可用的学生样本，退出'); process.exitCode = 1; return; }
  console.log(`  样本：${target.studentName}（${target.studentNo}）原状态=${target.studentStatusName}`);

  const before = await api('GET', `/api/teaching/student/detail?stage=job&id=${target.studentId}`, null, token);
  const origin = {
    studentName: before.data?.base?.studentName ?? target.studentName,
    gender: before.data?.base?.gender ?? target.gender ?? 1,
    deptCode: before.data?.base?.deptCode ?? 3,
    studentStatus: Number(before.data?.base?.studentStatus ?? target.studentStatus),
  };

  const r1 = await api('POST', '/api/teaching/student/confirm-employed', { stage: 'job', id: target.studentId }, token);
  check('第一次标记「已就业」成功', r1.code === 200, r1.message || '');
  check('返回里带原状态名 → 新状态名', !!r1.data?.fromStatusName && r1.data?.toStatusName === '已就业', JSON.stringify(r1.data));

  const afterList = await api('GET', '/api/teaching/student/list?stage=job&size=50', null, token);
  const afterRow = (afterList.data?.list || []).find((r) => r.studentId === target.studentId);
  check('列表里该生状态已是「已就业」', Number(afterRow?.studentStatus) === 10, afterRow?.studentStatusName || '');

  const filtered = await api('GET', '/api/teaching/student/list?stage=job&studentStatus=10&size=50', null, token);
  check('按「已就业」筛选能查到该生',
    (filtered.data?.list || []).some((r) => r.studentId === target.studentId),
    `筛出 ${(filtered.data?.list || []).length} 人`);

  const r2 = await api('POST', '/api/teaching/student/confirm-employed', { stage: 'job', id: target.studentId }, token);
  check('重复标记被拒绝（终态不可重复）', r2.code !== 200, `${r2.code} ${r2.message || ''}`);

  // 还原（save 只覆盖传了值的字段，这里把这几个字段写回原值）
  const restore = await api('POST', '/api/teaching/student/save', {
    stage: 'job',
    id: target.studentId,
    studentName: origin.studentName,
    gender: origin.gender,
    deptCode: origin.deptCode,
    studentStatus: origin.studentStatus,
  }, token);
  check('已还原为原状态', restore.code === 200, restore.message || '');
  const back = await api('GET', `/api/teaching/student/detail?stage=job&id=${target.studentId}`, null, token);
  check('还原后状态与原来一致', Number(back.data?.base?.studentStatus) === origin.studentStatus,
    `${back.data?.base?.studentStatusName}（原 ${target.studentStatusName}）`);

  /* ================= 升就业（批注 ⑤）：实训班学生状态 → 待就业 ================= */
  console.log('\n[升就业 · 实训班 → 待就业]');
  const cls = await api('GET', '/api/teaching/class/list?stage=job&size=50', null, token);
  const jobClass = (cls.data?.list || []).find((c) => Number(c.studentCount) > 0);
  check('能找到有学生的实训班', !!jobClass, jobClass ? `${jobClass.className}（${jobClass.studentCount} 人）` : '');
  if (jobClass) {
    const roster = await api('GET', `/api/teaching/class/roster?stage=job&id=${jobClass.classId}`, null, token);
    const rs = roster.data || [];
    const backup = rs.map((x) => ({ id: x.studentId, name: x.studentName, gender: x.gender || 1, status: Number(x.studentStatus) }));
    console.log(`  花名册 ${rs.length} 人，状态：${[...new Set(rs.map((x) => x.studentStatusName))].join(' / ')}`);

    const up = await api('POST', '/api/teaching/class/employment-upgrade', { classId: jobClass.classId }, token);
    check('升就业接口返回成功', up.code === 200, up.message || '');
    check('有学生被改成「待就业」', Number(up.data?.updated) > 0, `updated=${up.data?.updated} skipped=${up.data?.skipped}`);

    const roster2 = await api('GET', `/api/teaching/class/roster?stage=job&id=${jobClass.classId}`, null, token);
    const rs2 = roster2.data || [];
    check('花名册状态全部是「待就业 / 已就业」',
      rs2.every((x) => [9, 10].includes(Number(x.studentStatus))),
      JSON.stringify([...new Set(rs2.map((x) => x.studentStatusName))]));

    const up2 = await api('POST', '/api/teaching/class/employment-upgrade', { classId: jobClass.classId }, token);
    check('重复升就业不会报错（全部跳过）', up2.code === 200 && Number(up2.data?.updated) === 0, `updated=${up2.data?.updated}`);

    // 还原：逐个写回原状态
    let restored = 0;
    for (const b of backup) {
      const r = await api('POST', '/api/teaching/student/save', {
        stage: 'job', id: b.id, studentName: b.name, gender: b.gender, deptCode: 3, studentStatus: b.status,
      }, token);
      if (r.code === 200) restored++;
    }
    check('花名册学生状态已还原', restored === backup.length, `${restored}/${backup.length}`);
    const roster3 = await api('GET', `/api/teaching/class/roster?stage=job&id=${jobClass.classId}`, null, token);
    check('还原后花名册状态与原来一致',
      (roster3.data || []).every((x, i) => Number(x.studentStatus) === backup[i].status),
      JSON.stringify((roster3.data || []).map((x) => x.studentStatusName)));
  }

  console.log(`\n${fails.length ? 'FAILED: ' + fails.join(' / ') : 'ALL PASS'}`);
  process.exitCode = fails.length ? 1 : 0;
})().catch((e) => { console.error('脚本异常：', e.message); process.exitCode = 1; });
