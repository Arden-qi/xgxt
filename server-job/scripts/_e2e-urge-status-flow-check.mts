/**
 * 自检：催费「登记缴费」→「已缴」→ 财务「核对」→「已核对」整条状态链
 * ============================================================
 * 【用户口径（2026-10-23）】
 *   「催费模块上交缴费截图后缴费状态就变为已缴，财务核对后变为已核对。」
 *
 * 【要防的断点】
 *   催费页登记缴费只改了自己那张表，财务单如果还是「待缴(1)」，
 *   财务点「核对」第一步就被拦：「该缴费单尚未缴费，无法核对」
 *   → 催费永远停在「已缴(2)」，到不了「已核对(3)」。
 *   （财务自己 `attachVoucher()` 回传凭证时会把 1 推到 2，催费这条链路原来漏了这一步。）
 *
 * 【本脚本验证】
 *   ① 登记前：催费行与财务单都是 1「待缴」
 *   ② 登记缴费（真实 HTTP /api/class-jh/fee/voucher）后：
 *      · 催费行 → 2「已缴」，凭证落库
 *      · 财务单 → 2「已缴」，凭证同步落库（否则财务核对不了）
 *   ③ 财务核对（真实 HTTP /api/finance/fee/verify）后：
 *      · 财务单 → 3「已核对」+ is_verified
 *      · 催费行**原地** → 3「已核对」，且同科目仍只有 1 行（不新增）
 *
 * 【夹具安全】
 *   · 财务单 / 催费行都用本脚本生成的 `TSTF...` 前缀 id，收尾按 id 精确**软删**
 *   · 学生取库里真实存在的一条，但费用项用 7（押金），与演示数据的 1/2/3 / 学费 错开
 *
 * 用法（server-job 目录，需 8004 已启动）：
 *   npx tsx scripts/_e2e-urge-status-flow-check.mts
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(ROOT, '.env') });

const knex = (await import('knex')).default;

const mkconn = (database: string) =>
  knex({
    client: 'mysql2',
    connection: {
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD ?? '',
      database,
      charset: 'utf8mb4',
      timezone: '+08:00',
      dateStrings: true,
    },
    pool: { min: 0, max: 3 },
  });

const common = mkconn(process.env.DB_NAME_COMMON || 'sms_common');
const finance = mkconn(process.env.DB_NAME_FINANCE || 'sms_finance');

const BASE = process.env.E2E_BASE || 'http://127.0.0.1:8004';
const PASS = '123456';

/* ---------------- 断言器 ---------------- */
const results: Array<{ name: string; ok: boolean }> = [];
function check(name: string, ok: boolean, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? '  ✅' : '  ❌'} ${name}${detail ? '  —— ' + detail : ''}`);
}
const uuid = (p = 'TSTF') => p + Math.random().toString(36).slice(2, 10).toUpperCase();

/** 收尾清单（软删，禁止物理删除） */
const cleanup: Array<{ db: any; table: string; ids: string[] }> = [];
function track(db: any, table: string, id: string) {
  let g = cleanup.find((x) => x.db === db && x.table === table);
  if (!g) cleanup.push((g = { db, table, ids: [] }));
  g.ids.push(id);
}
async function purge() {
  for (const g of cleanup) {
    try {
      await g.db(g.table).whereIn('id', g.ids).update({ is_deleted: 1 });
    } catch (e) {
      console.log(`  清理 ${g.table} 失败：${(e as Error).message}`);
    }
  }
}

/* ---------------- HTTP ---------------- */
async function login(account: string): Promise<string> {
  const r = await fetch(`${BASE}/api/portal/account/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account, password: PASS }),
  });
  const j: any = await r.json();
  return j?.data?.token || '';
}

async function post(url: string, token: string, body: unknown): Promise<any> {
  const r = await fetch(`${BASE}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return r.json();
}

/** 1×1 透明 PNG，够 saveVoucherImage 落盘即可 */
const DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const FEE_TYPE = 7; // 押金：与演示数据的 1/2/3 错开
const ST_UNPAID = 1;
const ST_PAID = 2;
const ST_VERIFIED = 3;
const STAGE = 'jh';

async function main() {
  console.log('\n===== 催费登记 → 已缴 → 财务核对 → 已核对 =====\n');

  /* ---- 0. 服务就绪 ---- */
  try {
    const h = await fetch(`${BASE}/health`);
    check('后端已就绪（8004/health）', h.ok, `HTTP ${h.status}`);
    if (!h.ok) return;
  } catch (e) {
    check('后端已就绪（8004/health）', false, (e as Error).message);
    return;
  }

  /* ---- 1. 取一个真实初高学生 + 确认该科目原本没有数据 ---- */
  const stu = (await common.raw(
    `SELECT student_no, student_name, student_id, class_id, class_name
       FROM t_uni_fee WHERE edu_stage=? AND is_deleted=0 AND student_no<>'' LIMIT 1`,
    [STAGE],
  ))[0] as any[];
  if (!stu.length) {
    check('取到初高学生（用于造夹具）', false);
    return;
  }
  const s = stu[0];
  const studentNo = String(s.student_no);

  const existed = (await common.raw(
    `SELECT COUNT(*) c FROM t_uni_fee WHERE edu_stage=? AND student_no=? AND fee_type=? AND is_deleted=0`,
    [STAGE, studentNo, FEE_TYPE],
  ))[0] as any[];
  check('前置：该学生该科目原本没有数据（避免历史脏数据干扰）', Number(existed[0].c) === 0, `现有 ${existed[0].c} 行`);

  /* ---- 2. 造财务缴费单（待缴、未核对、无凭证） ---- */
  const finTemplate = (
    await finance.raw('SELECT * FROM t_finance_fee WHERE is_deleted=0 ORDER BY create_time DESC LIMIT 1')
  )[0] as any[];
  if (!finTemplate.length) {
    check('取到财务缴费单模板', false);
    return;
  }
  const financeId = uuid('TSTF');
  const nowStr = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const finRow: Record<string, any> = {
    ...finTemplate[0],
    id: financeId,
    student_no: studentNo,
    student_name: s.student_name || finTemplate[0].student_name,
    class_id: s.class_id ?? finTemplate[0].class_id,
    class_name: s.class_name ?? finTemplate[0].class_name,
    fee_type: FEE_TYPE,
    amount: 50000,
    // ★ 必须是 1（初高部）：syncFeeToJh 只推 dept_code=1 的单，
    //   模板行如果是就业/大学的，同步会被直接 return（本脚本第一版就踩了这个）
    dept_code: 1,
    pay_status: ST_UNPAID,
    is_verified: 0,
    verified_by: null,
    verified_by_name: null,
    verified_time: null,
    is_rejected: 0,
    reject_reason: null,
    voucher_url: null,
    voucher_no: null,
    voucher_by: null,
    voucher_time: null,
    pay_date: null,
    is_in_bill: 0,
    is_deleted: 0,
    create_time: nowStr,
    update_time: nowStr,
  };
  await finance('t_finance_fee').insert(finRow);
  track(finance, 't_finance_fee', financeId);

  /* ---- 3. 造催费台账行（财务来源、待缴） ---- */
  const feeTemplate = (
    await common.raw('SELECT * FROM t_uni_fee WHERE edu_stage=? AND is_deleted=0 LIMIT 1', [STAGE])
  )[0] as any[];
  if (!feeTemplate.length) {
    check('取到催费台账模板', false);
    return;
  }
  const urgeId = uuid('TSTU');
  const urgeRow: Record<string, any> = {
    ...feeTemplate[0],
    id: urgeId,
    edu_stage: STAGE,
    student_id: s.student_id,
    student_no: studentNo,
    student_name: s.student_name || feeTemplate[0].student_name,
    class_id: s.class_id ?? feeTemplate[0].class_id,
    class_name: s.class_name ?? feeTemplate[0].class_name,
    fee_type: FEE_TYPE,
    fee_amount: 50000,
    dept_code: 1,
    pay_status: ST_UNPAID,
    pay_date: null,
    pay_method: null,
    paid_amount: null,
    voucher_url: null,
    source_system: 'finance',
    source_id: financeId,
    is_deleted: 0,
    create_time: nowStr,
    update_time: nowStr,
  };
  await common('t_uni_fee').insert(urgeRow);
  track(common, 't_uni_fee', urgeId);

  const readUrge = async () =>
    (await common.raw('SELECT * FROM t_uni_fee WHERE id=?', [urgeId]))[0][0];
  const readFin = async () =>
    (await finance.raw('SELECT * FROM t_finance_fee WHERE id=?', [financeId]))[0][0];

  check('① 造好夹具：催费行 / 财务单都是「待缴(1)」', (await readUrge()).pay_status === ST_UNPAID && (await readFin()).pay_status === ST_UNPAID);

  /* ---- 4. 登记缴费（初高班主任 sunmin） ---- */
  const tJh = await login('sunmin');
  check('登录初高账号（登记缴费）', !!tJh);

  const payRes = await post('/api/class-jh/fee/voucher', tJh, {
    feeId: urgeId,
    payMethod: 1, // 微信支付 → 必须带截图
    paidAmount: 50000,
    payDate: '2026-10-20',
    remark: '自检：登记缴费',
    dataUrl: DATA_URL,
  });

  const urge1 = await readUrge();
  const fin1 = await readFin();

  check('② 登记缴费接口返回成功', Number(payRes?.code) === 200, `code=${payRes?.code} ${payRes?.message || ''}`);
  check('② 催费行 → 2「已缴」', Number(urge1.pay_status) === ST_PAID, `pay_status=${urge1.pay_status}`);
  check('② 催费行落库了凭证与实缴信息', !!urge1.voucher_url && Number(urge1.paid_amount) === 50000, `voucher=${urge1.voucher_url || '空'}`);
  check(
    '★ ② 财务单也跟着 → 2「已缴」（否则财务点不动「核对」）',
    Number(fin1.pay_status) === ST_PAID,
    `pay_status=${fin1.pay_status}`,
  );
  check('★ ② 财务单同步到了凭证（财务能看图核对）', !!fin1.voucher_url, `voucher=${fin1.voucher_url || '空'}`);

  /* ---- 5. 财务核对（admin 有 finance:fee:verify） ---- */
  const tFin = await login('admin');
  check('登录财务核对账号', !!tFin);

  const verifyRes = await post('/api/finance/fee/verify', tFin, { id: financeId, remark: '自检：核对' });
  const fin2 = await readFin();
  const urge2 = await readUrge();

  check('③ 核对接口返回成功', Number(verifyRes?.code) === 200, `code=${verifyRes?.code} ${verifyRes?.message || ''}`);
  check('③ 财务单 → 3「已核对」+ is_verified', Number(fin2.pay_status) === ST_VERIFIED && Number(fin2.is_verified) === 1, `pay_status=${fin2.pay_status} is_verified=${fin2.is_verified}`);
  check('★ ③ 催费行**原地** → 3「已核对」', Number(urge2.pay_status) === ST_VERIFIED, `pay_status=${urge2.pay_status}`);
  /**
   * ★ 2026-10-23 补：核对回写**不许把收款事实冲成空**
   *   用户反馈「核对后状态变了，但实缴金额、缴费方式这些字段没了」。
   *   财务表 `t_finance_fee` 根本没有 pay_method / paid_amount 两列
   *   → 回写时拿不到值，若照抄 null 就地清空催费侧登记好的信息。
   */
  check(
    '★ ③ 核对后缴费方式仍在（不被清空）',
    urge2.pay_method != null && String(urge2.pay_method) !== '',
    `pay_method=${urge2.pay_method}`,
  );
  check(
    '★ ③ 核对后实缴金额仍在（不被清空）',
    urge2.paid_amount != null && Number(urge2.paid_amount) === 50000,
    `paid_amount=${urge2.paid_amount}`,
  );
  check('★ ③ 核对后缴费日期仍在', !!urge2.pay_date, `pay_date=${urge2.pay_date}`);

  const same = (await common.raw(
    `SELECT COUNT(*) c FROM t_uni_fee WHERE edu_stage=? AND student_no=? AND fee_type=? AND is_deleted=0`,
    [STAGE, studentNo, FEE_TYPE],
  ))[0] as any[];
  check('③ 核对没有新增行（同科目仍 1 行）', Number(same[0].c) === 1, `实际 ${same[0].c} 行`);
  check('③ 催费行 id 未变（不是新插的一条）', (await readUrge()).id === urgeId);

  /* 账单也要收尾（verifyFee 生成了账单） */
  const bills = (await finance.raw('SELECT id FROM t_finance_bill WHERE source_id=?', [financeId]))[0] as any[];
  bills.forEach((b) => track(finance, 't_finance_bill', String(b.id)));

  /* ============================================================
   * 就业部同一条链（★ 2026-10-23 用户反馈就在这里中招）
   *   就业回写原来抄了 `pay_method: row.pay_method ?? null`，
   *   而财务表没有这两列 → 核对一次就把「微信支付 / 500 元」清空。
   *
   * 【为什么这里不走 HTTP】
   *   就业催费页的写权限只给就业部角色，演示库里没有同时具备
   *   「就业催费写权限 + 班主任/学管角色」的自检账号。
   *   而本 bug 完全在回写函数里 → 直接调 `syncFeeToJob()` 更精准，
   *   初高那条已经用真实 HTTP 覆盖了整条用户操作链。
   * ============================================================ */
  console.log('\n----- 就业部：核对后收款信息不许被清空 -----\n');

  const jobTpl = (
    await common.raw(
      `SELECT * FROM t_uni_fee WHERE edu_stage='job' AND is_deleted=0 AND student_no<>'' ORDER BY create_time ASC LIMIT 1`,
    )
  )[0] as any[];
  if (!jobTpl.length) {
    check('取到就业催费行模板', false);
    return;
  }
  const jt = jobTpl[0];
  const jobStudentNo = String(jt.student_no);

  const jobExisted = (await common.raw(
    `SELECT COUNT(*) c FROM t_uni_fee WHERE edu_stage='job' AND student_no=? AND fee_type=? AND is_deleted=0`,
    [jobStudentNo, FEE_TYPE],
  ))[0] as any[];
  check('前置（就业）：该学生该科目原本没有数据', Number(jobExisted[0].c) === 0, `现有 ${jobExisted[0].c} 行`);

  const jobFinId = uuid('TSTF');
  /** 财务单：班主任已在催费页登记过（已缴 2、有凭证与缴费日期），等财务核对 */
  await finance('t_finance_fee').insert({
    ...finTemplate[0],
    id: jobFinId,
    student_no: jobStudentNo,
    student_name: jt.student_name || finTemplate[0].student_name,
    class_id: jt.class_id ?? finTemplate[0].class_id,
    class_name: jt.class_name ?? finTemplate[0].class_name,
    fee_type: FEE_TYPE,
    amount: 50000,
    dept_code: 3, // 就业部
    pay_status: ST_PAID,
    is_verified: 0,
    verified_by: null,
    verified_by_name: null,
    verified_time: null,
    is_rejected: 0,
    reject_reason: null,
    voucher_url: '/uploads/voucher/selftest-job.png',
    voucher_no: null,
    voucher_by: 'selftest',
    voucher_time: nowStr,
    pay_date: '2026-10-20',
    remark: '微信支付',
    is_in_bill: 0,
    is_deleted: 0,
    create_time: nowStr,
    update_time: nowStr,
  });
  track(finance, 't_finance_fee', jobFinId);

  const jobUrgeId = uuid('TSTU');
  /** 催费行：班主任登记缴费后的状态（待缴→已缴，收款信息齐全） */
  await common('t_uni_fee').insert({
    ...jt,
    id: jobUrgeId,
    edu_stage: 'job',
    student_no: jobStudentNo,
    fee_type: FEE_TYPE,
    fee_amount: 50000,
    dept_code: 3,
    pay_status: ST_PAID,
    pay_method: 1,
    paid_amount: 50000,
    pay_date: '2026-10-20',
    pay_remark: '自检：就业登记缴费',
    voucher_url: '/uploads/voucher/selftest-job.png',
    source_system: 'finance',
    source_id: jobFinId,
    is_deleted: 0,
    create_time: nowStr,
    update_time: nowStr,
  });
  track(common, 't_uni_fee', jobUrgeId);

  const readJobUrge = async () =>
    (await common.raw('SELECT * FROM t_uni_fee WHERE id=?', [jobUrgeId]))[0][0];

  const { syncFeeToJob } = await import('../src/finance/services/class-sync');

  /* 场景 A：财务核对前的同步（pay_status=2）——先确认登记信息没被同步冲掉 */
  await syncFeeToJob(jobFinId);
  const jobA = await readJobUrge();
  check(
    '④ 同步（已缴）后：缴费方式 / 实缴金额 / 备注都还在',
    Number(jobA.pay_method) === 1 && Number(jobA.paid_amount) === 50000 && jobA.pay_remark === '自检：就业登记缴费',
    `method=${jobA.pay_method} paid=${jobA.paid_amount} remark=${jobA.pay_remark}`,
  );

  /* 场景 B：财务核对（pay_status=3）后的回写 —— 用户实际踩的就是这一步 */
  await finance('t_finance_fee').where({ id: jobFinId }).update({
    pay_status: ST_VERIFIED,
    is_verified: 1,
    verified_time: nowStr,
    update_time: nowStr,
  });
  await syncFeeToJob(jobFinId);
  const jobB = await readJobUrge();

  check('★ ④ 就业催费行原地 → 3「已核对」', Number(jobB.pay_status) === ST_VERIFIED, `pay_status=${jobB.pay_status}`);
  check(
    '★★ ④ 核对后「缴费方式」仍在（这次用户反馈的核心）',
    Number(jobB.pay_method) === 1,
    `pay_method=${jobB.pay_method}`,
  );
  check(
    '★★ ④ 核对后「实缴金额」仍在',
    Number(jobB.paid_amount) === 50000,
    `paid_amount=${jobB.paid_amount}`,
  );
  check('★ ④ 核对后缴费日期仍在', jobB.pay_date === '2026-10-20', `pay_date=${jobB.pay_date}`);
  check('★ ④ 核对后缴费备注仍在', jobB.pay_remark === '自检：就业登记缴费', `pay_remark=${jobB.pay_remark}`);
  check('★ ④ 核对后凭证仍在', jobB.voucher_url === '/uploads/voucher/selftest-job.png', `voucher=${jobB.voucher_url}`);

  /* ---- 汇总 ---- */
  const pass = results.filter((r) => r.ok).length;
  console.log(`\n===== 结果：${pass}/${results.length} 通过 =====\n`);
  if (pass !== results.length) process.exitCode = 1;
}

try {
  await main();
} catch (e) {
  console.error('\n脚本异常：', (e as Error).message);
  process.exitCode = 1;
} finally {
  await purge();
  await common.destroy();
  await finance.destroy();
}
