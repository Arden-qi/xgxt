/**
 * 自检：考试管理域（`/api/class/exam/*` · 第 4 期第 9 批统一表切读）
 * ============================================================
 * 其他自检都不覆盖 `/api/class/exam/*`；本脚本是
 * `class/modules/exam/exam.route.ts`（11 处裸访问）的唯一覆盖。
 * ⚠️ `scripts/_e2e-exam-check.mjs` 测的是 **另一个域** `/api/teaching/exam/*`，
 *    两者不是一套接口，不能互相替代。
 *
 * 【本批最该盯死的四条，每条都对应一个实测踩出来的坑】
 *
 * ①【★★★ `field_type` 类型冲突】三处口径原本互不相同：
 *      sms_class.t_class_exam_field.field_type    = varchar(20)，存中文 '数值'
 *      sms_class_jh.t_class_exam_field.field_type = int(11)，存 1/2
 *      sms_common.t_uni_exam_field.field_type     = 原本 int(11)，存 1
 *    而业务代码 zod 是 `z.string().default('数值')` —— 写进 int 列会炸
 *    `Truncated incorrect INTEGER value: '数值'`（MariaDB 严格模式是 ERROR）。
 *    → 斌哥拍板方案 A：迁移 005 把统一表该列改成 varchar(20)，12 行的 1 全部译成 '数值'。
 *    → 断言：`/field/add` 必须 200，且库里 `field_type` 存的是中文 '数值'。
 *
 * ②【★★★ 迁移顺序：先改类型再翻译】反过来做会挂 ——
 *    `UPDATE ... SET field_type='数值' WHERE field_type=1` 在列还是 int 时报
 *    `Incorrect integer value: '数值'`，整条迁移失败。
 *    与「varchar→int 改类型前必须先清串」是同一条纪律的两面。
 *    → 断言：迁移跑完后 `information_schema` 里该列必须是 varchar(20)。
 *
 * ③【★★ `t_uni_exam` 索引】考试列表主查询是「按班级 + 日期范围筛」，
 *    统一表原本**没有任何索引含 class_id** → 切读后每次列表查询扫全学段。
 *    → 断言：`idx_exam_class_date(edu_stage, class_id, exam_date)` 必须存在，
 *      且 `NON_UNIQUE = 1`（铁律：`ADD INDEX` ≠ `ADD UNIQUE INDEX`，静默不报错）。
 *
 * ④【★★ `/field/delete` 的 update 分支】软删走 `uniUpdCols()`，
 *    漏了会在切读时报 Unknown column（归一铁律⑨）。
 *    → 断言：切读时软删后该行仍在库里但 `is_deleted = 1`，且 `edu_stage` 没被抹掉。
 *
 * 另外覆盖：/add 建考试 + 内容项子表往返、/list 过滤与数据范围、
 * /detail 内容项与成绩、字段重名拦截、权限收敛、edu_stage 落值。
 *
 * 跑法：
 *   node scripts/_e2e-classgrade-exam-check.mjs                  （老表模式）
 *   TEACHING_UNI_TABLE=1 node scripts/_e2e-classgrade-exam-check.mjs（切读模式）
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

const API = `${BASE}/api/class/exam`;
const { check, summary } = makeChecker();

const OK = 200;
const isOk = (r) => r.json?.code === OK;

const SRC = 'sms_class';
const STAGE = 'class';

const EXAM_T = 't_class_exam';
const CONTENT_T = 't_class_exam_content';
const FIELD_T = 't_class_exam_field';
const GRADE_T = 't_class_grade';
const CLS_T = 't_class_info';

const db = conn(SRC);

/** 夹具登记：切读时数据落统一表，必须跟着改指向，否则清理删不掉 */
const fixtures = [];
const reg = (dbName, table, id) => {
  if (!id) return;
  const [d, t] = regTarget(dbName, table);
  fixtures.push([d, t, id]);
};

const rnd = Math.random().toString(36).slice(2, 8);
const TAG = `E2E-EXAM-${rnd}`;
/** ★ 自增序号：同一次运行内多张夹具共用 rnd 会撞主键（成绩域实测踩过） */
let seq = Math.floor(Math.random() * 1e6);
const nextSeq = () => ++seq;

/* ============================================================
 * 夹具
 * ============================================================ */
async function makeClass(name, stageCode = 201) {
  const id = `cls-ex-${rnd}-${nextSeq()}`;
  const row = await buildRow(db, CLS_T, {
    id,
    class_name: name,
    dept_code: 1,
    class_status: 1, // ★ 班级状态列是 class_status，没有 status 列
    student_count: 3,
    stage: stageCode,
    head_teacher_id: `u-ex-${rnd}`,
    head_teacher_name: 'E2E班主任',
  });
  await db(CLS_T).insert(row);
  reg(SRC, CLS_T, id);
  if (USE_UNI) await mirrorToUni(SRC, CLS_T, { ...row, id }, STAGE, reg);
  return { id, ...row };
}

/** 物理删自检数据（不进软删池，避免占唯一索引） */
async function cleanup() {
  const order = [
    [SRC, CONTENT_T],
    [SRC, FIELD_T],
    [SRC, GRADE_T],
    [SRC, EXAM_T],
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
  const token = await login('qiansy'); // 校长：考试页写权限齐全
  const H = { Authorization: `Bearer ${token}` };
  const call = (path, opts = {}) =>
    req(`${API}${path}`, { ...opts, headers: { ...H, ...(opts.headers || {}) } });

  const clsA = await makeClass(`${TAG}-A班`);

  /* ---------- ① /add 建考试（含内容项子表） ---------- */
  const rAdd = await call('/add', {
    method: 'POST',
    body: {
      examName: `${TAG}-阶段考`,
      examType: 3,
      examDate: '2026-10-20',
      classId: clsA.id,
      contents: [
        { examContentType: 1, fullScore: 100, contentName: '笔试' },
        { examContentType: 3, fullScore: 50, contentName: '面试' },
      ],
    },
  });
  const examId = rAdd.json?.data?.examId;
  check('add 建考试成功并返回 examId', isOk(rAdd) && !!examId, JSON.stringify(rAdd.json));
  reg(SRC, EXAM_T, examId);

  if (examId) {
    // 内容项是子表，走事务插入；切读时必须落到 t_uni_exam_content
    // ★ 切读时要连 sms_common，不是老库 —— 否则报 "table doesn't exist"
    const CT_T = USE_UNI ? 't_uni_exam_content' : CONTENT_T;
    const CT_DB = USE_UNI ? conn('sms_common') : db;
    const ctRows = await CT_DB(CT_T).where({ exam_id: examId, is_deleted: 0 });
    if (USE_UNI) await CT_DB.destroy();
    reg(SRC, CONTENT_T, ctRows.map((r) => r.id));
    check(
      '★ add 内容项子表落库 2 行（事务插入走 tblInsTrx）',
      ctRows.length === 2 && Number(ctRows.find((r) => Number(r.exam_content_type) === 3)?.full_score) === 50,
      `落库表=${CT_T} 行数=${ctRows.length} ${JSON.stringify(ctRows.map((r) => [r.exam_content_type, r.full_score]))}`,
    );

    // 未传 attendeeCount 时按班级人数自动取
    const exRow = await probe(db, SRC, EXAM_T, STAGE).where({ id: examId }).first();
    check(
      '★ add 未传 attendeeCount 时按班级人数自动取',
      Number(exRow?.attendee_count) === 3,
      `attendee_count=${exRow?.attendee_count}`,
    );
    check('add 后 exam_name / class_name 正确落库', exRow?.exam_name === `${TAG}-阶段考` && exRow?.class_name === clsA.class_name, `class_name=${exRow?.class_name}`);
  }

  /* ---------- ② /list 过滤 ---------- */
  const rList = await call(`/list?classId=${clsA.id}&limit=10`);
  check('list 按 classId 能查到刚建的考试', isOk(rList) && (rList.json?.data?.list || []).some((x) => x.id === examId), `total=${rList.json?.data?.total}`);
  const rListType = await call(`/list?classId=${clsA.id}&examType=3&limit=10`);
  check('list 按 examType 过滤命中', isOk(rListType) && (rListType.json?.data?.list || []).length >= 1, `total=${rListType.json?.data?.total}`);
  const rListKw = await call(`/list?classId=${clsA.id}&keyword=${encodeURIComponent('阶段考')}&limit=10`);
  check('list 按 keyword 模糊搜索命中', isOk(rListKw) && (rListKw.json?.data?.list || []).some((x) => x.id === examId), `total=${rListKw.json?.data?.total}`);
  const rListDate = await call(`/list?classId=${clsA.id}&startDate=2026-10-01&endDate=2026-10-31&limit=10`);
  check('list 按日期区间过滤命中（★ 走 idx_exam_class_date）', isOk(rListDate) && (rListDate.json?.data?.list || []).some((x) => x.id === examId), `total=${rListDate.json?.data?.total}`);
  const rListNone = await call(`/list?classId=${clsA.id}&startDate=2030-01-01&limit=10`);
  check('list 日期区间不重叠时返回 0 条', isOk(rListNone) && Number(rListNone.json?.data?.total) === 0, `total=${rListNone.json?.data?.total}`);

  // 列表必须带上内容项（否则前端表格列空）
  const listRow = (rList.json?.data?.list || []).find((x) => x.id === examId);
  check('★ list 每行带 contents 数组（非空数组）', Array.isArray(listRow?.contents) && listRow.contents.length === 2, `contents=${JSON.stringify(listRow?.contents?.map((c) => [c.examContentType, c.fullScore]))}`);

  /* ---------- ③ /detail ---------- */
  const rDetail = await call(`/detail?id=${examId}`);
  const dd = rDetail.json?.data || {};
  check('detail 查到考试主体', isOk(rDetail) && dd.exam?.id === examId, JSON.stringify(dd.exam?.id));
  check('detail 内容项数组长度 2 且满分往返一致', (dd.contents || []).length === 2 && (dd.contents || []).some((c) => c.fullScore === 50), JSON.stringify((dd.contents || []).map((c) => [c.examContentType, c.fullScore])));
  check('detail examTypeName 翻译非未知', dd.exam?.examTypeName === '阶段考核', dd.exam?.examTypeName);
  const rDetailBad = await call('/detail?id=not-exist-exam-id');
  check('detail 查不存在考试返回业务错误', !isOk(rDetailBad), `code=${rDetailBad.json?.code}`);

  /* ---------- ④ /field/add（★ field_type 中文，迁移 005） ---------- */
  const fieldKey = `E2E字段${rnd}`;
  const rFAdd = await call('/field/add', {
    method: 'POST',
    body: { fieldKey, fieldType: '数值', defaultValue: '88' },
  });
  const fieldId = rFAdd.json?.data?.fieldId;
  check('field/add 新增自定义字段成功', isOk(rFAdd) && !!fieldId, JSON.stringify(rFAdd.json));
  reg(SRC, FIELD_T, fieldId);

  if (fieldId) {
    const fRow = await probe(db, SRC, FIELD_T, STAGE).where({ id: fieldId }).first();
    check(
      "★ field/add 的 field_type 落库为中文 '数值'（统一表该列已改 varchar(20)）",
      String(fRow?.field_type) === '数值',
      `field_type=${JSON.stringify(fRow?.field_type)}`,
    );
    check('field/add 的 default_value 落库正确', String(fRow?.default_value) === '88', `default_value=${fRow?.default_value}`);
  }

  /* ---------- ⑤ field/add 重名拦截 ---------- */
  const rDup = await call('/field/add', {
    method: 'POST',
    body: { fieldKey, fieldType: '数值' },
  });
  check('★ field/add 同名字段被拦截（唯一性靠业务代码）', !isOk(rDup) && /已存在/.test(rDup.json?.message || ''), `code=${rDup.json?.code} msg=${rDup.json?.message}`);

  /* ---------- ⑥ /field/list（★ 全表返回，不按 exam_id 过滤） ---------- */
  const rFList = await call('/field/list');
  const fList = rFList.json?.data || [];
  check('field/list 返回数组且含新建字段', isOk(rFList) && fList.some((x) => x.id === fieldId), `共 ${fList.length} 个字段`);
  const fSelf = fList.find((x) => x.id === fieldId);
  check('★ field/list 字段类型原样透出中文（前端直接用）', fSelf?.fieldType === '数值', `fieldType=${JSON.stringify(fSelf?.fieldType)}`);

  /* ---------- ⑦ /field/delete（★ update 分支走 uniUpdCols） ---------- */
  const rFDel = await call('/field/delete', { method: 'POST', body: { fieldId } });
  check('field/delete 软删成功', isOk(rFDel), JSON.stringify(rFDel.json));
  const fAfter = await probe(db, SRC, FIELD_T, STAGE).where({ id: fieldId }).first();
  check(
    '★ field/delete 后行仍在但 is_deleted=1（update 分支没炸 = 列名翻译到位）',
    Number(fAfter?.is_deleted) === 1,
    `is_deleted=${fAfter?.is_deleted} 查到=${!!fAfter}`,
  );
  if (USE_UNI) {
    check('★ 切读：软删行 edu_stage 没被抹掉', String(fAfter?.edu_stage) === 'class', fAfter?.edu_stage);
  }
  const rFList2 = await call('/field/list');
  check('field/delete 后列表不再返回该字段', !(rFList2.json?.data || []).some((x) => x.id === fieldId), `共 ${(rFList2.json?.data || []).length} 个字段`);
  const rFDelBad = await call('/field/delete', { method: 'POST', body: { fieldId: 'not-exist' } });
  check('field/delete 删不存在字段返回业务错误', !isOk(rFDelBad), `code=${rFDelBad.json?.code}`);

  /* ---------- ⑧ 权限收敛 ---------- */
  const noPermTok = await login('zhouj'); // 就业老师：无考试页权限
  const rNoPerm = await req(`${API}/list`, { headers: { Authorization: `Bearer ${noPermTok}` } });
  check('无考试页权限的账号列表被拦(40302)', rNoPerm.json?.code === 40302, rNoPerm.json?.message || '');
  // ★ 必须用 noPermTok 发，不能用 call() —— call() 带的是校长 token
  const rNoPermAdd = await req(`${API}/field/add`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${noPermTok}` },
    body: { fieldKey: `X${rnd}` },
  });
  check('无权限账号写操作被拦', !isOk(rNoPermAdd), `code=${rNoPermAdd.json?.code}`);
  const anon = await req(`${API}/list`);
  check('未登录被拒（code=40101）', anon.json?.code === 40101, `status=${anon.status} code=${anon.json?.code}`);

  /* ---------- ⑨ 切读专属：结构体检 ---------- */
  if (USE_UNI) {
    const uc = conn('sms_common');

    // ② field_type 必须是 varchar(20)
    const ftCol = await uc('information_schema.COLUMNS')
      .where({ TABLE_SCHEMA: 'sms_common', TABLE_NAME: 't_uni_exam_field', COLUMN_NAME: 'field_type' })
      .first();
    check('★ 切读：t_uni_exam_field.field_type = varchar(20)（迁移 005）', String(ftCol?.COLUMN_TYPE) === 'varchar(20)', `实际=${ftCol?.COLUMN_TYPE}`);

    // ③ 索引必须存在且 NON_UNIQUE=1
    const idx = await uc('information_schema.STATISTICS')
      .where({ TABLE_SCHEMA: 'sms_common', TABLE_NAME: 't_uni_exam' })
      .where('INDEX_NAME', 'idx_exam_class_date');
    const idxCols = idx.map((r) => r.COLUMN_NAME).sort().join(',');
    check(
      '★ 切读：t_uni_exam.idx_exam_class_date 存在且三列齐全（迁移 005）',
      idx.length === 3 && idxCols === 'class_id,edu_stage,exam_date',
      `实际列=${idxCols}`,
    );
    check(
      '★ 切读：idx_exam_class_date 是普通索引 NON_UNIQUE=1（ADD INDEX≠ADD UNIQUE）',
      idx.length > 0 && Number(idx[0].NON_UNIQUE) === 1,
      `NON_UNIQUE=${idx[0]?.NON_UNIQUE}`,
    );

    // 不得凭空出现 field_key 唯一索引（实测 12 行有重复组，建不起来）
    const ukField = await uc('information_schema.STATISTICS')
      .where({ TABLE_SCHEMA: 'sms_common', TABLE_NAME: 't_uni_exam_field' })
      .whereNot('INDEX_NAME', 'PRIMARY');
    check(
      '★ 切读：t_uni_exam_field 除主键外无唯一索引（field_key 有重复组，不能凭空加）',
      ukField.every((r) => Number(r.NON_UNIQUE) === 1),
      ukField.map((r) => `${r.INDEX_NAME}:${r.NON_UNIQUE}`).join(' '),
    );

    // 考试与内容项的 edu_stage 必须落上
    const uniExam = await uc('t_uni_exam').where({ id: examId }).first();
    check('★ 切读：t_uni_exam.edu_stage = class', String(uniExam?.edu_stage) === 'class', uniExam?.edu_stage);
    const uniCt = await uc('t_uni_exam_content').where({ exam_id: examId }).first();
    check('★ 切读：t_uni_exam_content.edu_stage = class', String(uniCt?.edu_stage) === 'class', uniCt?.edu_stage);

    // ★ 12 行既有种子的 field_type 必须已全部译成中文（迁移 005 的回填）
    const ftDist = await uc('t_uni_exam_field').select('field_type').groupBy('field_type');
    check(
      "★ 切读：既有种子 field_type 无残留数字码（全部是 '数值'/'文本'）",
      ftDist.every((r) => r.field_type === '数值' || r.field_type === '文本'),
      `实际分布=${JSON.stringify(ftDist.map((r) => r.field_type))}`,
    );

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