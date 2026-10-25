/**
 * 自检：「重新登记」的单要重新出现在「批量上传到财务」列表，并传到财务（不新建单）
 * ============================================================
 * 【用户口径（2026-10-25）】
 *   「重新登记也要出现在批量上传到财务列表中，传到财务。」
 *
 * 【要防的断点】
 *   候选原来是 `finance_fee_id IS NULL` 一票否决 —— 一条单只要上传过一次财务，
 *   之后班主任再怎么重新登记（改金额、换截图、打回后重传），都永远回不到候选列表，
 *   财务那张单也就永远收不到更新。
 *
 * 【本脚本验证】
 *   ① 造一条本地催费行 → 登记缴费 → 候选里「未上传」，转交 → 财务建单 F1、回写 finance_fee_id
 *   ② 转交后再查候选 → 该行消失（已上传到位）
 *   ③ **重新登记**（改实缴金额 + 换截图）→ finance_transfer_time 被清空
 *      → 候选里重新出现，且 `retransfer = true`
 *   ④ 再次提交转交 → 成功，`retransferred = 1`
 *      → 财务**仍是同一条单**（不新建），凭证/备注已更新成新登记的内容
 *   ⑤ 再次查候选 → 又消失
 *
 * 【夹具安全】催费行用 `TSTU…` 前缀 id，财务单一律按「本脚本学生 + 费用项 7」精确查找，
 *   收尾按 id **软删**（禁止物理删除）。
 *
 * 用法（server-job 目录，需 8004 / 5173 已启动）：
 *   npx tsx scripts/_e2e-urge-retransfer-check.mts
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

const results: Array<{ name: string; ok: boolean }> = [];
function check(name: string, ok: boolean, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? '  ✅' : '  ❌'} ${name}${detail ? '  —— ' + detail : ''}`);
}
const uuid = (p = 'TSTU') => p + Math.random().toString(36).slice(2, 10).toUpperCase();

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

const DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const FEE_TYPE = 7; // 押金
const STAGE = 'jh';

function dayOffset(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function main() {
  console.log('\n===== 重新登记 → 重新出现在「批量上传到财务」→ 更新财务原单 =====\n');

  try {
    const h = await fetch(`${BASE}/health`);
    check('后端已就绪（8004/health）', h.ok, `HTTP ${h.status}`);
    if (!h.ok) return;
  } catch (e) {
    check('后端已就绪（8004/health）', false, (e as Error).message);
    return;
  }

  const token = await login('sunmin');
  check('登录初高账号（登记缴费 + 转交）', !!token);
  if (!token) return;

  /* ---- 1. 造一条本地催费行（没有任何财务关联） ---- */
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

  const tpl = (
    await common.raw('SELECT * FROM t_uni_fee WHERE edu_stage=? AND is_deleted=0 LIMIT 1', [STAGE])
  )[0] as any[];
  const urgeId = uuid('TSTU');
  const t0 = new Date().toISOString().slice(0, 19).replace('T', ' ');
  await common('t_uni_fee').insert({
    ...tpl[0],
    id: urgeId,
    edu_stage: STAGE,
    student_id: s.student_id,
    student_no: studentNo,
    student_name: s.student_name || tpl[0].student_name,
    class_id: s.class_id ?? tpl[0].class_id,
    class_name: s.class_name ?? tpl[0].class_name,
    fee_type: FEE_TYPE,
    fee_amount: 50000,
    dept_code: 1,
    expire_date: dayOffset(3),
    pay_status: 1,
    pay_date: null,
    pay_method: null,
    paid_amount: null,
    voucher_url: null,
    source_system: 'local',
    source_id: null,
    finance_fee_id: null,
    finance_transfer_time: null,
    is_deleted: 0,
    create_time: t0,
    update_time: t0,
  });
  track(common, 't_uni_fee', urgeId);

  const readUrge = async () =>
    (await common.raw('SELECT * FROM t_uni_fee WHERE id=?', [urgeId]))[0][0];
  const findInCandidates = async () => {
    const res = await get('/api/teaching/fee/transfer/candidates?dept=jh', token);
    return (res?.data?.list || []).find((x: any) => x.feeId === urgeId);
  };
  /** 财务侧「本学生 + 本科目」的单据（按创建顺序） */
  const financeRows = async () =>
    (await finance.raw(
      `SELECT id, amount, pay_status, voucher_url, remark FROM t_finance_fee
        WHERE is_deleted=0 AND student_no=? AND fee_type=? AND dept_code=1 ORDER BY create_time ASC`,
      [studentNo, FEE_TYPE],
    ))[0] as any[];

  /* ---- 2. 登记缴费 → 候选里是「未上传」 ---- */
  const pay1 = await post('/api/class-jh/fee/voucher', token, {
    feeId: urgeId,
    payMethod: 1,
    paidAmount: 50000,
    payDate: dayOffset(0),
    remark: '自检：首次登记',
    dataUrl: DATA_URL,
  });
  check('① 首次登记缴费成功', Number(pay1?.code) === 200, `code=${pay1?.code} ${pay1?.message || ''}`);

  const cand1 = await findInCandidates();
  check('① 候选列表出现该行，且标记为「未上传」', !!cand1 && !cand1.retransfer, cand1 ? `transferred=${cand1.transferred} retransfer=${cand1.retransfer}` : '候选里没找到');

  /* ---- 3. 第一次转交 → 财务建单 ---- */
  const tr1 = await post('/api/teaching/fee/transfer', token, {
    items: [{ dept: 'jh', feeId: urgeId }],
  });
  const urgeAfterTr1 = await readUrge();
  const fin1 = await financeRows();
  check('② 首次转交成功', Number(tr1?.code) === 200 && Number(tr1?.data?.success) === 1, `code=${tr1?.code} success=${tr1?.data?.success} ${tr1?.message || ''}`);
  check(
    '② 台账回写 finance_fee_id + 上传时间',
    !!urgeAfterTr1.finance_fee_id && !!urgeAfterTr1.finance_transfer_time,
    `id=${urgeAfterTr1.finance_fee_id} time=${urgeAfterTr1.finance_transfer_time}`,
  );
  check('② 财务侧建了 1 张单', fin1.length === 1, `实际 ${fin1.length} 张`);
  if (fin1[0]) track(finance, 't_finance_fee', String(fin1[0].id));

  const cand2 = await findInCandidates();
  check('② 转交后该行不再出现在候选（已上传到位）', !cand2, cand2 ? '仍在列表里' : '已消失');

  /* ---- 4. 重新登记（改金额 + 换截图）→ 回到候选，标「重新登记」 ---- */
  const pay2 = await post('/api/class-jh/fee/voucher', token, {
    feeId: urgeId,
    payMethod: 2,
    paidAmount: 60000,
    payDate: dayOffset(0),
    remark: '自检：重新登记',
    dataUrl: DATA_URL,
  });
  const urgeAfterPay2 = await readUrge();
  check('③ 重新登记成功', Number(pay2?.code) === 200, `code=${pay2?.code} ${pay2?.message || ''}`);
  check(
    '★ ③ 重新登记后「上传时间」被清空、财务单 id 仍保留',
    urgeAfterPay2.finance_transfer_time == null && !!urgeAfterPay2.finance_fee_id,
    `time=${urgeAfterPay2.finance_transfer_time} id=${urgeAfterPay2.finance_fee_id}`,
  );

  const cand3 = await findInCandidates();
  check('★★ ③ 重新登记后重新出现在「批量上传到财务」列表', !!cand3, cand3 ? '在列表里' : '列表里没有（用户反馈的正是这个）');
  check('★ ③ 该行标记为「重新登记」（retransfer=true）', !!cand3?.retransfer, `retransfer=${cand3?.retransfer}`);
  check(
    '★ ③ 候选里带的是最新登记内容（方式/实缴/凭证）',
    cand3 && Number(cand3.payMethod) === 2 && Number(cand3.paidAmount) === 60000 && !!cand3.voucherUrl,
    cand3 ? `method=${cand3.payMethod} paid=${cand3.paidAmount} voucher=${cand3.voucherUrl}` : '无',
  );

  /* ---- 5. 再次转交 → 更新财务原单，不新建 ---- */
  const tr2 = await post('/api/teaching/fee/transfer', token, {
    items: [{ dept: 'jh', feeId: urgeId }],
  });
  const fin2 = await financeRows();
  const urgeAfterTr2 = await readUrge();
  check(
    '★★ ④ 再次转交成功（成功 1 条、其中重新登记 1 条）',
    Number(tr2?.data?.success) === 1 && Number(tr2?.data?.retransferred) === 1,
    `success=${tr2?.data?.success} retransferred=${tr2?.data?.retransferred} ${tr2?.message || ''}`,
  );
  check('★★ ④ 财务侧**没有新建第二张单**', fin2.length === 1, `实际 ${fin2.length} 张`);
  check(
    '★ ④ 财务那张单已更新成最新登记（备注带 600.00 元 + 最新备注）',
    !!fin2[0] && /600\.00/.test(String(fin2[0].remark || '')) && /自检：重新登记/.test(String(fin2[0].remark || '')),
    `remark=${String(fin2[0]?.remark || '').replace(/\n/g, ' ⏎ ').slice(0, 120)}`,
  );
  check(
    '④ 转交后「上传时间」重新写上',
    !!urgeAfterTr2.finance_transfer_time,
    `time=${urgeAfterTr2.finance_transfer_time}`,
  );

  const cand4 = await findInCandidates();
  check('④ 再次转交后该行又从候选里消失', !cand4, cand4 ? '仍在列表里' : '已消失');

  const same = (await common.raw(
    `SELECT COUNT(*) c FROM t_uni_fee WHERE edu_stage=? AND student_no=? AND fee_type=? AND is_deleted=0`,
    [STAGE, studentNo, FEE_TYPE],
  ))[0] as any[];
  check('④ 催费侧也没多插行（同科目仍 1 行）', Number(same[0].c) === 1, `实际 ${same[0].c} 行`);

  /* ---- 汇总 ---- */
  const pass = results.filter((r) => r.ok).length;
  console.log(`\n===== 结果：${pass}/${results.length} 通过 =====\n`);
  if (pass !== results.length) results.filter((r) => !r.ok).forEach((r) => console.log(`  ❌ ${r.name}`));

  await purge();
  console.log('（夹具已按 id 软删）');
  process.exitCode = pass === results.length ? 0 : 1;
}

main()
  .catch(async (e) => {
    console.error('自检异常：', e);
    await purge();
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.all([common.destroy().catch(() => {}), finance.destroy().catch(() => {})]);
  });
