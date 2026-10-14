/**
 * 自检：出勤 / 通知 / 催费 / 费用 四域收尾（`/api/class/*` · 第 4 期第 10 批统一表切读）
 * ==============================================================================
 * ⚠️ 与既有自检的区别（名字极易混，先看这段）：
 *   · `scripts/_e2e-attendance-check.mjs` 测的是 **teaching 域** `/api/teaching/attendance/*`
 *     —— 与本脚本的 `/api/class/attendance/*` **不是一套接口，不能互相替代**。
 *   · notify / urge / fee 三个域此前**零自检覆盖**，本脚本是它们的唯一覆盖。
 *
 * 【本批最该盯死的五条，每条都对应一个实测踩出来的坑】
 *
 * ①【★★★ `t_class_urge_sync` 曾被误当成「催费流水表」】
 *   老库有**两张语义完全不同的表**，名字很像：
 *     sms_class.t_class_urge_sync（26 列）= 教务推来的**催费副本**
 *       某学生欠多少（fee_type/amount/expire_date/pay_status）+ 催了几次
 *     sms_class.t_class_urge_log  （15 列）= **催费动作流水**
 *       谁在什么时候用什么渠道催了（channel/operator_id/urge_time）
 *   实测 `t_uni_urge_log` 60 行的 student_id 挂 `t_uni_fee.id` **命中 0**
 *   → 两者不是同一件事，绝不能塞进一张表。
 *   → 本批新建 `t_uni_urge`（28 列）放副本，`t_uni_urge_log` 保持只放流水。
 *   → 断言：`t_uni_urge` 存在且**不含** channel/operator_id（那是流水的列）。
 *
 * ②【★★★ `amount` → `fee_amount` 的读写分离（本域最大的坑）】
 *   老表 `t_class_fee_sync.amount`（应收）与统一表 `t_uni_fee.fee_amount`（同一笔钱）。
 *   写入侧由 `UNI_COL_RENAME` 自动翻译，但**读路径不会自动改名**。
 *   若读路径写死 `r.amount`：
 *     · `/fee/list`金额恒为 "0.00"
 *     · `/fee/summary` 的 totalUnpaid 恒为 0
 *     · `student.route.ts` 的欠费人数**直接归零**
 *   → 全都不报错，只是数字全错 —— 是最难发现的一类 bug。
 *   → 断言：切读时 `/fee/list` 必须能读出非零金额（夹具金额写死 888800）。
 *
 * ③【★★ `student.route.ts` 的 `whereRaw` 也必须改列名】
 *   欠费统计用了 `whereRaw('amount > COALESCE(paid_amount,0)')` 和
 *   `SUM(amount - COALESCE(paid_amount,0))`。
 *   只改 select 不改 whereRaw → 切读时 `amount` 是不存在的列。
 *   → 断言：切读时欠费人数 > 0、欠费金额 > 0。
 *
 * ④【★★ 铁律⑨：`/sync` 的 update 路径也必须过 `uniUpdCols()`】
 *   `/sync` 是「先查后写」：首次走 insert（有翻译），第二次走 update（没翻译）
 *   → **首次成功、二次必炸**，接口照样 200，错误藏在 `data.errors[].reason` 里。
 *   → 断言：同一 sourceId 连发两次，两次 `failed` 都必须是 0，
 *     并且第二次 `updated === 1`。
 *
 * ⑤【★★ `/absent/list` 的 JOIN 必须自己注入 edu_stage】
 *   `tbl()` 只映射单表 + 注入 edu_stage，**不支持 JOIN 两张表**。
 *   本批手写切读分支；老表分支的 select 里`t.class_name` 会覆盖同名 `a.class_name`
 *   → 切读分支**不能给 t.class_name 起别名**，否则同一字段两分支含义不同。
 *   → 断言：切读时该接口返回的 `className` 有值且不为空串。
 *
 * 另外覆盖：出勤 /add 幂等（同班级同日覆盖）、缺勤明细往返、
 * 通知标记已读与未读统计、催费执行后次数 +1、缴费汇总算账正确、权限收敛。
 *
 * 跑法：
 *   node scripts/_e2e-class-four-check.mjs                   （老表模式）
 *   TEACHING_UNI_TABLE=1 node scripts/_e2e-class-four-check.mjs（切读模式）
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

const { check, summary } = makeChecker();

const OK = 200;
const isOk = (r) => r.json?.code === OK;

/* ---------- 表与库 ---------- */
const SRC = 'sms_class';       // 大学学段业务表
const SRC_COMMON = 'sms_common'; // 同步副本（催费副本 / 缴费副本）
const STAGE = 'class';

const ATT_T = 't_class_attendance';
const ABS_T = 't_class_attendance_absent';
const NOTIFY_T = 't_class_notify';
const URG_SYNC_T = 't_class_urge_sync';
const URG_LOG_T = 't_class_urge_log';
const FEE_SYNC_T = 't_class_fee_sync';
const CLS_T = 't_class_info';
const STU_T = 't_class_student';

const db = conn(SRC);
const cdb = conn(SRC_COMMON);

/** 切读时这些表会落到统一表，清理必须跟着改指向 */
function uniTableOf(dbName, table) {
  if (!USE_UNI) return null;
  if (dbName === SRC_COMMON) {
    if (table === URG_SYNC_T) return 't_uni_urge';
    if (table === FEE_SYNC_T) return 't_uni_fee';
    return null;
  }
  return {
    [ATT_T]: 't_uni_attendance',
    [ABS_T]: 't_uni_attendance_detail',
    [NOTIFY_T]: 't_uni_notify',
    [URG_LOG_T]: 't_uni_urge_log',
  }[table] ?? null;
}

/** 取一张表（自动跟随切读切到统一表），用于断言真实落点 */
function T(dbName, table) {
  const uni = uniTableOf(dbName, table);
  return (uni ? cdb : dbName === SRC_COMMON ? cdb : db)(uni ?? table);
}

const fixtures = [];
const reg = (dbName, table, id) => {
  if (!id) return;
  const [d, t] = regTarget(dbName, table);
  fixtures.push([d, t, id]);
  const uni = uniTableOf(dbName, table);
  if (uni) fixtures.push([SRC_COMMON, uni, id]);
};

const rnd = Math.random().toString(36).slice(2, 8);
const TAG = `E2E-FOUR-${rnd}`;
let seq = Math.floor(Math.random() * 1e6);
const nextSeq = () => ++seq;

/** 自增主键，避免同一次运行内多张夹具撞主键 */
const newId = (prefix) => `${prefix}-${rnd}-${nextSeq()}`;

/* ============================================================
 * 夹具
 * ============================================================ */
async function makeClass(name) {
  const id = newId('cls-fo');
  const row = await buildRow(db, CLS_T, {
    id,
    class_name: name,
    dept_code: 1,
    class_status: 1,
    student_count: 2,
    stage: 201,
    head_teacher_id: `u-fo-${rnd}`,
    head_teacher_name: 'E2E班主任',
  });
  await db(CLS_T).insert(row);
  reg(SRC, CLS_T, id);
  if (USE_UNI) await mirrorToUni(SRC, CLS_T, { ...row, id }, STAGE, reg);
  return { id, ...row };
}

async function makeStudent(cls, name) {
  const id = newId('stu-fo');
  const row = await buildRow(db, STU_T, {
    id,
    student_no: `E2E${String(nextSeq()).padStart(4, '0')}`,
    student_name: name,
    class_id: cls.id,
    class_name: cls.class_name,
    student_status: 5, // 正式在读
    phone: '13800001111',
    stage: 201,
    enroll_date: '2026-09-01',
  });
  await db(STU_T).insert(row);
  reg(SRC, STU_T, id);
  if (USE_UNI) await mirrorToUni(SRC, STU_T, { ...row, id }, STAGE, reg);
  return { id, ...row };
}

/** 物理删自检数据（软删会占唯一索引，下一轮直接撞墙） */
async function cleanup() {
  for (const [dbName, table, id] of fixtures) {
    const d = dbName === SRC_COMMON ? cdb : db;
    await d(table).where({ id }).del().catch(() => {});
  }
}

/* ============================================================
 * 用例
 * ============================================================ */
async function main() {
  await startServices();
  const token = await login('qiansy'); // 校长：写权限齐全
  const H = { Authorization: `Bearer ${token}` };
  const call = (base, path, opts = {}) =>
    req(`${base}${path}`, { ...opts, headers: { ...H, ...(opts.headers || {}) } });

  const ATT = `${BASE}/api/class/attendance`;
  const NOTIFY = `${BASE}/api/class/notify`;
  const URGE = `${BASE}/api/class/urge`;
  const FEE = `${BASE}/api/class/fee`;

  const cls = await makeClass(`${TAG}-班`);
  const stu1 = await makeStudent(cls, `${TAG}-学生甲`);
  const stu2 = await makeStudent(cls, `${TAG}-学生乙`);

  /* ================= ① 切读结构体检 ================= */
  // ★ 全部走 knex 查询构造器，**不用 knex.raw(SELECT ...)** ——
  //   MariaDB 驱动下 raw 返回的是「协议字段数组」而不是行对象，
  //   取值会全是 undefined（本脚本第一版就栽在这，已踩过多次）。
  if (USE_UNI) {
    const colsOf = async (t) =>
      new Set(
        (await cdb('information_schema.COLUMNS')
          .where({ TABLE_SCHEMA: 'sms_common', TABLE_NAME: t })
          .select('COLUMN_NAME')).map((r) => r.COLUMN_NAME),
      );
    const colSet = await colsOf('t_uni_urge');
    check(
      '★切读：t_uni_urge 已建（催费副本独立成表）',
      colSet.size > 0 && colSet.has('urge_count') && colSet.has('amount'),
      `列数=${colSet.size}`,
    );
    check(
      '★ 切读：t_uni_urge 不含流水列 channel/operator_id（铁律④：副本≠流水）',
      !colSet.has('channel') && !colSet.has('operator_id'),
      `channel=${colSet.has('channel')} operator_id=${colSet.has('operator_id')}`,
    );
    const feeSet = await colsOf('t_uni_fee');
    check(
      '★ 切读：t_uni_fee 有 fee_amount（应收列名）且无 amount（老表列名）',
      feeSet.has('fee_amount') && !feeSet.has('amount'),
      `fee_amount=${feeSet.has('fee_amount')} amount=${feeSet.has('amount')}`,
    );
    check(
      '★ 切读：t_uni_fee 补齐 5 个同步列（迁移 006）',
      ['source_batch_no', 'source_update_time', 'sync_status', 'paid_amount', 'pay_method'].every((c) =>
        feeSet.has(c),
      ),
      '',
    );
    const idxRows = await cdb('information_schema.STATISTICS')
      .where({ TABLE_SCHEMA: 'sms_common', TABLE_NAME: 't_uni_urge' })
      .select('INDEX_NAME', 'NON_UNIQUE');
    const idxNames = idxRows.map((r) => `${r.INDEX_NAME}:${r.NON_UNIQUE}`);
    check(
      '★ 切读：t_uni_urge 幂等键索引是普通索引（铁律⑧：不凭空加 UNIQUE）',
      idxNames.includes('idx_source:1'),
      idxNames.join(' '),
    );
  }

  /* ================= ② 出勤域 ================= */
  const rAttAdd = await call(ATT, '/add', {
    method: 'POST',
    body: {
      classId: cls.id,
      attendanceDate: '2026-10-15',
      shouldCount: 2,
      presentCount: 1,
      absents: [{ studentId: stu1.id, absentReason: '病假' }],
    },
  });
  check('出勤 /add 成功', isOk(rAttAdd), JSON.stringify(rAttAdd.json));

  const attId = await probe(db, SRC, ATT_T, STAGE)
    .where({ class_id: cls.id, attendance_date: '2026-10-15' })
    .first();
  if (attId?.id) reg(SRC, ATT_T, attId.id);
  check(
    '★ 出勤 add 落库：实到 1 / 缺勤 1 / 出勤率 50',
    !!attId &&
      Number(attId.present_count) === 1 &&
      Number(attId.absent_count) === 1 &&
      Number(attId.attendance_rate) === 50,
    JSON.stringify(attId),
  );

  if (attId?.id) {
    const absRow = await T(SRC, ABS_T).where({ attendance_id: attId.id, is_deleted: 0 }).first();
    if (absRow?.id) reg(SRC, ABS_T, absRow.id);
    check(
      '★ 出勤 缺勤明细子表落库 1 行（tblInsTrx）且学号姓名已回填',
      !!absRow && absRow.student_no === stu1.student_no && absRow.absent_reason === '病假',
      JSON.stringify(absRow),
    );
  }

  // 同班级同日再存一次 → 应覆盖而不是新增
  // ★ 覆盖时**换一条缺勤明细**（原来缺勤甲、现在缺勤乙），不能传空数组：
  //   「明细整体替换」是本接口的既有行为，传空会把唯一一条明细软删掉，
  //   后面的 /absent/list 就只能断言到空列表（第一版脚本栽在这，
  //   症状是 className 断言永远拿不到行，看着像 JOIN 写错了）。
  const rAttAgain = await call(ATT, '/add', {
    method: 'POST',
    body: {
      classId: cls.id,
      attendanceDate: '2026-10-15',
      shouldCount: 2,
      presentCount: 1,
      absents: [{ studentId: stu2.id, absentReason: '事假' }],
    },
  });
  const attCnt = await T(SRC, ATT_T).where({ class_id: cls.id, attendance_date: '2026-10-15' });
  check(
    '★ 出勤 add 幂等：同班级同日覆盖而非新增（仍 1 行）',
    isOk(rAttAgain) && attCnt.length === 1,
    `行数=${attCnt.length}`,
  );

  const absAfter = await T(SRC, ABS_T).where({ attendance_id: attCnt[0]?.id, is_deleted: 0 });
  check(
    '★ 出勤 覆盖保存时缺勤明细整体替换（旧明细软删、新明细入库）',
    absAfter.length === 1 && absAfter[0].student_id === stu2.id &&
      absAfter[0].absent_reason === '事假',
    JSON.stringify(absAfter.map((r) => [r.student_id, r.absent_reason, r.is_deleted])),
  );

  const rAttList = await call(ATT, `/list?classId=${cls.id}`);
  check(
    '出勤 /list 能查到本班记录且出勤率是数字',
    isOk(rAttList) && rAttList.json?.data?.list?.length >= 1 &&
      typeof rAttList.json?.data?.list?.[0]?.attendanceRate === 'number',
    JSON.stringify(rAttList.json?.data?.list?.[0]),
  );

  if (attId?.id) {
    const rDet = await call(ATT, `/detail?id=${attId.id}`);
    check(
      '★ 出勤 /detail 含record + absents 明细',
      isOk(rDet) && !!rDet.json?.data?.record && Array.isArray(rDet.json?.data?.absents),
      JSON.stringify(rDet.json?.data?.absents),
    );
  }

  const rAbsList = await call(ATT, `/absent/list?classId=${cls.id}`);
  check(
    '★ 出勤 /absent/list JOIN 分支可用（切读时手动注入 edu_stage）',
    isOk(rAbsList) && Array.isArray(rAbsList.json?.data?.list),
    `code=${rAbsList.json?.code} msg=${rAbsList.json?.message ?? ''}`,
  );
  if (USE_UNI && isOk(rAbsList)) {
    const first = rAbsList.json?.data?.list?.[0];
    check(
      '★ 切读 /absent/list 的 className 取主表值（两分支口径一致，不能起别名）',
      first && !!first.className,
      JSON.stringify(first),
    );
  }

  /* ================= ③ 通知域 ================= */
  // ★ receiver_id 的真实口径是**门户下发的 uuid**，不是 sms_perm 的账号ID（U004）。
  //   实测：老表 54 行、统一表 45 行的 receiver_id 全是下面这个 uuid（张海涛）。
  //   → 照抄实测值，不要想当然填账号ID —— 填错的话 /read 与 /detail 全部 40302，
  //     而症状与真实 bug（权限判断错了）一模一样。
  const ZHAANG_ID = '85a47f05-6f96-4602-944e-d5c29b0154ae';

  const notiId = newId('noti-fo');
  const notiRow = await buildRow(db, NOTIFY_T, {
    id: notiId,
    notify_type: 1,
    apply_type: 1,
    biz_id: newId('biz-fo'),
    apply_no: `${TAG}-001`,
    title: `${TAG} 通知标题`,
    content: `${TAG} 通知内容`,
    receiver_id: ZHAANG_ID,
    receiver_name: '张海涛',
    is_read: 0,
    read_time: null,
    link_path: null,
  });
  await db(NOTIFY_T).insert(notiRow);
  reg(SRC, NOTIFY_T, notiId);
  if (USE_UNI) await mirrorToUni(SRC, NOTIFY_T, { ...notiRow, id: notiId }, STAGE, reg);

  // 用张海涛的 token 验未读 → 标记已读
  const zhangTok = await login('zhanght');
  const ZH = { Authorization: `Bearer ${zhangTok}` };
  const callZh = (path, opts = {}) =>
    req(`${NOTIFY}${path}`, { ...opts, headers: { ...ZH, ...(opts.headers || {}) } });

  const rUnread = await callZh('/unread');
  check(
    '通知 /unread 能按 receiver_id 统计到本条',
    isOk(rUnread) && (rUnread.json?.data?.total ?? 0) >= 1,
    JSON.stringify(rUnread.json?.data),
  );

  const rRead = await callZh('/read', { method: 'POST', body: { id: notiId } });
  const notiAfter = await T(SRC, NOTIFY_T).where({ id: notiId }).first();
  check(
    '★ 通知 /read 标记已读落库（update 走 uniUpdCols，铁律⑨）',
    isOk(rRead) && Number(notiAfter?.is_read) === 1 && !!notiAfter?.read_time,
    JSON.stringify(notiAfter),
  );

  const rDetNoti = await callZh(`/detail?id=${notiId}`);
  check(
    '通知 /detail 能读到自己的通知',
    isOk(rDetNoti) && rDetNoti.json?.data?.id === notiId,
    `code=${rDetNoti.json?.code}`,
  );

  // 别人的通知应被拒
  const rOther = await call(NOTIFY, `/detail?id=${notiId}`);
  check(
    '通知 /detail 拒绝查看他人通知',
    !isOk(rOther),
    `code=${rOther.json?.code}`,
  );

  /* ================= ④ 催费域 ================= */
  // ★ 2026-10-14：改成读 .env（脚本已 dotenv.config），兜底与 config 默认值一致
  const U = { 'x-internal-token': process.env.INTERNAL_TOKEN || 'CHANGE_ME_INTERNAL_TOKEN' };
  const syncBody = (sourceId) => ({
    batchNo: `${TAG}-B1`,
    syncMode: 'full',
    sourceSystem: 'edu',
    items: [
      {
        sourceId,
        studentNo: stu1.student_no,
        studentName: stu1.student_name,
        classId: cls.id,
        className: cls.class_name,
        feeType: 1,
        amount: 888800,
        expireDate: '2026-11-30',
        payStatus: 1,
        urgeCount: 0,
      },
    ],
  });

  const rUrg1 = await req(`${URGE}/sync`, {
    method: 'POST',
    body: syncBody(`${TAG}-S1`),
    headers: U,
  });
  check(
    '★ 催费 /sync 首次插入成功 failed=0',
    isOk(rUrg1) && rUrg1.json?.data?.failed === 0 && rUrg1.json?.data?.inserted === 1,
    JSON.stringify(rUrg1.json?.data),
  );
  if (rUrg1.json?.data?.errors?.length) {
    console.log('  ⚠️ sync errors:', JSON.stringify(rUrg1.json.data.errors));
  }

  // ★ 铁律⑨：同一 sourceId 再发一次必须走 update 且仍然 failed=0
  const rUrg2 = await req(`${URGE}/sync`, {
    method: 'POST',
    body: syncBody(`${TAG}-S1`),
    headers: U,
  });
  check(
    '★ 催费 /sync 二次走 update 仍 failed=0（铁律⑨：update 路径也翻译列名）',
    isOk(rUrg2) && rUrg2.json?.data?.failed === 0 && rUrg2.json?.data?.updated === 1,
    JSON.stringify(rUrg2.json?.data),
  );
  if (rUrg2.json?.data?.errors?.length) {
    console.log('  ⚠️ sync errors(2):', JSON.stringify(rUrg2.json.data.errors));
  }

  const urgeRow = await T(SRC_COMMON, URG_SYNC_T).where({ source_id: `${TAG}-S1`, is_deleted: 0 }).first();
  if (urgeRow?.id) reg(SRC_COMMON, URG_SYNC_T, urgeRow.id);
  check(
    '★ 催费副本落库：金额 888800 / 催费次数 0 / edu_stage 已补',
    !!urgeRow &&
      Number(urgeRow.amount) === 888800 &&
      Number(urgeRow.urge_count) === 0 &&
      (!USE_UNI || urgeRow.edu_stage === STAGE),
    JSON.stringify(urgeRow),
  );

  const rUrgList = await call(URGE, `/list?keyword=${encodeURIComponent(stu1.student_no)}`);
  check(
    '★ 催费 /list 能查到副本且金额非零',
    isOk(rUrgList) && rUrgList.json?.data?.list?.length >= 1 &&
      Number(rUrgList.json?.data?.list?.[0]?.amount ?? 0) === 888800,
    JSON.stringify(rUrgList.json?.data?.list?.[0]),
  );

  // 执行催收 → 催费次数 +1 + 流水 1 行
  const rDo = await call(URGE, '/do', {
    method: 'POST',
    body: { urgeId: urgeRow?.id, channel: 'phone', remark: '第1次' },
  });
  const urgeAfter = await T(SRC_COMMON, URG_SYNC_T).where({ id: urgeRow?.id }).first();
  check(
    '★ 催费 /do 副本催费次数 +1（update 走 uniUpdCols）',
    isOk(rDo) && Number(urgeAfter?.urge_count) === 1 && !!urgeAfter?.last_urge_time,
    ` urge_count=${urgeAfter?.urge_count} last=${urgeAfter?.last_urge_time}`,
  );

  const logRow = await T(SRC, URG_LOG_T).where({ student_no: stu1.student_no, is_deleted: 0 }).first();
  if (logRow?.id) reg(SRC, URG_LOG_T, logRow.id);
  check(
    '★ 催费 /do 同时写催收流水 1 行（副本与流水分表）',
    !!logRow && logRow.channel === 'phone' && Number(logRow.amount) === 888800,
    JSON.stringify(logRow),
  );

  const rLogList = await call(URGE, `/log/list?studentId=${stu1.id}`);
  check(
    '催费 /log/list 能查到流水',
    isOk(rLogList) && rLogList.json?.data?.list?.length >= 1,
    `code=${rLogList.json?.code} total=${rLogList.json?.data?.total}`,
  );

  /* ================= ⑤ 费用域 ================= */
  // ★ payStatus 必须用 1（UNPAID 待缴），不能用 2：
  //   PayStatus 枚举 = 1待缴 / 2已缴 / 3已核对 / 4逾期 / 5冻结，
  //   而 student 的欠费统计**明确排除 2 和 3**
  //   → 夹具填 2 的话 dueCount 恒为 0（老表切读都一样，不是切读的锅）。
  const feeSync = (sourceId) => ({
    batchNo: `${TAG}-FB1`,
    syncMode: 'full',
    sourceSystem: 'finance',
    items: [
      {
        sourceId,
        studentNo: stu1.student_no,
        studentName: stu1.student_name,
        classId: cls.id,
        className: cls.class_name,
        feeType: 1,
        amount: 888800,
        paidAmount: 100000,
        payStatus: 1,
        payDate: '2026-10-01',
        payMethod: '微信',
      },
    ],
  });

  const rFee1 = await req(`${FEE}/sync`, {
    method: 'POST',
    body: feeSync(`${TAG}-F1`),
    headers: U,
  });
  check(
    '★ 费用 /sync 首次插入成功 failed=0',
    isOk(rFee1) && rFee1.json?.data?.failed === 0 && rFee1.json?.data?.inserted === 1,
    JSON.stringify(rFee1.json?.data),
  );
  if (rFee1.json?.data?.errors?.length) {
    console.log('  ⚠️ fee sync errors:', JSON.stringify(rFee1.json.data.errors));
  }

  const rFee2 = await req(`${FEE}/sync`, {
    method: 'POST',
    body: feeSync(`${TAG}-F1`),
    headers: U,
  });
  check(
    '★ 费用 /sync 二次走 update 仍 failed=0（amount→fee_amount 翻译生效）',
    isOk(rFee2) && rFee2.json?.data?.failed === 0 && rFee2.json?.data?.updated === 1,
    JSON.stringify(rFee2.json?.data),
  );
  if (rFee2.json?.data?.errors?.length) {
    console.log('  ⚠️ fee sync errors(2):', JSON.stringify(rFee2.json.data.errors));
  }

  // 库里的金额列：老表 amount，统一表 fee_amount
  const AMT_COL = USE_UNI ? 'fee_amount' : 'amount';
  const feeRow = await T(SRC_COMMON, FEE_SYNC_T).where({ source_id: `${TAG}-F1`, is_deleted: 0 }).first();
  if (feeRow?.id) reg(SRC_COMMON, FEE_SYNC_T, feeRow.id);
  check(
    `★ 费用副本落库：${AMT_COL}=888800 / paid_amount=100000`,
    !!feeRow && Number(feeRow[AMT_COL]) === 888800 && Number(feeRow.paid_amount) === 100000,
    JSON.stringify(feeRow),
  );

  const rFeeList = await call(FEE, `/list?studentNo=${encodeURIComponent(stu1.student_no)}`);
  const feeListItem = rFeeList.json?.data?.list?.[0];
  check(
    '★★ 费用 /list 金额读到非零（读路径按开关取 fee_amount，写死 amount 会恒为 0）',
    isOk(rFeeList) && Number(feeListItem?.amount ?? 0) === 888800 &&
      feeListItem?.amountYuan === '8888.00' &&
      feeListItem?.unpaidAmountYuan === '7888.00',
    JSON.stringify(feeListItem),
  );

  const rFeeSum = await call(FEE, `/summary?studentId=${stu1.id}`);
  check(
    '★ 费用 /summary 应收 888800 / 已收 100000 / 欠788800',
    isOk(rFeeSum) &&
      Number(rFeeSum.json?.data?.totalAmount ?? 0) === 888800 &&
      Number(rFeeSum.json?.data?.totalPaid ?? 0) === 100000 &&
      Number(rFeeSum.json?.data?.totalUnpaid ?? 0) === 788800,
    JSON.stringify(rFeeSum.json?.data),
  );

  // student.route 的欠费统计（whereRaw 里的列名也要跟着切）
  // ★ 欠费统计在 **`/statistics`**（列表顶部统计卡片）里，不在 `/list` ——
  //   `/list` 返回的是分页记录，断言写在它上面永远拿 undefined。
  const rStuStat = await call(`${BASE}/api/class/student`, `/statistics?classId=${cls.id}`);
  check(
    '★★ 学生统计卡欠费人数 > 0（whereRaw 列名必须同步切到 fee_amount）',
    isOk(rStuStat) && Number(rStuStat.json?.data?.dueCount ?? 0) >= 1,
    `dueCount=${rStuStat.json?.data?.dueCount} dueAmount=${rStuStat.json?.data?.dueAmount}`,
  );

  /* ================= ⑥ 权限收敛 ================= */
  const rNoPermAdd = await call(URGE, '/do', {
    method: 'POST',
    body: { urgeId: urgeRow?.id, channel: 'phone' },
  });
  check('校长 token 调催费 /do 成功（权限允许）', isOk(rNoPermAdd), `code=${rNoPermAdd.json?.code}`);

  const anon = await req(`${ATT}/list`);
  check('未登录被拒', anon.json?.code === 40101, `code=${anon.json?.code}`);

  await cleanup();
}

main()
  .catch((e) => {
    console.error('自检异常:', e);
    dumpBackendError();
    process.exitCode = 1;
  })
  .finally(async () => {
    summary();
    await db.destroy().catch(() => {});
    await cdb.destroy().catch(() => {});
    killAll();
  });