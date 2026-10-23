/**
 * 自检：退费 / 催费 / 休学退学审批 —— 大学部与就业部的数据打通（2026-10-22 用户要求）
 * ============================================================
 *
 * 【需求原文】
 *   「退费、催费、休学/退学审批 要增加大学部和就业部的数据；
 *     大学和就业催费列表来源都来自催费，都能上传凭证且批量上传到财务」
 *
 * 【改造前实测到的三个根因】
 *   ① 权限：大学班主任（TEACH_HEAD）的页面清单里没有 `class:refund:view` /
 *      `class:suspend:view`；就业老师（JOB_STAFF）没有 `job:feeCall:view` /
 *      `job:refund:view` / `job:suspendApproval:view` →
 *      这两个角色进页面直接 40302，**部门下拉里永远只有自己那一个部门**。
 *   ② 催费「批量上传到财务」只服务初高：后端硬判断 dept_code=1，
 *      前端按钮 v-if 只在 初高/全部部门 时渲染。
 *   ③ 退费推财务**不传 deptCode** → 财务侧 `t_finance_refund.dept_code` 恒为 NULL。
 *
 * 【本脚本钉住什么】
 *   A. 静态契约：权限清单、推财务带 deptCode、前端守卫已删、财务部门字典有 3=就业部
 *   B. 表结构：三张催费表 + 统一表都有 finance_fee_id / finance_transfer_time
 *   C. 真实权限：大学班主任 / 就业老师进得去各自部门的退费、催费、异动
 *   D. 真实转交（造夹具 → 转 → 验 → 清）：
 *      · 大学部（无财务原单）→ 财务新建 dept_code=2
 *      · 大学部（有财务原单）→ 只补凭证，不新建（★ 用户拍板的口径）
 *      · 就业部 → 财务新建 dept_code=3
 *      · 重复转交 → 全部跳过
 *
 *   ★ 2026-10-23 用户追加两条需求，本段一并钉住：
 *      D-1「列表只显示没有上传过的」：转交完再取候选，这几条必须**消失**；
 *      D-2「大学部转交后财务侧没有对应信息」：转交新建的财务单**没有凭证**
 *          （现金/线下），财务列表也必须能查到、能核对。
 *
 *   ⚠️ 夹具写在**统一表**（`sms_common.t_uni_urge` / `t_uni_fee`）：
 *      P8 之后催费老表已 DROP，候选接口一律走 `tbl()` → 统一表，
 *      夹具还写老表 = 写进空气，整个 D 段全是「催费单不存在或已删除」。
 *
 * 【跑法】在 server-job 目录下（前后端已在 8004/5173 运行）：
 *     node scripts/_test-dept-three-modules.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { BASE, login, makeChecker, req } from './_e2e-lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const { check, summary } = makeChecker();

const read = (rel) => {
  try {
    return readFileSync(path.join(ROOT, rel), 'utf8');
  } catch {
    return '';
  }
};

const db = await mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: process.env.DB_PASSWORD || 'Meng1210',
  multipleStatements: true,
  dateStrings: true,
});
const q = async (sql, p = []) => (await db.query(sql, p))[0];

/* 夹具 id（跑完必删） */
const FIX_CLASS = 'test3dept-tr-class';
const FIX_CLASS_EXIST = 'test3dept-tr-class-exist';
const FIX_EMPLOY = 'test3dept-tr-employ';
const createdFinanceIds = [];

async function columnsOf(schema, table) {
  const rows = await q(
    'SELECT COLUMN_NAME n FROM information_schema.columns WHERE TABLE_SCHEMA=? AND TABLE_NAME=?',
    [schema, table],
  );
  return new Set(rows.map((r) => r.n));
}

async function main() {
  /* ============================================================
   * A. 静态契约
   * ============================================================ */
  console.log('\n[A] 静态契约');

  const permSrc = read('server-job/src/utils/pagePermissionSource.ts');
  const classStaffBlock = permSrc.slice(
    permSrc.indexOf('const CLASS_STAFF_PAGES'),
    permSrc.indexOf('const CLASS_STAFF_PAGES') + 2000,
  );
  check(
    '★ 班主任/教员/助教（大学部）页面清单含 class:refund:view',
    classStaffBlock.includes("'class:refund:view'"),
    '否则大学班主任进不去退费页 → 部门下拉只有初高',
  );
  check(
    '★ 班主任/教员/助教（大学部）页面清单含 class:suspend:view',
    classStaffBlock.includes("'class:suspend:view'"),
    '否则大学班主任进不去休学/退学审批',
  );

  const jobStaffBlock = permSrc.slice(
    permSrc.indexOf('[RoleCode.JOB_STAFF]'),
    permSrc.indexOf('[RoleCode.JOB_STAFF]') + 1500,
  );
  check(
    '★ 就业老师页面清单含 job:feeCall:view（催费）',
    jobStaffBlock.includes("'job:feeCall:view'"),
  );
  check(
    '★ 就业老师页面清单含 job:refund:view（退费）',
    jobStaffBlock.includes("'job:refund:view'"),
  );
  check(
    '★ 就业老师页面清单含 job:suspendApproval:view（休学/退学）',
    jobStaffBlock.includes("'job:suspendApproval:view'"),
  );

  const refundSvc = read('server-job/src/teaching/refund/service.ts');
  check(
    '★ 退费推财务带 deptCode（原来不传 → 财务侧部门恒 NULL）',
    refundSvc.includes('deptCode: STAGE_DEPT_CODE[stage]') && refundSvc.includes('EMPLOYMENT'),
  );
  check(
    '退费推财务的 sourceType 注释已更正（2 = 校长审批推送，不是「就业」）',
    !/sourceType:\s*2,\s*\/\/\s*2\s*=\s*就业/.test(refundSvc),
    '原来是 `sourceType: 2, // 2 = 就业（非咨询）`，与实际枚举（1 班主任提交 / 2 校长审批推送）不符',
  );

  const financeEnums = read('shared-types/src/finance/enums.ts');
  check(
    '★ 财务部门字典含 EMPLOYMENT = 3（就业部）',
    /EMPLOYMENT\s*=\s*3/.test(financeEnums) && financeEnums.includes("'就业部'"),
    '否则就业部的单在财务页面「部门」列显示空白',
  );

  const feeList = read('web-job/src/class-jh/views/FeeList.vue');
  check(
    '★ 催费页「批量上传到财务」不再只对初高显示',
    !feeList.includes("v-if=\"query.dept === 'jh' || query.dept === 'all'\""),
  );
  check(
    '★ 催费页转交走三部门统一接口（不再硬编码 dept:初高）',
    feeList.includes('fetchTransferCandidatesAll(') && !feeList.includes("dept: '初高' })"),
  );

  const transferRoute = read('server-job/src/teaching/fee/transfer.route.ts');
  check(
    '★ 转交判重只认 finance_fee_id（source_system=finance 现在是「同步来源」，不能当「已转交」）',
    transferRoute.includes('return !!row.finance_fee_id;'),
    '三部门的单现在都从财务同步，用 source_system 判重会把所有同步来的单判成已转交',
  );
  check(
    '★ 日期兼容 Date 对象（就业库没配 dateStrings，否则一条也转不过去）',
    transferRoute.includes('function toDateStr') && transferRoute.includes('v instanceof Date'),
  );
  check(
    '★ 财务已有原单 → 回写财务（凭证+方式+实缴+日期），不新建',
    transferRoute.includes('financeSyncPayment(') && transferRoute.includes('voucherOnly'),
    '改造前只调 attachVoucher（只能补凭证，现金无截图走不通），现在是 syncPaymentFromUpstream',
  );
  check(
    '财务回写函数能带「方式/实缴/日期」，现金也能回写',
    (() => {
      const svc = read('server-job/src/finance/services/fee.service.ts');
      return svc.includes('syncPaymentFromUpstream') && svc.includes('payMethodName') && svc.includes('paidAmount');
    })(),
  );

  /* ============================================================
   * B. 表结构
   * ============================================================ */
  console.log('\n[B] 表结构（迁移跑没跑一目了然）');

  for (const [schema, table] of [
    ['sms_class_jh', 't_class_fee'],
    ['sms_common', 't_class_urge_sync'],
    ['sms_job', 't_job_fee_call'],
    ['sms_common', 't_uni_urge'],
    // ★ 2026-10-23：就业催费的统一表（`t_job_fee_call` 的接班表）
    ['sms_common', 't_uni_fee'],
  ]) {
    // eslint-disable-next-line no-await-in-loop
    const cols = await columnsOf(schema, table);
    check(
      `${schema}.${table} 有 finance_fee_id / finance_transfer_time`,
      cols.has('finance_fee_id') && cols.has('finance_transfer_time'),
    );
  }

  /* ============================================================
   * C. 真实权限：三部门各角色进得去自己的页面
   * ============================================================ */
  console.log('\n[C] 真实权限（大学班主任 / 就业老师）');

  const tokZh = await login('zhanght'); // 大学班主任
  const tokZj = await login('zhouj'); // 就业老师
  const tokQ = await login('qiansy'); // 校长（造夹具/转交用）

  check('大学班主任能登录', !!tokZh);
  check('就业老师能登录', !!tokZj);
  check('校长能登录', !!tokQ);

  const refundZh = await req(`${BASE}/api/teaching/refund/summary`, { token: tokZh });
  check(
    '★ 大学班主任进得去退费页（summary 200）',
    refundZh.json?.code === 200,
    refundZh.json?.message || '',
  );
  const refundZj = await req(`${BASE}/api/teaching/refund/summary`, { token: tokZj });
  check(
    '★ 就业老师进得去退费页（summary 200）',
    refundZj.json?.code === 200,
    refundZj.json?.message || '',
  );

  const leaveZh = await req(`${BASE}/api/teaching/leave/list?stage=class&page=1&size=5`, { token: tokZh });
  check(
    '★ 大学班主任进得去休学/退学审批（class 列表 200）',
    leaveZh.json?.code === 200,
    leaveZh.json?.message || '',
  );
  const leaveZj = await req(`${BASE}/api/teaching/leave/list?stage=job&page=1&size=5`, { token: tokZj });
  check(
    '★ 就业老师进得去休学/退学审批（job 列表 200）',
    leaveZj.json?.code === 200,
    leaveZj.json?.message || '',
  );

  const feeZj = await req(`${BASE}/api/job/fee-call/page?page=1&size=5`, { token: tokZj });
  check(
    '★ 就业老师进得去催费页（就业列表 200）',
    feeZj.json?.code === 200,
    feeZj.json?.message || '',
  );

  const feeZh = await req(`${BASE}/api/class/urge/list?page=1&size=5`, { token: tokZh });
  check('大学班主任进得去催费页（大学列表 200）', feeZh.json?.code === 200, feeZh.json?.message || '');

  // 跨部门仍应被拦（权限放开不能放开越界）
  const cross = await req(`${BASE}/api/teaching/leave/list?stage=jh&page=1&size=5`, { token: tokZh });
  check(
    '学段隔离仍生效：大学班主任查初高异动被拒',
    cross.json?.code === 40302,
    cross.json?.message || '',
  );

  /* ============================================================
   * D. 真实转交（造夹具 → 转 → 验 → 清）
   * ============================================================ */
  console.log('\n[D] 批量上传到财务（三部门真实链路）');

  /**
   * ★ 为什么自己造一张财务单当「财务已有原单」
   *   库里现存的大学部费用单大多已经「已核对」，而财务的 attachVoucher 有一道
   *   正确保护：「已核对 + 已有凭证的单不允许再换图，需财务先打回」。
   *   拿那种单当夹具，只会测到那道保护，测不到我们的「只补凭证」分支。
   *   所以造一张**未核对、无凭证**的财务单，跑完删掉。
   */
  const FIN_SEED_ID = 'test3dept-fin-seed';
  await q('DELETE FROM sms_finance.t_finance_fee WHERE id=?', [FIN_SEED_ID]);
  await q(
    `INSERT INTO sms_finance.t_finance_fee
      (id, create_time, create_by, is_deleted, student_id, student_no, student_name,
       class_id, class_name, dept_code, fee_type, amount, pay_status, expire_date,
       voucher_url, is_verified, source_module)
     VALUES (?,NOW(),'selftest',0,'fin-seed-stu','TEST3DFIN','自检财务原单',
             NULL,NULL,2,1,88000,2,'2026-10-25',NULL,0,0)`,
    [FIN_SEED_ID],
  );
  const financeSeed = { id: FIN_SEED_ID };

  // 大学：无财务来源（source_system='test'）→ 应新建
  // ★ 2026-10-23：写统一表 `t_uni_urge`（老表 `t_class_urge_sync` 已 DROP）
  await q(`DELETE FROM sms_common.t_uni_urge WHERE id=?`, [FIX_CLASS]);
  await q(
    `INSERT INTO sms_common.t_uni_urge
      (id, edu_stage, create_time, is_deleted, source_system, source_id, sync_status,
       student_id, student_no, student_name, class_id, class_name, fee_type, amount,
       expire_date, pay_status, urge_count, pay_method, paid_amount, pay_date, pay_remark, voucher_url)
     VALUES (?, 'class', NOW(), 0, 'test', 'test-src', 2,
             'uni-tr-stu', 'TEST3D001', '自检大学', NULL, NULL, 1, 88000,
             '2026-10-25', 1, 0, 1, 88000, '2026-10-20', '自检·新建', NULL)`,
    [FIX_CLASS],
  );

  // 大学：财务里本来就有这张单 → 应只补凭证
  await q(`DELETE FROM sms_common.t_uni_urge WHERE id=?`, [FIX_CLASS_EXIST]);
  await q(
    `INSERT INTO sms_common.t_uni_urge
      (id, edu_stage, create_time, is_deleted, source_system, source_id, sync_status,
       student_id, student_no, student_name, class_id, class_name, fee_type, amount,
       expire_date, pay_status, urge_count, pay_method, paid_amount, pay_date, pay_remark, voucher_url)
     VALUES (?, 'class', NOW(), 0, 'finance', ?, 2,
             'fin-seed-stu', 'TEST3DFIN', '自检财务原单', NULL, NULL, 1, 88000,
             '2026-10-25', 1, 0, 2, 88000, '2026-10-21', '自检·补凭证', '/uploads/voucher/selftest-exist.png')`,
    [FIX_CLASS_EXIST, FIN_SEED_ID],
  );

  // 就业：应新建 —— 就业催费在统一表 `t_uni_fee`，靠 edu_stage='job' 收窄
  await q(`DELETE FROM sms_common.t_uni_fee WHERE id=?`, [FIX_EMPLOY]);
  await q(
    `INSERT INTO sms_common.t_uni_fee
      (id, edu_stage, create_time, is_deleted, source_system, source_id, sync_status,
       fee_type, student_id, student_no, student_name, class_id, class_name, dept_code,
       fee_amount, due_date, call_reason, call_status, pay_status,
       pay_method, paid_amount, pay_date, pay_remark, voucher_url)
     VALUES (?, 'job', NOW(), 0, 'test', 'test-src-job', 2,
             1, 'job-tr-stu', 'TEST3D002', '自检就业', NULL, NULL, 3,
             56000, '2026-10-24', '自检', 3, 1,
             '3', 56000, '2026-10-21', '自检·就业', NULL)`,
    [FIX_EMPLOY],
  );

  // 候选：三部门都要出现
  const cand = await req(`${BASE}/api/teaching/fee/transfer/candidates?dept=all`, { token: tokQ });
  const list = cand.json?.data?.list || [];
  const deptCount = (d) => list.filter((x) => x.dept === d).length;
  check(
    '★ 候选接口三部门都能取到数据（jh / class / employ 各 > 0）',
    deptCount('jh') > 0 && deptCount('class') > 0 && deptCount('employ') > 0,
    `jh=${deptCount('jh')} class=${deptCount('class')} employ=${deptCount('employ')}`,
  );
  check('候选接口没有部门级报错', (cand.json?.data?.errors || []).length === 0,
    JSON.stringify(cand.json?.data?.errors || []));

  const candClass = list.find((x) => x.feeId === FIX_CLASS);
  const candEmploy = list.find((x) => x.feeId === FIX_EMPLOY);
  check(
    '★ 大学部行「财务推来的」不再被误判为已转交（否则整个部门一条都转不出去）',
    !!candClass && candClass.transferred === false && candClass.financeFeeId === '',
  );
  check('就业部行出现在候选里', !!candEmploy && candEmploy.transferred === false);

  /* ★ 需求 D-1（2026-10-23）：候选列表整体不收「已上传过财务」的行 */
  const leaked = list.filter((x) => x.financeFeeId || x.transferred);
  check(
    '★ 候选列表只含「还没上传到财务」的行（已转交的一条都不返）',
    leaked.length === 0,
    `共 ${list.length} 行，其中已转交 ${leaked.length} 行：${leaked.slice(0, 3).map((x) => `${x.dept}/${x.feeId}`).join(', ')}`,
  );
  const statsClass = (cand.json?.data?.stats || []).find((s) => s.dept === 'class');
  check(
    '★ 候选接口返回「已上传 N 单」统计（弹窗要能说清为什么列表是空的）',
    !!statsClass && Number.isFinite(statsClass.transferred) && statsClass.transferred >= 1,
    JSON.stringify(statsClass || null),
  );

  // 提交转交
  const items = [
    { dept: 'class', feeId: FIX_CLASS },
    { dept: 'class', feeId: FIX_CLASS_EXIST },
    { dept: 'employ', feeId: FIX_EMPLOY },
  ];

  const tr = await req(`${BASE}/api/teaching/fee/transfer`, { method: 'POST', token: tokQ, body: { items } });
  const trData = tr.json?.data || {};
  if ((trData.failed || []).length) {
    console.log('     ↳ 失败明细：', JSON.stringify(trData.failed));
  }
  check(
    '★ 三部门一起转交：三条全部成功',
    tr.json?.code === 200 && trData.success === items.length,
    tr.json?.message || '',
  );
  check(
    '★ 大学部走「只补凭证」分支的条数 = 1（不新建财务单）',
    trData.voucherOnly === 1,
    `voucherOnly=${trData.voucherOnly}`,
  );

  const [classRow] = await q(
    "SELECT finance_fee_id FROM sms_common.t_uni_urge WHERE id=? AND edu_stage='class'",
    [FIX_CLASS],
  );
  const [employRow] = await q(
    "SELECT finance_fee_id FROM sms_common.t_uni_fee WHERE id=? AND edu_stage='job'",
    [FIX_EMPLOY],
  );
  check('★ 大学部转交后回写 finance_fee_id', !!classRow?.finance_fee_id, classRow?.finance_fee_id || '');
  check('★ 就业部转交后回写 finance_fee_id', !!employRow?.finance_fee_id, employRow?.finance_fee_id || '');

  if (classRow?.finance_fee_id) createdFinanceIds.push(classRow.finance_fee_id);
  if (employRow?.finance_fee_id) createdFinanceIds.push(employRow.finance_fee_id);

  if (createdFinanceIds.length) {
    const rows = await q(
      `SELECT id, dept_code, amount, pay_status FROM sms_finance.t_finance_fee
       WHERE id IN (${createdFinanceIds.map(() => '?').join(',')})`,
      createdFinanceIds,
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    check(
      '★ 大学部的财务单 dept_code = 2（大学部）',
      byId.get(classRow?.finance_fee_id)?.dept_code === 2,
      String(byId.get(classRow?.finance_fee_id)?.dept_code),
    );
    check(
      '★ 就业部的财务单 dept_code = 3（就业部）',
      byId.get(employRow?.finance_fee_id)?.dept_code === 3,
      String(byId.get(employRow?.finance_fee_id)?.dept_code),
    );
  }

  if (financeSeed) {
    const [x] = await q(
      "SELECT finance_fee_id FROM sms_common.t_uni_urge WHERE id=? AND edu_stage='class'",
      [FIX_CLASS_EXIST],
    );
    check(
      '★ 大学部「财务已有原单」回写的是原财务单 id（没有另建一张）',
      x?.finance_fee_id === financeSeed.id,
      `${x?.finance_fee_id} vs ${financeSeed.id}`,
    );
    const [f2] = await q('SELECT voucher_url FROM sms_finance.t_finance_fee WHERE id=?', [financeSeed.id]);
    check('★ 只补凭证分支：原财务单的凭证已更新', !!f2?.voucher_url, f2?.voucher_url || '');
  }

  // 重复转交必须全部跳过
  const again = await req(`${BASE}/api/teaching/fee/transfer`, { method: 'POST', token: tokQ, body: { items } });
  check(
    '★ 重复转交全部跳过（不会在财务里造重复单）',
    again.json?.data?.success === 0 && (again.json?.data?.skipped || []).length === items.length,
    again.json?.message || '',
  );

  /* ============================================================
   * D-1. 需求①：转交完成后，这几条必须从候选列表里消失
   * ============================================================ */
  const candAfter = await req(`${BASE}/api/teaching/fee/transfer/candidates?dept=all`, { token: tokQ });
  const left = (candAfter.json?.data?.list || []).filter((x) =>
    [FIX_CLASS, FIX_CLASS_EXIST, FIX_EMPLOY].includes(x.feeId),
  );
  check(
    '★ 需求①：已上传到财务的单不再出现在候选列表（列表只显示没上传过的）',
    left.length === 0,
    `残留 ${left.length} 条：${left.map((x) => `${x.dept}/${x.feeId}`).join(', ')}`,
  );

  /* ============================================================
   * D-2. 需求②：大学部转交后「财务侧没有对应信息」
   *      根因 = 财务列表硬约束「必须有凭证」，现金/线下转交的单被整条过滤掉
   * ============================================================ */
  const finTokD = await login('liukj'); // 财务专员
  if (classRow?.finance_fee_id) {
    const finList = await req(
      `${BASE}/api/finance/fee/list?page=1&size=50&studentNo=TEST3D001`,
      { token: finTokD },
    );
    const rows = finList.json?.data?.list || [];
    const finRow = rows.find((x) => x.id === classRow.finance_fee_id);
    check(
      '★ 需求②：大学部转交新建的财务单，财务缴费列表能查到（无凭证也在）',
      !!finRow,
      `code=${finList.json?.code} total=${finList.json?.data?.total} ${finList.json?.message || ''}`,
    );
    check(
      '★ 需求②：无凭证的转交单在财务侧可核对（canVerify=true）',
      finRow?.canVerify === true && finRow?.hasVoucher === false,
      JSON.stringify({ hasVoucher: finRow?.hasVoucher, canVerify: finRow?.canVerify, payStatus: finRow?.payStatus }),
    );
  } else {
    check('★ 需求②：大学部转交新建的财务单，财务缴费列表能查到（无凭证也在）', false, '上一步没回写 finance_fee_id，无法验证');
  }

  /* ============================================================
   * E. 退费推财务能接受 deptCode=3（就业部）
   * ============================================================ */
  console.log('\n[E] 财务退费接口接受部门码 3');

  const finTok = await login('liukj'); // 财务专员（持 finance:refund:apply）
  check('财务专员能登录', !!finTok);
  const applyRes = await req(`${BASE}/api/finance/refund/apply`, {
    method: 'POST',
    token: finTok,
    body: {
      studentId: 'self-test-refund-stu',
      studentNo: 'TEST3DREFUND',
      studentName: '自检退费',
      deptCode: 3,
      refundItems: [1],
      refundAmount: 100,
      refundReason: '自检：就业部退费部门码',
    },
  });
  const okApply = applyRes.json?.code === 200;
  check('★ 财务退费申请接受 deptCode=3（就业部）', okApply, applyRes.json?.message || '');
  if (okApply && applyRes.json?.data?.id) {
    const [r] = await q('SELECT dept_code FROM sms_finance.t_finance_refund WHERE id=?', [applyRes.json.data.id]);
    check('★ 财务退费单落库 dept_code = 3', r?.dept_code === 3, String(r?.dept_code));
    await q('DELETE FROM sms_finance.t_finance_refund WHERE id=?', [applyRes.json.data.id]);
  }
}

let allOk = false;
try {
  await main();
  allOk = summary();
} finally {
  /* ---------- 清理夹具（无论成败都要清） ---------- */
  try {
    await q("DELETE FROM sms_common.t_uni_urge WHERE id IN (?,?)", [FIX_CLASS, FIX_CLASS_EXIST]);
    await q("DELETE FROM sms_common.t_uni_fee WHERE id=? AND edu_stage='job'", [FIX_EMPLOY]);
    await q('DELETE FROM sms_finance.t_finance_fee WHERE id=?', ['test3dept-fin-seed']);
    if (createdFinanceIds.length) {
      await q(
        `DELETE FROM sms_finance.t_finance_fee WHERE id IN (${createdFinanceIds.map(() => '?').join(',')})`,
        createdFinanceIds,
      );
    }
    await q("DELETE FROM sms_finance.t_finance_refund WHERE student_no='TEST3DREFUND'");
    console.log('\n夹具已清理');
  } catch (e) {
    console.error('清理失败（请手工检查）：', e?.message);
  }
  await db.end();
}

process.exit(allOk ? 0 : 1);
