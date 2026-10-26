/**
 * 自检：财务「打回」→ 催费列表显示「核对失败(6)」→ 重新登记 → 「已缴(2)」→ 核对 → 「已核对(3)」
 * ============================================================
 * 【用户口径（2026-10-25）】
 *   「催费模块增加核对失败状态，财务打回信息后对应行显示状态为核对失败。」
 *
 * 【要防的断点】
 *   财务打回（`finance/services/fee.service.ts::rejectFee`）做的是
 *   `pay_status = 2 已缴 + is_rejected = 1 + reject_reason`，
 *   如果催费侧照搬这个 2，班主任在催费列表看到的还是「已缴」，
 *   压根不知道截图被打回了，也就不会去重传 —— 打回等于没打回。
 *
 * 【本脚本验证】
 *   ① 造一张「已缴(2) + 有凭证」的财务单 + 对应催费行（两边都是 2）
 *   ② 财务打回（真实 HTTP /api/finance/fee/reject）后：
 *      · 财务单：pay_status 仍是 2、is_rejected = 1、reject_reason 落库
 *      · 催费行：**pay_status = 6 核对失败**（不是 2）
 *      · 催费列表接口按 payStatus=6 能筛到它，且 payStatusName = 「核对失败」
 *   ③ 班主任重新登记缴费（真实 HTTP /api/class-jh/fee/voucher）后：
 *      · 催费行回到 2 已缴、财务单 is_rejected 清 0（否则下次同步又变回 6）
 *   ④ 财务核对（真实 HTTP /api/finance/fee/verify）后：两边都 → 3 已核对
 *   ⑤ 就业侧派生：库里 6 + 已过应缴日，列表必须仍显示 6（不许掉成 4 逾期）
 *
 * 【夹具安全】
 *   · 财务单 / 催费行都用 `TSTF…` `TSTU…` 前缀 id，收尾按 id 精确**软删**
 *   · 费用项统一用 7（押金），与演示数据的 1/2/3 错开
 *
 * 用法（server-job 目录，需 8004 已启动）：
 *   npx tsx scripts/_e2e-urge-reject-check.mts
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// 状态名直接取共享包，确保「6 → 核对失败」这条映射真的在产物里
import { PAY_STATUS_NAME, PayStatus } from 'shared-types/class-jh';

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

async function get(url: string, token: string): Promise<any> {
  const r = await fetch(`${BASE}${url}`, { headers: { Authorization: `Bearer ${token}` } });
  return r.json();
}

/** 1×1 透明 PNG，够 saveVoucherImage 落盘即可 */
const DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const FEE_TYPE = 7; // 押金：与演示数据的 1/2/3 错开
const ST_UNPAID = PayStatus.UNPAID;
const ST_PAID = PayStatus.PAID;
const ST_VERIFIED = PayStatus.VERIFIED;
const ST_REJECTED = PayStatus.REJECTED;
const STAGE = 'jh';

/** 今天 + n 天（YYYY-MM-DD）：初高列表有「到期日距今 ≤ 20 天」窗口，夹具要落在窗口内 */
function dayOffset(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function nowStr(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

async function main() {
  console.log('\n===== 财务打回 → 催费「核对失败」→ 重传 → 已缴 → 核对 =====\n');

  /* ---- 0. 服务就绪 ---- */
  try {
    const h = await fetch(`${BASE}/health`);
    check('后端已就绪（8004/health）', h.ok, `HTTP ${h.status}`);
    if (!h.ok) return;
  } catch (e) {
    check('后端已就绪（8004/health）', false, (e as Error).message);
    return;
  }

  check(
    '状态名映射：6 → 「核对失败」',
    PAY_STATUS_NAME[6] === '核对失败',
    `PAY_STATUS_NAME[6]=${PAY_STATUS_NAME[6] ?? '(空)'}`,
  );

  /* ---- 1. 取真实初高学生，确认该科目原本没有数据 ---- */
  const stuRows = (await common.raw(
    `SELECT student_no, student_name, student_id, class_id, class_name
       FROM t_uni_fee WHERE edu_stage=? AND is_deleted=0 AND student_no<>'' LIMIT 1`,
    [STAGE],
  ))[0] as any[];
  if (!stuRows.length) {
    check('取到初高学生（用于造夹具）', false);
    return;
  }
  const s = stuRows[0];
  const studentNo = String(s.student_no);

  const existed = (await common.raw(
    `SELECT COUNT(*) c FROM t_uni_fee WHERE edu_stage=? AND student_no=? AND fee_type=? AND is_deleted=0`,
    [STAGE, studentNo, FEE_TYPE],
  ))[0] as any[];
  check('前置：该学生该科目原本没有数据', Number(existed[0].c) === 0, `现有 ${existed[0].c} 行`);

  /* ---- 2. 造「已缴 + 有凭证」的财务单（模拟班主任已登记、等财务核对） ---- */
  const finTpl = (
    await finance.raw('SELECT * FROM t_finance_fee WHERE is_deleted=0 ORDER BY create_time DESC LIMIT 1')
  )[0] as any[];
  if (!finTpl.length) {
    check('取到财务缴费单模板', false);
    return;
  }
  const financeId = uuid('TSTF');
  const t0 = nowStr();
  await finance('t_finance_fee').insert({
    ...finTpl[0],
    id: financeId,
    student_no: studentNo,
    student_name: s.student_name || finTpl[0].student_name,
    class_id: s.class_id ?? finTpl[0].class_id,
    class_name: s.class_name ?? finTpl[0].class_name,
    fee_type: FEE_TYPE,
    amount: 50000,
    expire_date: dayOffset(3),
    // ★ 必须 1（初高部）：syncFeeToJh 只推 dept_code=1
    dept_code: 1,
    pay_status: ST_PAID, // 已缴，等财务核对
    is_verified: 0,
    verified_by: null,
    verified_by_name: null,
    verified_time: null,
    is_rejected: 0,
    reject_reason: null,
    voucher_url: '/uploads/voucher/selftest-reject.png',
    voucher_by: 'selftest',
    voucher_time: t0,
    pay_date: dayOffset(-1),
    is_in_bill: 0,
    is_deleted: 0,
    create_time: t0,
    update_time: t0,
  });
  track(finance, 't_finance_fee', financeId);

  /* ---- 3. 造对应催费行（已缴 2，财务来源） ---- */
  const feeTpl = (
    await common.raw('SELECT * FROM t_uni_fee WHERE edu_stage=? AND is_deleted=0 LIMIT 1', [STAGE])
  )[0] as any[];
  if (!feeTpl.length) {
    check('取到催费台账模板', false);
    return;
  }
  const urgeId = uuid('TSTU');
  await common('t_uni_fee').insert({
    ...feeTpl[0],
    id: urgeId,
    edu_stage: STAGE,
    student_id: s.student_id,
    student_no: studentNo,
    student_name: s.student_name || feeTpl[0].student_name,
    class_id: s.class_id ?? feeTpl[0].class_id,
    class_name: s.class_name ?? feeTpl[0].class_name,
    fee_type: FEE_TYPE,
    fee_amount: 50000,
    dept_code: 1,
    expire_date: dayOffset(3),
    pay_status: ST_PAID,
    pay_date: dayOffset(-1),
    pay_method: 1,
    paid_amount: 50000,
    pay_remark: '自检：打回前',
    voucher_url: '/uploads/voucher/selftest-reject.png',
    source_system: 'finance',
    source_id: financeId,
    is_deleted: 0,
    create_time: t0,
    update_time: t0,
  });
  track(common, 't_uni_fee', urgeId);

  const readUrge = async () => (await common.raw('SELECT * FROM t_uni_fee WHERE id=?', [urgeId]))[0][0];
  const readFin = async () => (await finance.raw('SELECT * FROM t_finance_fee WHERE id=?', [financeId]))[0][0];

  check(
    '① 夹具就绪：财务单 / 催费行都是「已缴(2)」',
    Number((await readFin()).pay_status) === ST_PAID && Number((await readUrge()).pay_status) === ST_PAID,
  );

  /* ---- 4. 财务打回 ---- */
  const tFin = await login('admin');
  check('登录财务核对账号（admin）', !!tFin);

  const REJECT_REASON = '自检：截图金额与应缴不一致，请重传';
  const rejectRes = await post('/api/finance/fee/reject', tFin, {
    id: financeId,
    rejectReason: REJECT_REASON,
  });
  const fin1 = await readFin();
  const urge1 = await readUrge();

  check('② 打回接口返回成功', Number(rejectRes?.code) === 200, `code=${rejectRes?.code} ${rejectRes?.message || ''}`);
  check(
    '② 财务单：状态仍 2「已缴」但 is_rejected=1 + 原因落库',
    Number(fin1.pay_status) === ST_PAID && Number(fin1.is_rejected) === 1 && fin1.reject_reason === REJECT_REASON,
    `pay_status=${fin1.pay_status} is_rejected=${fin1.is_rejected} reason=${fin1.reject_reason}`,
  );
  check(
    '★★ ② 催费行 → 6「核对失败」（用户核心诉求）',
    Number(urge1.pay_status) === ST_REJECTED,
    `pay_status=${urge1.pay_status}`,
  );

  /* ---- 5. 催费列表按「核对失败」能筛到，且名字是中文 ---- */
  const tList = await login('admin');
  const listRes = await get(
    `/api/class-jh/fee/list?page=1&size=100&payStatus=${ST_REJECTED}&keyword=${encodeURIComponent(studentNo)}`,
    tList,
  );
  const row = (listRes?.data?.list || []).find((x: any) => x.feeId === urgeId);
  check('② 催费列表能按「核对失败」筛出这条', !!row, row ? `feeId=${row.feeId}` : '列表里没找到');
  check(
    '② 列表返回的 payStatusName = 「核对失败」',
    row?.payStatusName === '核对失败',
    `payStatusName=${row?.payStatusName ?? '(空)'}`,
  );

  /* ---- 6. 班主任重新登记缴费（重传截图）---- */
  const tJh = await login('sunmin');
  check('登录初高班主任（登记缴费）', !!tJh);

  const payRes = await post('/api/class-jh/fee/voucher', tJh, {
    feeId: urgeId,
    payMethod: 1,
    paidAmount: 50000,
    payDate: dayOffset(0),
    remark: '自检：打回后重传',
    dataUrl: DATA_URL,
  });
  const urge2 = await readUrge();
  const fin2 = await readFin();

  check('③ 重新登记接口返回成功', Number(payRes?.code) === 200, `code=${payRes?.code} ${payRes?.message || ''}`);
  check(
    '★★ ③ 催费行回到 2「已缴」（不再是核对失败）',
    Number(urge2.pay_status) === ST_PAID,
    `pay_status=${urge2.pay_status}`,
  );
  check(
    '★ ③ 财务单「打回」标记已清（否则下次同步又变回 6）',
    Number(fin2.is_rejected) === 0 && !fin2.reject_reason,
    `is_rejected=${fin2.is_rejected} reason=${fin2.reject_reason}`,
  );
  check(
    '★ ③ 重传后凭证仍是新上传的（不是被清空）',
    !!urge2.voucher_url && !!fin2.voucher_url,
    `urge=${urge2.voucher_url} fin=${fin2.voucher_url}`,
  );

  /* ---- 7. 财务核对 → 两边 3 ---- */
  const verifyRes = await post('/api/finance/fee/verify', tFin, { id: financeId, remark: '自检：重传后核对' });
  const urge3 = await readUrge();
  const fin3 = await readFin();
  check('④ 核对接口返回成功', Number(verifyRes?.code) === 200, `code=${verifyRes?.code} ${verifyRes?.message || ''}`);
  check(
    '④ 核对后：财务单 3 + 催费行 3',
    Number(fin3.pay_status) === ST_VERIFIED && Number(urge3.pay_status) === ST_VERIFIED,
    `fin=${fin3.pay_status} urge=${urge3.pay_status}`,
  );
  const same = (await common.raw(
    `SELECT COUNT(*) c FROM t_uni_fee WHERE edu_stage=? AND student_no=? AND fee_type=? AND is_deleted=0`,
    [STAGE, studentNo, FEE_TYPE],
  ))[0] as any[];
  check('④ 全程没有多插行（同科目仍 1 行）', Number(same[0].c) === 1, `实际 ${same[0].c} 行`);

  /* 账单也收尾（verifyFee 生成了账单） */
  const bills = (await finance.raw('SELECT id FROM t_finance_bill WHERE source_id=?', [financeId]))[0] as any[];
  bills.forEach((b) => track(finance, 't_finance_bill', String(b.id)));

  /* ============================================================
   * 8. 就业侧派生：库里 6 + 已过应缴日，列表必须仍是 6（不许掉成 4）
   *    就业 effectivePayStatus 原来是「非 2/3/5 → 过期就是 4」，
   *    6 会掉进最后的兜底分支 → 用户会看到「核对失败」被显示成「逾期」。
   * ============================================================ */
  console.log('\n----- 就业部：核对失败不许被派生成「逾期」 -----\n');

  const jobTpl = (
    await common.raw(
      `SELECT * FROM t_uni_fee WHERE edu_stage='job' AND is_deleted=0 AND student_no<>'' ORDER BY create_time ASC LIMIT 1`,
    )
  )[0] as any[];
  if (!jobTpl.length) {
    check('取到就业催费行模板', false);
  } else {
    const jt = jobTpl[0];
    const jobNo = String(jt.student_no);
    const jobExisted = (await common.raw(
      `SELECT COUNT(*) c FROM t_uni_fee WHERE edu_stage='job' AND student_no=? AND fee_type=? AND is_deleted=0`,
      [jobNo, FEE_TYPE],
    ))[0] as any[];
    check('前置（就业）：该学生该科目原本没有数据', Number(jobExisted[0].c) === 0, `现有 ${jobExisted[0].c} 行`);

    const jobUrgeId = uuid('TSTU');
    await common('t_uni_fee').insert({
      ...jt,
      id: jobUrgeId,
      edu_stage: 'job',
      student_no: jobNo,
      fee_type: FEE_TYPE,
      fee_amount: 50000,
      dept_code: 3,
      pay_status: ST_REJECTED,
      // 故意给一个过去的应缴日：如果派生写错，就会显示成「逾期 4」
      expire_date: dayOffset(-5),
      due_date: dayOffset(-5),
      pay_method: 1,
      paid_amount: 50000,
      pay_date: dayOffset(-2),
      source_system: 'finance',
      source_id: uuid('TSTF'),
      is_deleted: 0,
      create_time: t0,
      update_time: t0,
    });
    track(common, 't_uni_fee', jobUrgeId);

    const jobList = await get(
      `/api/job/fee-call/page?page=1&size=100&payStatus=${ST_REJECTED}&keyword=${encodeURIComponent(jobNo)}`,
      tList,
    );
    const jrow = (jobList?.data?.list || []).find((x: any) => x.id === jobUrgeId);
    check('⑤ 就业列表按「核对失败」能筛到这条', !!jrow, jrow ? `id=${jrow.id}` : '列表里没找到');
    check(
      '★★ ⑤ 就业：6 没被派生成 4「逾期」',
      Number(jrow?.payStatus) === ST_REJECTED,
      `payStatus=${jrow?.payStatus} name=${jrow?.payStatusName}`,
    );
    check('⑤ 就业：状态名 = 「核对失败」', jrow?.payStatusName === '核对失败', `name=${jrow?.payStatusName ?? '(空)'}`);
  }

  /* ---- 汇总 ---- */
  const pass = results.filter((r) => r.ok).length;
  console.log(`\n===== 结果：${pass}/${results.length} 通过 =====\n`);
  if (pass !== results.length) {
    results.filter((r) => !r.ok).forEach((r) => console.log(`  ❌ ${r.name}`));
  }

  await purge();
  console.log('（夹具已按 id 软删）');
  await Promise.all([common.destroy(), finance.destroy()]);
  process.exit(pass === results.length ? 0 : 1);
}

main().catch(async (e) => {
  console.error('自检异常：', e);
  await purge();
  await Promise.all([common.destroy().catch(() => {}), finance.destroy().catch(() => {})]);
  process.exit(1);
});
