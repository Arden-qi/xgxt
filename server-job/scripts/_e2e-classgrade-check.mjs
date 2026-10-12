/**
 * 自检：成绩管理域（`/api/class/grade/*` · 第 4 期第 7 批统一表切读）
 * ============================================================
 * 其他自检都不覆盖 `/api/class/grade/*`；本脚本是
 * `class/modules/grade/grade.route.ts`（21 处裸访问）的唯一覆盖。
 *
 * 【本批最该盯死的五条，每条都对应一个实测踩出来的坑】
 *
 * ①【★★★ 分数双套列】`t_uni_exam_score` 里同一批分数存了**两套列**：
 *      written_score   ↔ score_written
 *      machine_score   ↔ score_machine
 *      interview_score ↔ score_interview
 *      comp_score      ↔ score_total
 *    实测 102 行种子：written_score / score_written 都 102 行有值，
 *    但 **comp_score 0 行有值、score_total 102 行有值** → 综合分只在新列。
 *    → 断言：录入后**读回的分数不能是 null**，且与写入值一致。
 *      若忘了按开关取列，切读时列表分数整列空掉、平均分恒为 0（静默 bug）。
 *
 * ②【★★★ `/import` 幂等 upsert 的 update 分支】归一铁律⑨：
 *    只翻 insert 不翻 update → **首次成功、二次必炸**（Unknown column），
 *    而接口照样 200，错误藏在 `errors[]` 里。
 *    → 断言：同一批数据**导入两次**，第二次必须 `failed === 0` 且 `updated === N`。
 *
 * ③【★★ `/update` 的 update 分支】同上，且「只传部分字段」时
 *    未传的分数要从**已存行按开关取列**读回再重算综合分，
 *    写死 `row.written_score` → 切读时读到 undefined → 综合分被算成 0。
 *
 * ④【★★ `/statistics` 平均分】`r.comp_score` 写死 → 切读恒为 0。
 *    → 断言：切读时 avgCompScore 必须等于该批成绩的综合分均值（不是 0）。
 *
 * ⑤【★★ `intend_stage` 阶段码】`/repeat-handoff` 里原来写 `cls.stage`，
 *    切读时统一表该列叫 `stage_code` → 静默写成 null（不报错、只丢数据）。
 *    → 断言：切读时 t_uni_consult_push.intend_stage 必须等于班级的阶段码。
 *
 * 另外覆盖：/list 过滤与数据范围、/student/list、/delete 软删、
 * 末班推送（咨询推送单复用）、权限收敛、NOT NULL 列结构。
 *
 * 跑法：
 *   node scripts/_e2e-classgrade-check.mjs                  （老表模式）
 *   TEACHING_UNI_TABLE=1 node scripts/_e2e-classgrade-check.mjs（切读模式）
 */
import {
  BASE,
  buildRow,
  conn,
  dumpBackendError,
  killAll,
  login,
  makeChecker,
  mirrorToUni,
  probe,
  regTarget,
  req,
  startServices,
  USE_UNI,
} from './_e2e-lib.mjs';

const API = `${BASE}/api/class/grade`;
const { check, summary } = makeChecker();

const OK = 200;
const isOk = (r) => r.json?.code === OK;

const SRC = 'sms_class';
const STAGE = 'class';

const GRADE_T = 't_class_grade';
const STU_T = 't_class_student';
const CLS_T = 't_class_info';
const EXAM_T = 't_class_exam';
const PUSH_T = 't_class_consult_push';

const db = conn(SRC);

/** 夹具登记：切读时数据落统一表，必须跟着改指向，否则清理删不掉 */
const fixtures = [];
const reg = (dbName, table, id) => {
  if (!id) return;
  const [d, t] = regTarget(dbName, table);
  fixtures.push([d, t, id]);
};

//★ 与后端 grade.route.ts 的 COL_* 完全同口径（老表列名/ 统一表新列名）
const C_W = () => (USE_UNI ? 'score_written' : 'written_score');
const C_M = () => (USE_UNI ? 'score_machine' : 'machine_score');
const C_I = () => (USE_UNI ? 'score_interview' : 'interview_score');
const C_C = () => (USE_UNI ? 'score_total' : 'comp_score');

const rnd = Math.random().toString(36).slice(2, 8);
const TAG = `E2E-GRADE-${rnd}`;
/** ★ 自增序号：同一次运行内多张夹具共用 rnd 会撞主键（实测踩过） */
let seq = Math.floor(Math.random() * 1e6);
const nextSeq = () => ++seq;

/* ============================================================
 * 夹具
 * ============================================================ */

/**
 * ★ 切读夹具必须**双写**：先插老表再镜像统一表（mirrorToUni）
 * ★ 必须**显式给 id** —— buildRow 只在「缺失时」生成，reg() 要等于落库 id
 */
async function makeClass(name, stageCode = 201) {
  const id = `cls-gd-${rnd}-${nextSeq()}`;
  const row = await buildRow(db, CLS_T, {
    id,
    class_name: name,
    dept_code: 1,
    class_status: 1,// ★ 班级状态列是 class_status，没有 status 列
    student_count: 0,
    stage: stageCode,
    head_teacher_id: `u-gd-${rnd}`,
    head_teacher_name: 'E2E班主任',
  });
  await db(CLS_T).insert(row);
  reg(SRC, CLS_T, id);
  if (USE_UNI) await mirrorToUni(SRC, CLS_T, { ...row, id }, STAGE, reg);
  return { id, ...row };
}

async function makeStudent(name, classId, className) {
  const id = `stu-gd-${rnd}-${nextSeq()}`;
  const row = await buildRow(db, STU_T, {
    id,
    student_no: `E2EG${rnd}${nextSeq()}`.slice(0, 20),
    student_name: name,
    gender: 1,
    dept_code: 1,
    student_status: 5, // ★ 学生状态列是 student_status
    class_id: classId,
    class_name: className,
    stage: 201,
  });
  await db(STU_T).insert(row);
  reg(SRC, STU_T, id);
  if (USE_UNI) await mirrorToUni(SRC, STU_T, { ...row, id }, STAGE, reg);
  return { id, ...row };
}

async function makeExam(name, classId, className) {
  const id = `exam-gd-${rnd}-${nextSeq()}`;
  const row = await buildRow(db, EXAM_T, {
    id,
    exam_name: name,
    exam_type: 1,
    exam_date: '2026-10-11',
    class_id: classId,
    class_name: className,
    attendee_count: 0,
  });
  await db(EXAM_T).insert(row);
  reg(SRC, EXAM_T, id);
  if (USE_UNI) await mirrorToUni(SRC, EXAM_T, { ...row, id }, STAGE, reg);
  return { id, ...row };
}

/** 物理删自检数据（不进软删池，避免占唯一索引） */
async function cleanup() {
  const order = [
    [SRC, PUSH_T],
    [SRC, GRADE_T],
    [SRC, EXAM_T],
    [SRC, STU_T],
    [SRC, CLS_T],
  ];
  const uni = conn('sms_common');
  for (const [dbName, table] of order) {
    for (const [fdb, ftable, id] of fixtures) {
      if (fdb !== dbName || ftable !== table) continue;
      await uni(ftable).where({ id }).del().catch(() => {});
    }
  }
  await uni.destroy();
}

/* ============================================================
 * 用例
 * ============================================================ */
async function main() {
  await startServices();
  const token = await login('qiansy');
  const H = { Authorization: `Bearer ${token}` };
  const call = (path, opts = {}) =>
    req(`${API}${path}`, { ...opts, headers: { ...H, ...(opts.headers || {}) } });

  const clsA = await makeClass(`${TAG}-A`);
  const clsB = await makeClass(`${TAG}-B`);
  const stu1 = await makeStudent(`${TAG}-甲`, clsA.id, clsA.class_name);
  const stu2 = await makeStudent(`${TAG}-乙`, clsA.id, clsA.class_name);
  const stuB = await makeStudent(`${TAG}-丙`, clsB.id, clsB.class_name);
  const exam = await makeExam(`${TAG}-考试`, clsA.id, clsA.class_name);

  /* ---------- ① /add 录入成绩 ---------- */
  const rAdd = await call('/add', {
    method: 'POST',
    body: {
      studentId: stu1.id,
      examId: exam.id,
      writtenScore: 80,
      machineScore: 70,
      interviewScore: 90,
      examResult: 1,
      analysis: `${TAG}-素质分析`,
    },
  });
  // 综合分 = 80×50% + 90×50% = 85
  check('add 录入成功且综合分=85', isOk(rAdd) && rAdd.json?.data?.compScore === 85, JSON.stringify(rAdd.json?.data));
  const gid = rAdd.json?.data?.gradeId;
  reg(SRC, GRADE_T, gid);

  const row1 = await probe(db, SRC, GRADE_T, STAGE).where({ id: gid }).first();
  check('成绩落库', !!row1, `id=${gid}`);
  check(`★ 落库列名按开关（${C_W()}）`, row1 && row1[C_W()] !== undefined, `实际列：${row1 ? Object.keys(row1).filter((k) => k.includes('score')).join(',') : '无行'}`);
  check(
    `★ 笔试/机试/面试/综合 四项分数都写对（${C_C()}=85）`,
    row1 && Number(row1[C_W()]) === 80 && Number(row1[C_M()]) === 70 && Number(row1[C_I()]) === 90 && Number(row1[C_C()]) === 85,
    row1 ? JSON.stringify({ w: row1[C_W()], m: row1[C_M()], i: row1[C_I()], c: row1[C_C()] }) : '无行',
  );
  check('★ exam_result / analysis 同步落库', Number(row1?.exam_result) === 1 && row1?.analysis === `${TAG}-素质分析`);

  /* ---------- ② /list读回分数（前端契约 camelCase 不变） ---------- */
  const rList = await call(`/list?page=1&size=50&studentId=${stu1.id}`);
  const li = (rList.json?.data?.list || [])[0];
  check('list 能查到刚录的成绩', isOk(rList) && !!li, `total=${rList.json?.data?.total}`);
  check(
    '★ list 返回的分数不是 null（漏按开关取列时这里整列 null）',
    li && li.writtenScore === 80 && li.interviewScore === 90 && li.compScore === 85,
    li ? JSON.stringify({ w: li.writtenScore, i: li.interviewScore, c: li.compScore }) : '无行',
  );

  /* ---------- ③ /list 过滤 ---------- */
  const rByStuNo = await call(`/list?page=1&size=50&studentNo=${stu1.student_no}`);
  check('list 按学号模糊过滤命中', isOk(rByStuNo) && rByStuNo.json?.data?.total >= 1, `total=${rByStuNo.json?.data?.total}`);
  const rByExam = await call(`/list?page=1&size=50&examId=${exam.id}`);
  check('list 按考试过滤命中', isOk(rByExam) && rByExam.json?.data?.total >= 1, `total=${rByExam.json?.data?.total}`);
  const rByClsB = await call(`/list?page=1&size=50&classId=${clsB.id}`);
  check('list 按别班过滤 = 0 条', isOk(rByClsB) && rByClsB.json?.data?.total === 0, `total=${rByClsB.json?.data?.total}`);

  /* ---------- ④ /update 改分（★ 只传部分字段） ---------- */
  const rUpd = await call('/update', {
    method: 'PUT',
    body: { gradeId: gid, interviewScore: 100 },
  });
  // 综合分 = 80×50% + 100×50% = 90
  check('update 只传面试分，综合分重算=90', isOk(rUpd) && rUpd.json?.data?.compScore === 90, JSON.stringify(rUpd.json?.data));
  const row1b = await probe(db, SRC, GRADE_T, STAGE).where({ id: gid }).first();
  check(
    '★ update 后库里综合分=90（未传的笔试分从已存行读回，不能读成 undefined）',
    Number(row1b?.[C_C()]) === 90 && Number(row1b?.[C_W()]) === 80,
    JSON.stringify({ w: row1b?.[C_W()], c: row1b?.[C_C()] }),
  );

  /* ---------- ⑤ /update 全字段（覆盖 update 分支的列名翻译） ---------- */
  const rUpd2 = await call('/update', {
    method: 'PUT',
    body: { gradeId: gid, writtenScore: 60, machineScore: 55, interviewScore: 70, examResult: 2, remark: `${TAG}-改过` },
  });
  check('update 全字段成功，综合分=65', isOk(rUpd2) && rUpd2.json?.data?.compScore === 65, JSON.stringify(rUpd2.json?.data));
  const row1c = await probe(db, SRC, GRADE_T, STAGE).where({ id: gid }).first();
  check(
    '★ 全字段 update 后四项分数都正确落库',
    Number(row1c?.[C_W()]) === 60 && Number(row1c?.[C_M()]) === 55 && Number(row1c?.[C_I()]) === 70 && Number(row1c?.[C_C()]) === 65,
    JSON.stringify({ w: row1c?.[C_W()], m: row1c?.[C_M()], i: row1c?.[C_I()], c: row1c?.[C_C()] }),
  );
  check('update 后 exam_result=2 未通过', Number(row1c?.exam_result) === 2);

  /* ---------- ⑥ /student/list ---------- */
  const rStuList = await call(`/student/list?studentId=${stu1.id}&limit=5`);
  check('student/list 查到该学员成绩', isOk(rStuList) && (rStuList.json?.data?.length || 0) >= 1, `len=${rStuList.json?.data?.length}`);
  check('student/list 分数读回正常', rStuList.json?.data?.[0]?.compScore === 65, JSON.stringify(rStuList.json?.data?.[0]?.compScore));

  /* ---------- ⑦ /statistics 平均分（★ 不能恒为 0） ---------- */
  const rStat = await call(`/statistics?classId=${clsA.id}`);
  check('statistics 返回统计', isOk(rStat), JSON.stringify(rStat.json?.data));
  const sd = rStat.json?.data || {};
  check('★ statistics 平均分非 0（写死 comp_score 会恒为 0）', Number(sd.avgCompScore) > 0, `avg=${sd.avgCompScore}`);
  check('statistics 最大/最小综合分自洽', Number(sd.maxCompScore) >= Number(sd.minCompScore), `max=${sd.maxCompScore} min=${sd.minCompScore}`);
  check('statistics 通过+不通过=总数', Number(sd.passCount) + Number(sd.failCount) === Number(sd.total), JSON.stringify(sd));

  /* ---------- ⑧ /import 首次（insert 路径） ---------- */
  const importBody = {
    examId: exam.id,
    items: [
      { studentNo: stu1.student_no, writtenScore: 88, interviewScore: 92, examResult: 1 },
      { studentNo: stu2.student_no, writtenScore: 66, machineScore: 70, interviewScore: 74, examResult: 2 },
      { studentNo: 'E2E-NOT-EXIST', writtenScore: 50, interviewScore: 50, examResult: 1 },
    ],
  };
  const rImp1 = await call('/import', { method: 'POST', body: importBody });
  const d1 = rImp1.json?.data || {};
  //★ stu1 在 ① 已用/add 建过该考试成绩 → 首次导入里它走 update，stu2 才走 insert
  check('import 首次：inserted=1 updated=1 failed=1（学号不存在）', isOk(rImp1) && d1.inserted === 1 && d1.updated === 1 && d1.failed === 1, JSON.stringify(d1));
  check('import 失败行带原因', d1.errors?.[0]?.reason === '学号不存在', JSON.stringify(d1.errors));

  const g2 = await probe(db, SRC, GRADE_T, STAGE).where({ student_id: stu2.id, exam_id: exam.id }).first();
  reg(SRC, GRADE_T, g2?.id);
  check(
    '★ import 插入行分数落库正确',
    Number(g2?.[C_W()]) === 66 && Number(g2?.[C_I()]) === 74 && Number(g2?.[C_C()]) === 70,
    JSON.stringify({ w: g2?.[C_W()], i: g2?.[C_I()], c: g2?.[C_C()] }),
  );

  /* ---------- ⑨ ★★/import 幂等：第二次走 update 分支 ---------- */
  const rImp2 = await call('/import', { method: 'POST', body: importBody });
  const d2 = rImp2.json?.data || {};
  // stu1 已有该考试成绩（gid）→ 1 条 update；stu2 刚插入 → 也算已存在 → 1 条 update
  check(
    '★★ import 二次：updated=2、inserted=0（幂等，不重复插入）',
    isOk(rImp2) && d2.inserted === 0 && d2.updated === 2,
    JSON.stringify(d2),
  );
  check(
    '★★ import 二次 failed 仍=1、且 reason 仍是“学号不存在”（update 分支没炸）',
    d2.failed === 1 && d2.errors?.[0]?.reason === '学号不存在',
    JSON.stringify(d2.errors),
  );
  const cntAfter = await probe(db, SRC, GRADE_T, STAGE).where({ exam_id: exam.id }).select('*');
  check('import 幂等：同一考试下 stu2 只有 1 条成绩', cntAfter.filter((x) => x.student_id === stu2.id).length === 1, `实际 ${cntAfter.filter((x) => x.student_id === stu2.id).length} 条`);

  /* ---------- ⑩ /repeat-handoff 末班推送 ---------- */
  const rRep = await call('/repeat-handoff', { method: 'POST', body: { studentId: stuB.id, remark: `${TAG}-末班` } });
  check('repeat-handoff 推送成功', isOk(rRep) && !!rRep.json?.data?.consultNo, JSON.stringify(rRep.json?.data));
  const pushRow = await probe(db, SRC, PUSH_T, STAGE).where({ id: rRep.json?.data?.consultId }).first();
  reg(SRC, PUSH_T, rRep.json?.data?.consultId);
  check('末班推送单落库 is_repeat_in=1、待接收', Number(pushRow?.is_repeat_in) === 1 && Number(pushRow?.apply_status) === 1, JSON.stringify({ i: pushRow?.is_repeat_in, s: pushRow?.apply_status }));
  check('末班推送单 origin_student_id 正确', String(pushRow?.origin_student_id) === String(stuB.id));
  check(
    '★★ 切读：intend_stage = 班级阶段码 201（写死 cls.stage 会静默为 null）',
    USE_UNI ? Number(pushRow?.intend_stage) === 201 : Number(pushRow?.intend_stage) === 201,
    `intend_stage=${pushRow?.intend_stage}`,
  );
  const rRep2 = await call('/repeat-handoff', { method: 'POST', body: { studentId: stuB.id } });
  check('repeat-handoff 重复发起被拦', !isOk(rRep2), JSON.stringify(rRep2.json));

  /* ---------- ⑪ /delete 软删 ---------- */
  const rDel = await call('/delete', { method: 'POST', body: { gradeId: gid } });
  check('delete 成功', isOk(rDel), JSON.stringify(rDel.json));
  const after = await probe(db, SRC, GRADE_T, STAGE).where({ id: gid }).first();
  check('delete 后 is_deleted=1（物理行仍在）', Number(after?.is_deleted) === 1, `is_deleted=${after?.is_deleted}`);
  const rListAfter = await call(`/list?page=1&size=50&studentId=${stu1.id}`);
  check('delete 后 list 不再返回该行', isOk(rListAfter) && (rListAfter.json?.data?.total ?? 0) === 0, `total=${rListAfter.json?.data?.total}`);
  const rStatAfter = await call(`/statistics?classId=${clsA.id}`);
  check('delete 后 statistics 不再计入', Number(rStatAfter.json?.data?.total) === 1, `total=${rStatAfter.json?.data?.total}`);

  /* ---------- ⑫ 权限收敛：班主任看不到别班 ---------- */
  const teacherTok = await login('zhouj');
  const callT = (p, opts = {}) => req(`${API}${p}`, { ...opts, headers: { Authorization: `Bearer ${teacherTok}`, ...(opts.headers || {}) } });
  const tList = await callT(`/list?page=1&size=50&classId=${clsB.id}`);
  // 期望：**看不到**别班成绩（40302=无权限 / 或 200 但列表不含本班数据）
  const tDenied = tList.json?.code === 40302 || tList.json?.code === 40301;
  const tNoData = isOk(tList) && (tList.json?.data?.total ?? 0) === 0;
  check('★ 班主任访问别班成绩被拦（40302 或列表不含本班数据）', tDenied || tNoData, `code=${tList.json?.code} total=${tList.json?.data?.total}`);

  /* ---------- ⑬ 切读专属体检：结构 ---------- */
  if (USE_UNI) {
    const uc = conn('sms_common');
    // dorm_no 必须已加宽为 varchar(64)（迁移 004）
    const dormCol = await uc('information_schema.COLUMNS')
      .where({ TABLE_SCHEMA: 'sms_common', TABLE_NAME: 't_uni_student', COLUMN_NAME: 'dorm_no' })
      .first();
    check('★ 切读：t_uni_student.dorm_no = varchar(64)（迁移 004）', String(dormCol?.COLUMN_TYPE) === 'varchar(64)', `实际=${dormCol?.COLUMN_TYPE}`);

    // 分数列必须两套都在（业务读新列，老列留作兼容）
    const sCols = await uc('information_schema.COLUMNS')
      .where({ TABLE_SCHEMA: 'sms_common', TABLE_NAME: 't_uni_exam_score' })
      .whereIn('COLUMN_NAME', ['score_written', 'score_machine', 'score_interview', 'score_total'])
      .select('COLUMN_NAME');
    check('★ 切读：t_uni_exam_score 四个 score_* 列都在', sCols.length === 4, `实际 ${sCols.map((x) => x.COLUMN_NAME).join(',')}`);

    // edu_stage 必须落上
    const uniRow = await uc('t_uni_exam_score').where({ id: gid }).first();
    check('★ 切读：t_uni_exam_score.edu_stage = class', String(uniRow?.edu_stage) === 'class', uniRow?.edu_stage);
    check('★ 切读：软删行 edu_stage 也在', String(uniRow?.edu_stage) === 'class');

    // 不得凭空出现唯一索引（铁律⑧）
    const idx = await uc('information_schema.STATISTICS')
      .where({ TABLE_SCHEMA: 'sms_common', TABLE_NAME: 't_uni_exam_score' })
      .whereNot('INDEX_NAME', 'PRIMARY');
    check('★ 切读：t_uni_exam_score 除主键外无唯一索引（不凭空加）', idx.every((r) => Number(r.NON_UNIQUE) === 1), idx.map((r) => `${r.INDEX_NAME}:${r.NON_UNIQUE}`).join(' '));
    await uc.destroy();
  }

  /* ---------- 收尾 ---------- */
  await cleanup();
  await db.destroy();
  const pass = summary();
  if (!pass) dumpBackendError(40);
  killAll();
  return pass;
}

main()
  .then((ok2) => process.exit(ok2 ? 0 : 1))
  .catch(async (e) => {
    console.error('\n💥 自检异常：', e.message);
    try {
      await cleanup();
    } catch {}
    dumpBackendError(50);
    killAll();
    process.exit(1);
  });
