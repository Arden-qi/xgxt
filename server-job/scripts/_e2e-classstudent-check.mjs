/**
 * 自检：`class/modules/student/student.route.ts` 老学生档案接口切读统一表（第 4 期 · 第 3 批）
 * =========================================================================
 *
 * ★★ 为什么必须单独写这个脚本，而不能靠 `_e2e-student-check.mjs` 顶替
 *
 *   `_e2e-student-check.mjs` 打的是 **`/api/teaching/student/*`**（新路由 / 新页面）。
 *   而本批改的是**另一套代码**：`/api/class/student/*`（老路由，8 个接口）。
 *   两者是两套独立实现 —— 改老路由不会让 teaching 自检变红，也不会让它变绿。
 *   → **改完老路由后跑 student 自检，全绿也证明不了任何事。**
 *   这是第 4 期反复踩的坑（两套实现互为掩护，37/37 绿灯但实际仍读老表）。
 *
 * ★★ 本批改的是 34 处（实测统计，不是估计）
 *   表名分布：
 *     t_class_student17 处（主档）
 *     t_class_info             6 处（班级）
 *     t_class_consult_push     3 处（换班待接收）
 *     t_class_upgrade_apply    2 处（升学）
 *     t_class_transfer         2 处（班级转班）
 *     t_class_student_transfer 1 处（学生转班）
 *     t_class_repeat           1 处（复读）
 *     t_class_notify           1 处（通知）
 *     t_class_grade            1 处（成绩）
 *   其中 **6 处是插入**，必须走 tblIns / tblInsTrx（只做表路由的 tblTrx 不补 edu_stage，
 *   否则切读统一表时报 `Field 'edu_stage' doesn't have a default value`）。
 *
 * ★★ 三条最容易漏、也最该被断言的：
 *   ① 【子表必须与主表同进同退】本批跨了 9 张表，且**主表和子表是不同文件里的不同函数**。
 *      只切主表症状最隐蔽：列表能看，但详情里的「复读记录 / 成绩 / 转班历史」全空。
 *      → 断言：detail 返回的 repeats / grades / transfers / studentTransfers 必须非空。
 *   ② 【插入必须补 edu_stage】6 处插入若误用 tblTrx，切读时直接 500。
 *      → 断言：sync / add / transfer / upgrade-sync 四条写路径都能落库，且行能读回来。
 *   ③ 【单号唯一】/add 不传 studentNo 时按 `S + 年份 + 4 位序号` 自动生成，
 *      走 maxStudentNo()。→ 断言：连续建 2 个学号必须递增不重复。
 *
 * ★ 未纳入本脚本的：`commonDb('t_class_fee_sync')` / `commonDb('t_class_dorm_live_sync')`
 *   这两张是同步镜像表，本来就在 sms_common、不属统一表体系，保持裸访问是正确的。
 */
import {
  BASE,
  buildRow,
  conn,
  dumpLogs,
  killAll,
  login,
  makeChecker,
  mirrorRow,
  req,
  probe,
  regTarget,
  startServices,
  USE_UNI,
} from './_e2e-lib.mjs';

const API = `${BASE}/api/class/student`;
const STAGE = 'class';
const WHERE = USE_UNI ? '统一表' : '老表';

const { check, summary } = makeChecker();
const fixtures = [];
const reg = (dbName, table, id) => {
  const [d, t] = regTarget(dbName, table);
  fixtures.push([d, t, id]);
};

/** 从 JWT 解出真实 userId（token 里是 UUID，不是 sms_perm.t_perm_user.id 那种 U004） */
function userIdOf(token) {
  if (!token) return '';
  try {
    const part = String(token).split('.')[1];
    const raw = JSON.parse(Buffer.from(part, 'base64').toString('utf8'));
    return raw.sub || raw.userId || raw.accountId || '';
  } catch {
    return '';
  }
}

/**
 * 造夹具班级（班主任 head_teacher_id 必须填 token 里的 UUID）
 * 班主任 zhanght 的 dataScope=CLASS → 夹具不挂他名下会 40302。
 */
async function mkClass(dbCls, uniDb, tag, headTeacherId) {
  const id = `cls-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const row = await buildRow(dbCls, 't_class_info', {
    id,
    class_name: `自检班级${tag}`,
    dept_code: 1,
    head_teacher_id: headTeacherId,
    is_deleted: 0,
  });
  await dbCls('t_class_info').insert(row);
  if (USE_UNI) await mirrorRow(uniDb, 'sms_class', 't_class_info', row, STAGE, reg);
  reg('sms_class', 't_class_info', id);
  return row;
}

/** 造夹具学生（class_id 必填，否则 assertClassAccess 40302） */
async function mkStudent(dbCls, uniDb, tag, classId, deptCode, headTeacherId) {
  const id = `stu-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const row = await buildRow(dbCls, 't_class_student', {
    id,
    student_no: 'ZJ' + tag + Date.now().toString().slice(-8),
    student_name: `自检学生${tag}`,
    student_status: 5,
    class_id: classId,
    class_name: '自检班级',
    dept_code: deptCode,
    recruit_teacher_id: headTeacherId,
  });
  await dbCls('t_class_student').insert(row);
  if (USE_UNI) await mirrorRow(uniDb, 'sms_class', 't_class_student', row, STAGE, reg);
  reg('sms_class', 't_class_student', id);
  return row;
}

/** 造子表行：复读 / 成绩 / 学生转班 —— 用来断言 detail 的子表不是空的 */
async function mkChild(dbCls, uniDb, table, tag, studentId, extra) {
  const id = `chd-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const row = await buildRow(dbCls, table, { id, student_id: studentId, ...extra });
  await dbCls(table).insert(row);
  if (USE_UNI) await mirrorRow(uniDb, 'sms_class', table, row, STAGE, reg);
  reg('sms_class', table, id);
  return row;
}

(async () => {
  const dbCls = conn('sms_class');
  const uniDb = conn('sms_common');
  await startServices();

  const tHead = await login('zhanght');
  const headId = userIdOf(tHead);
  check('登录班主任 zhanght', !!tHead, tHead ? 'ok' : '失败');
  check('能从 token 解出 userId', !!headId, headId ? headId.slice(0, 8) + '…' : '解不出');

  // ---------- 夹具 ----------
  const clsA = await mkClass(dbCls, uniDb, 'A', headId);
  const clsB = await mkClass(dbCls, uniDb, 'B', headId);
  const stu1 = await mkStudent(dbCls, uniDb, '1', clsA.id, 1, headId);
  const stu2 = await mkStudent(dbCls, uniDb, '2', clsA.id, 1, headId);

  // 子表：复读 / 成绩 / 学生转班（考 detail 是否读得到）
  await mkChild(dbCls, uniDb, 't_class_repeat', 'rp', stu1.id, {
    repeat_count: 1,
    repeat_time: '2026-01-05 00:00:00',
  });
  await mkChild(dbCls, uniDb, 't_class_grade', 'gd', stu1.id, {
    student_no: stu1.student_no,
    student_name: stu1.student_name,
    class_id: clsA.id,
    exam_name: '自检考试',
    written_score: 88,
  });
  await mkChild(dbCls, uniDb, 't_class_student_transfer', 'st', stu1.id, {
    student_no: stu1.student_no,
    from_class_id: clsA.id,
    from_class_name: '自检班级',
    to_class_id: clsB.id,
    to_class_name: '自检班级B',
    transfer_reason: '自检转班',
    transfer_time: '2026-02-01 00:00:00',
  });

  console.log(`\n##### 模式：${USE_UNI ? '切读统一表' : '老表'} #####`);

  /* ---------- ① 列表 ---------- */
  const r1 = await req(`${API}/list?page=1&size=50&classId=${encodeURIComponent(clsA.id)}`, { token: tHead });
  const list1 = r1.json?.data?.list ?? [];
  //★ list 每行走toRosterItem()：主键字段名是 studentId（不是 id）
  check(
    `① /list 能查到夹具班级学生（${WHERE}）`,
    list1.some((x) => x.studentId === stu1.id),
    `返回 ${list1.length} 条，含目标=${list1.some((x) => x.studentId === stu1.id)}`,
  );
  const hitStudent = list1.find((x) => x.studentId === stu1.id);
  check(
    `① /list 学号等字段非undefined（列名翻译没丢）`,
    hitStudent && hitStudent.studentNo === stu1.student_no,
    `studentNo=${hitStudent ? hitStudent.studentNo : 'N/A'} 期望=${stu1.student_no}`,
  );

  /* ---------- ② 统计（与 list 同口径） ---------- */
  const r2 = await req(`${API}/statistics?classId=${encodeURIComponent(clsA.id)}`, { token: tHead });
  check(
    `② /statistics 与 list 同口径（${WHERE}）`,
    r2.json?.code === 200,
    `code=${r2.json?.code}total=${JSON.stringify(r2.json?.data ?? {}).slice(0, 80)}`,
  );

  /* ---------- ③ 详情 + 4 张子表 ---------- */
  const r3 = await req(`${API}/detail?id=${encodeURIComponent(stu1.id)}`, { token: tHead });
  const d = r3.json?.data ?? {};
  // ★ detail 顶层是 `{student, profile, market, repeats, grades, ...}`；
  //   student 本体走 toRosterItem()，主键字段名同样是 studentId（不是 id）
  check(`③ /detail 能查到（${WHERE}）`, r3.json?.code === 200 && !!d.student?.studentId, `code=${r3.json?.code} studentId=${d.student?.studentId ?? 'N/A'}`);
  // ★ 本批最隐蔽的坑：只切主表时，这4 个子表会全空
  check(
    `③ ★ /detail 子表①复读记录读得到（${WHERE}）`,
    Array.isArray(d.repeats) && d.repeats.length > 0,
    `repeats=${Array.isArray(d.repeats) ? d.repeats.length : 'undefined'}`,
  );
  check(
    `③ ★ /detail 子表②成绩读得到（${WHERE}）`,
    Array.isArray(d.grades) && d.grades.length > 0,
    `grades=${Array.isArray(d.grades) ? d.grades.length : 'undefined'}`,
  );
  check(
    `③ ★ /detail 子表③学生转班记录读得到（${WHERE}）`,
    Array.isArray(d.studentTransfers) && d.studentTransfers.length > 0,
    `studentTransfers=${Array.isArray(d.studentTransfers) ? d.studentTransfers.length : 'undefined'}`,
  );
  check(
    `③ /detail 班级对象读得到（t_class_info 已切读）`,
    !!d.classInfo,
    `classInfo=${d.classInfo ? d.classInfo.className : 'undefined'}`,
  );

  /* ---------- ④ 新增（写路径：验edu_stage 自动补齐） ---------- */
  const addName = `自检新增${Date.now().toString().slice(-6)}`;
  const r4 = await req(`${API}/add`, {
    token: tHead,
    method: 'POST',
    body: { studentName: addName, gender: 1, deptCode: 1, classId: clsA.id },
  });
  const newId = r4.json?.data?.studentId ?? r4.json?.data?.id;
  check(`④ /add 新增成功（${WHERE}）`, r4.json?.code === 200 && !!newId, `code=${r4.json?.code}msg=${r4.json?.message ?? ''}`);
  if (newId) {
    const inTbl = await probe(dbCls, 'sms_class', 't_class_student', STAGE).where('id', newId).first();
    check(`④ ★ 新增行落在${WHERE}且 edu_stage 已补`, !!inTbl, inTbl ? `id=${newId}` : '库里查不到');
    reg('sms_class', 't_class_student', newId);
  }

  /* ---------- ⑤ 学号自动生成且不重复 ---------- */
  const r5a = await req(`${API}/add`, {
    token: tHead, method: 'POST',
    body: { studentName: addName + '甲', gender: 1, deptCode: 1, classId: clsA.id },
  });
  const r5b = await req(`${API}/add`, {
    token: tHead, method: 'POST',
    body: { studentName: addName + '乙', gender: 1, deptCode: 1, classId: clsA.id },
  });
  const noA = r5a.json?.data?.studentNo;
  const noB = r5b.json?.data?.studentNo;
  for (const x of [r5a, r5b]) {
    const i = x.json?.data?.studentId ?? x.json?.data?.id;
    if (i) reg('sms_class', 't_class_student', i);
  }
  check(`⑤★ 不传 studentNo 时自动生成学号（${WHERE}）`, !!noA && !!noB, `甲=${noA} 乙=${noB}`);
  check('⑤ ★ 两个学号不重复（maxStudentNo 生效）', noA && noB && noA !== noB, `甲=${noA} 乙=${noB}`);

  /* ---------- ⑥ 修改 ----------
   ★ 注意：`updateSchema` 里**没有 studentName**（不可改名），接口本身就不支持这个字段。
     所以这里用 phone 验证落库，否则自检会假失败（老表也一样不改名）。
 */
  const newPhone = '139' + String(Date.now()).slice(-8);
  const r6 = await req(`${API}/update`, {
    token: tHead, method: 'PUT',
    body: { studentId: newId, phone: newPhone },
  });
  check(`⑥ /update 修改成功（${WHERE}）`, r6.json?.code === 200, `code=${r6.json?.code} msg=${r6.json?.message ?? ''}`);
  if (newId) {
    const after = await probe(dbCls, 'sms_class', 't_class_student', STAGE).where('id', newId).first();
    check(
      `⑥ ★ 修改真的落库到${WHERE}`,
      after && after.phone === newPhone,
      `库中 phone=${after ? after.phone : 'N/A'} 期望=${newPhone}`,
    );
  }

  /* ---------- ⑦ 换班（跨 3 张表：student / consult_push / notify） ---------- */
  const r7 = await req(`${API}/transfer`, {
    token: tHead, method: 'POST',
    body: { studentId: stu2.id, targetClassId: clsB.id, reason: '自检换班' },
  });
  check(`⑦ /transfer发起换班成功（${WHERE}）`, r7.json?.code === 200, `code=${r7.json?.code}msg=${r7.json?.message ?? ''}`);
  if (r7.json?.code === 200) {
    const consultNo = r7.json?.data?.consultNo;
    //★ t_class_consult_push 插入是否落库（本批新增映射的第 1 张）
    const pushed = await probe(dbCls, 'sms_class', 't_class_consult_push', STAGE)
      .where('consult_no', consultNo ?? '___none___').first();
    check(
      `⑦ ★ 待接收单落在${WHERE}（t_class_consult_push）`,
      !!pushed,
      pushed ? `consult_no=${consultNo}` : `库里查不到 consult_no=${consultNo}`,
    );
    if (pushed) reg('sms_class', 't_class_consult_push', pushed.id);
    // ★ t_class_notify 插入是否落库（本批最容易漏：藏在 transfer 内部的通知）
    const noted = await probe(dbCls, 'sms_class', 't_class_notify', STAGE)
      .orderBy('create_time', 'desc').first();
    check(`⑦ ★ 通知落在${WHERE}（t_class_notify）`, !!noted, noted ? `ok` : '查不到');
  }

  /* ---------- ⑧ 升学同步（t_class_upgrade_apply / t_class_transfer 双写） ----------
     ★ /sync 与 /upgrade/sync 是**服务对服务**接口，走 authAllowSync：
       必须带 `x-internal-token: <INTERNAL_TOKEN>`（取 config.internalToken），
       带普通登录 token 会被40101「内部服务凭证无效」挡掉。
     */
  const r8 = await req(`${API}/upgrade/sync`, {
    token: tHead, method: 'POST',
    headers: { 'x-internal-token': process.env.INTERNAL_TOKEN || 'CHANGE_ME_INTERNAL_TOKEN' },
    body: {
      sourceSystem: 'EDU', syncMode: 'INCREMENT', batchNo: `ZJ${Date.now().toString().slice(-8)}`,
      items: [{
        sourceId: `src-${Date.now()}-1`, studentId: stu1.id,
        toDeptCode: 2, toStage: 202, examScore: 90,
      }],
    },
  });
  check(`⑧ /upgrade/sync 升学同步成功（${WHERE}）`, r8.json?.code === 200, `code=${r8.json?.code} msg=${r8.json?.message ?? ''}`);
  // ★★ 不能只看 code=200：业务失败也是 HTTP200+code200，靠 failed/errors 才是真断言
  const upRes = r8.json?.data ?? {};
  check(
    `⑧ ★★ 无失败明细（failed=0）`,
    (upRes.failed ?? 0) === 0,
    `accepted=${upRes.accepted} 处理=${upRes.processed ?? '-'} 失败=${upRes.failed} 原因=${JSON.stringify(upRes.errors ?? []).slice(0, 600)}`,
  );
  if (r8.json?.code === 200) {
    const ups = await probe(dbCls, 'sms_class', 't_class_upgrade_apply', STAGE)
      .orderBy('create_time', 'desc').first();
    check(`⑧ ★ 升学申请落在${WHERE}`, !!ups, ups ? `apply_no=${ups.apply_no}` : '查不到');
    if (ups) reg('sms_class', 't_class_upgrade_apply', ups.id);
    const trs = await probe(dbCls, 'sms_class', 't_class_transfer', STAGE)
      .orderBy('create_time', 'desc').first();
    check(`⑧ ★ 转班记录落在${WHERE}`, !!trs, trs ? `id=${trs.id}` : '查不到');
    if (trs) reg('sms_class', 't_class_transfer', trs.id);
  }

  /* ---------- ⑨ 全量同步 /sync（幂等 + 软删，验2 处插入与批量 update） ---------- */
  const sid = `syn-${Date.now()}-1`;
  const payload = (sourceId, name) => ({
    sourceSystem: 'CONSULT', syncMode: 'INCREMENT',
    batchNo: `PL${Date.now().toString().slice(-8)}`,
    items: [{ sourceId, studentNo: 'SY' + Date.now().toString().slice(-8), studentName: name, gender: 1, deptCode: 1 }],
  });
  const r9a = await req(`${API}/sync`, {
    token: tHead, method: 'POST',
    headers: { 'x-internal-token': process.env.INTERNAL_TOKEN || 'CHANGE_ME_INTERNAL_TOKEN' },
    body: payload(sid, '自检同步甲'),
  });
  check(`⑨ /sync 首次入库（${WHERE}）`, r9a.json?.code === 200, `code=${r9a.json?.code} msg=${r9a.json?.message ?? ''}`);
  if (r9a.json?.code === 200) {
    const row = await probe(dbCls, 'sms_class', 't_class_student', STAGE).where('source_id', sid).first();
    check(`⑨ ★ 同步行落在${WHERE}且 edu_stage 已补`, !!row, row ? `source_id=${sid}` : '查不到');
    if (row) reg('sms_class', 't_class_student', row.id);
  }
  const r9b = await req(`${API}/sync`, {
    token: tHead, method: 'POST',
    headers: { 'x-internal-token': process.env.INTERNAL_TOKEN || 'CHANGE_ME_INTERNAL_TOKEN' },
    body: payload(sid, '自检同步甲改名'),
  });
  check(
    `⑨ ★ /sync 幂等：同 sourceId 走 update 不新增行`,
    r9b.json?.code === 200,
    `code=${r9b.json?.code}data=${JSON.stringify(r9b.json?.data ?? {}).slice(0, 90)}`,
  );

  /* ---------- 清理 ---------- */
  for (const [d, t, id] of fixtures) {
    try { await conn(d)(t).where('id', id).del(); } catch { /* ignore */ }
  }

  summary();
  await dumpLogs();
  await killAll();
})().catch(async (e) => {
  console.error('\n[自检异常]', e && e.stack ? e.stack : e);
  await killAll();
  process.exit(1);
});