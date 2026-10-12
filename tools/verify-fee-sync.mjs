/**
 * 三处「缴费情况」→ 财务管理同步 验证（统一门户版）
 *
 * ============================================================
 * 背景（2026-10-06 用户需求）
 * ============================================================
 *   「将系统中的初高中数据、大学部、实训的信息详情中的缴费情况与缴费管理
 *     信息同步，记录该学生缴纳的费用，初高中的信息与缴费管理中的二三期同步记录。」
 *
 *   拍板口径：数据源 = 财务管理 · 缴费管理（sms_finance.t_finance_fee）；
 *             取数 = 实时为主 + 副本兜底；初高按学号全量取；大学部保持现状只统一口径。
 *
 *   改造前三个模块各看各的：
 *     · 初高（教学管理）  → sms_class_jh.t_class_fee（本地台账，从没同步过）
 *     · 大学部（班级管理）→ sms_common.t_class_fee_sync（财务推的只读副本）
 *     · 实训（就业管理）  → 后端调 /api/finance/payment/list（该路由不存在！）→ 永远「未接入」
 *
 * ============================================================
 * 用法（项目根目录，后端需在 8004 跑着）
 * ============================================================
 *   node tools/verify-fee-sync.mjs
 *   node tools/verify-fee-sync.mjs --clean    # 只清理本脚本造的验证数据
 *
 * 说明：实训库（sms_job）的演示数据是空的，脚本会自动补一个 VERIFY 前缀的学生
 *       （学号借财务里有记录的 S20260005），跑完可 --clean 清掉。
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SERVER_JOB = path.join(ROOT, 'server-job');

const mysql = createRequire(path.join(SERVER_JOB, 'package.json'))('mysql2/promise');

/* ---------------- 读 .env ---------------- */
function loadEnv() {
  const p = path.join(SERVER_JOB, '.env');
  const out = {};
  if (!fs.existsSync(p)) return out;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const i = s.indexOf('=');
    if (i < 0) continue;
    out[s.slice(0, i).trim()] = s.slice(i + 1).trim();
  }
  return out;
}
const env = loadEnv();

const BASE = `http://localhost:${env.PORT || 8004}`;
const PWD = '123456';
const DB = {
  host: env.DB_HOST || 'localhost',
  port: Number(env.DB_PORT || 3306),
  user: env.DB_USER || 'root',
  password: env.DB_PASSWORD || '123456',
};
const D = {
  class: env.DB_NAME_CLASS || 'sms_class',
  common: env.DB_NAME_COMMON || 'sms_common',
  job: env.DB_NAME || 'sms_job',
  edu: env.DB_NAME_EDU || 'sms_edu',
  finance: env.DB_NAME_FINANCE || 'sms_finance',
  jh: env.DB_NAME_CLASS_JH || 'sms_class_jh',
};

/* ---------------- 验证数据标记 ----------------
 * ⚠️ 2026-10-06 起演示数据重建为「大学部 U26xxx / 初高 J26xxx / 线索 ZX26xxx」，
 *    老脚本硬编码的 S2026xxxx 夹具全部失效。这里改成：
 *      · 能动态选的（有财务记录的初高学生）→ 查询选出来
 *      · 选不出来的（财务没有该学号的初高学生）→ 现场克隆一个 VRFM2601
 */
const V_JOB_STUDENT_ID = 'VERIFY-FEE-STU-1';
const V_JOB_STUDENT_NO = 'U26011'; // 实训/就业侧真实存在的学号（财务里有记录）
const V_MIRROR_FEE_ID = 'VERIFY-FEE-MIRROR-1'; // 初高台账兜底用
const V_MIRROR_STUDENT_ID = 'VRFM2601'; // 现场造的初高学生（财务里查不到）
const V_MIRROR_STUDENT_NO = 'VRFM2601'; // 财务里没有、只有初高台账的学号

/* ---------------- 小工具 ---------------- */
const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? '  ✅ PASS' : '  ❌ FAIL'}  ${name}${detail ? `\n           ${detail}` : ''}`);
}
function section(t) {
  console.log(`\n${'='.repeat(72)}\n${t}\n${'='.repeat(72)}`);
}

async function api(method, url, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(BASE + url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 非 JSON */
  }
  return { status: r.status, json, text };
}

async function login(account) {
  const r = await api('POST', '/api/portal/account/login', { body: { account, password: PWD } });
  const token = r.json?.data?.token;
  if (!token) {
    console.log(`  ⚠️ 登录失败 ${account}：HTTP ${r.status} code=${r.json?.code} msg=${r.json?.message}`);
  }
  return { token, userName: r.json?.data?.account?.userName };
}

/** 统一状态 / 类型/ 部门文案（必须与 server-job/src/utils/financeFeeRef.ts 一致） */
const STATUS_TEXT = {
  1: '待缴',
  2: '已缴（待核对）',
  3: '已缴（已核对）',
  4: '逾期',
  5: '冻结',
};
const TYPE_TEXT = { 1: '学费', 2: '住宿费', 3: '餐费', 4: '保险费', 5: '试学费' };
const DEPT_TEXT = { 1: '二三期', 2: '大学部' };

/* ---------------- 主流程 ---------------- */
async function main() {
  const conn = await mysql.createConnection({ ...DB, database: D.finance });
  const q = async (sql, args) => {
    const [rows] = await conn.query(sql, args);
    return rows;
  };
  /** 克隆一行（列多且含生成列，手写不可靠） */
  const cloneRow = async (table, whereCol, whereVal, newId, overrides = {}) => {
    const [cols] = await conn.query(`SHOW COLUMNS FROM ${table}`);
    const names = cols.map((c) => c.Field);
    const gen = new Set(
      cols.filter((c) => String(c.Extra || '').toUpperCase().includes('GENERATED')).map((c) => c.Field),
    );
    const [srcRows] = await conn.query(`SELECT * FROM ${table} WHERE \`${whereCol}\` = ? ORDER BY id LIMIT 1`, [whereVal]);
    if (!srcRows[0]) throw new Error(`缺少基准行：${table}.${whereCol}=${whereVal}`);
    const obj = { ...srcRows[0], id: newId, ...overrides };
    const keys = Object.keys(obj).filter((k) => names.includes(k) && !gen.has(k));
    await conn.query(
      `INSERT INTO ${table} (\`${keys.join('`,`')}\`) VALUES (${keys.map(() => '?').join(',')})`,
      keys.map((k) => (obj[k] === undefined ? null : obj[k])),
    );
  };

  /* ---------------- 清理（--clean 单独用；正常跑完也会自动收尾） ---------------- */
  const runCleanup = async () => {
    const r1 = await q(`DELETE FROM ${D.job}.t_student_base WHERE id = ?`, [V_JOB_STUDENT_ID]);
    const r2 = await q(`DELETE FROM ${D.jh}.t_class_fee WHERE id = ?`, [V_MIRROR_FEE_ID]);
    const r2b = await q(`DELETE FROM ${D.jh}.t_class_fee WHERE student_no = ?`, [V_MIRROR_STUDENT_NO]);
    const r2c = await q(`DELETE FROM ${D.jh}.t_class_student WHERE id = ? OR student_no = ?`, [
      V_MIRROR_STUDENT_ID,
      V_MIRROR_STUDENT_NO,
    ]);
    // 先删副本（副本按财务单 id 挂），再删账单，最后删财务单
    const r4 = await q(`DELETE FROM ${D.jh}.t_class_fee WHERE source_system = 'finance' AND source_id IN (
        SELECT id FROM ${D.finance}.t_finance_fee WHERE remark = 'VERIFY-FEE-SYNC')`);
    await q(`DELETE FROM ${D.common}.t_class_fee_sync WHERE source_id IN (
        SELECT id FROM ${D.finance}.t_finance_fee WHERE remark = 'VERIFY-FEE-SYNC')`);
    const r5 = await q(`DELETE FROM ${D.finance}.t_finance_bill WHERE source_id IN (
        SELECT id FROM ${D.finance}.t_finance_fee WHERE remark = 'VERIFY-FEE-SYNC')`);
    const r3 = await q(`DELETE FROM ${D.finance}.t_finance_fee WHERE remark = ?`, ['VERIFY-FEE-SYNC']);
    return (
      `实训学生 ${r1.affectedRows} · 初高台账兜底行 ${r2.affectedRows} · ` +
      `初高兜底生台账 ${r2b.affectedRows} · 初高兜底生 ${r2c.affectedRows} · ` +
      `初高同步副本 ${r4.affectedRows} · 财务账单 ${r5.affectedRows} · 财务验证单 ${r3.affectedRows}`
    );
  };

  if (process.argv.includes('--clean')) {
    console.log('🧹 清理验证数据…');
    console.log(`  ${await runCleanup()}`);
    await conn.end();
    return;
  }

  console.log(`后端：${BASE}`);
  console.log(
    `库：class=${D.class} common=${D.common} job=${D.job} finance=${D.finance} class-jh=${D.jh}`,
  );

  /* ============ 前置：登录 ============ */
  section('前置：门户登录');
  const jhTeacher = await login('sunmin'); // 初高班主任（class-jh）
  const jobTeacher = await login('zhouj'); // 就业老师（job）
  const admin = await login('admin'); // 系统管理员（全权只读，用来查大学部）
  const fin = await login('zhoum'); // 财务负责人（用来造财务单，验同步链路）
  check('sunmin（初高班主任）登录成功', !!jhTeacher.token);
  check('zhouj（就业老师）登录成功', !!jobTeacher.token);
  check('admin（系统管理员）登录成功', !!admin.token);
  check('zhoum（财务负责人）登录成功', !!fin.token);

  /* ============ 1) 初高 · 学生详情 · 缴费情况 ============ */
  section('1) 初高（教学管理）学生详情 · 缴费情况 ← 财务管理（二三期）');

  // 动态选一个「初高里有档案、财务里也有缴费记录」的学生做对比基准
  const jhBase = await q(
    `SELECT s.id, s.student_no, s.student_name, s.class_name
       FROM ${D.jh}.t_class_student s
       JOIN ${D.finance}.t_finance_fee f ON f.student_no = s.student_no AND f.is_deleted = 0
      WHERE s.is_deleted = 0
      ORDER BY s.student_no LIMIT 1`,
  );
  check(
    '前置：找到「初高有档案 + 财务有缴费记录」的学员（对比基准）',
    jhBase.length > 0,
    jhBase.length ? `${jhBase[0].student_no} / ${jhBase[0].student_name}` : '未找到',
  );

  const financeRows = await q(
    `SELECT * FROM ${D.finance}.t_finance_fee WHERE student_no = ? AND is_deleted = 0 ORDER BY pay_date DESC, create_time DESC`,
    [jhBase[0]?.student_no ?? '__none__'],
  );
  check(
    `前置：财务库中 ${jhBase[0]?.student_no ?? '—'} 有缴费记录（用来做对比基准）`,
    financeRows.length > 0,
    `财务记录 ${financeRows.length} 条`,
  );

  const jhDetail = await api('GET', `/api/class-jh/student/detail?id=${encodeURIComponent(jhBase[0]?.id ?? '')}`, {
    token: jhTeacher.token,
  });
  const jd = jhDetail.json?.data ?? {};
  check('初高学生详情接口可用（code=200）', jhDetail.json?.code === 200, `code=${jhDetail.json?.code}`);
  check(
    '详情返回的缴费情况来自财务管理（feeMeta.source=finance）',
    jd.feeMeta?.source === 'finance',
    `feeMeta=${JSON.stringify(jd.feeMeta?.summary ?? null)} source=${jd.feeMeta?.source}`,
  );
  check('未降级（feeMeta.degraded=false，说明是实时数据）', jd.feeMeta?.degraded === false);
  check(
    '缴费记录条数与财务库一致',
    (jd.fee ?? []).length === financeRows.length,
    `详情 ${(jd.fee ?? []).length} 条 vs 财务 ${financeRows.length} 条`,
  );

  const fee0 = (jd.fee ?? [])[0] ?? {};
  check(
    '记录带「部门」且初高落在二三期',
    fee0.deptName === DEPT_TEXT[1],
    `deptCode=${fee0.deptCode} deptName=${fee0.deptName}`,
  );
  check(
    '记录带「费用周期」「类型」「状态」统一文案（三处同一套字）',
    typeof fee0.period !== 'undefined' &&
      fee0.feeTypeName === TYPE_TEXT[fee0.feeType] &&
      fee0.payStatusName === STATUS_TEXT[fee0.payStatus],
    `period=${fee0.period === null ? 'null' : fee0.period} type=${fee0.feeTypeName} status=${fee0.payStatusName}`,
  );
  check(
    '金额字段齐全（应缴 / 已缴 / 待缴，单位元）',
    /^\d+\.\d{2}$/.test(String(fee0.amountYuan)) &&
      /^\d+\.\d{2}$/.test(String(fee0.paidAmountYuan)) &&
      /^\d+\.\d{2}$/.test(String(fee0.unpaidAmountYuan)),
    `应缴=${fee0.amountYuan} 已缴=${fee0.paidAmountYuan} 待缴=${fee0.unpaidAmountYuan}`,
  );

  const finSum = financeRows.reduce((s, r) => s + Number(r.amount ?? 0), 0);
  check(
    '顶部汇总「应缴合计」与财务逐条相加一致',
    Number(jd.feeMeta?.summary?.totalAmount ?? -1) === finSum,
    `详情 ${jd.feeMeta?.summary?.totalAmount} 分 vs 财务 ${finSum} 分`,
  );

  // 抽查一条：金额与状态必须与财务原单一致
  const sample = financeRows.find((r) => String(r.id) === String(fee0.feeId));
  check(
    '抽查首条：金额 / 状态与财务原单一一对应',
    !!sample && Number(sample.amount) === fee0.amount && Number(sample.pay_status) === fee0.payStatus,
    sample
      ? `财务 id=${sample.id} amount=${sample.amount} status=${sample.pay_status}｜详情 amount=${fee0.amount} status=${fee0.payStatus}`
      : '未在财务侧找到对应单号',
  );

  /* ============ 2) 初高 · 副本兜底（财务没有该学号） ============ */
  section('2) 初高 · 兜底：财务查不到时回落本模块缴费台账');

  // 现场造一个「初高有档案、财务查不到」的学生（演示数据里每个初高学生都有财务记录）
  await q(`DELETE FROM ${D.jh}.t_class_student WHERE id = ?`, [V_MIRROR_STUDENT_ID]);
  await cloneRow(`${D.jh}.t_class_student`, 'student_no', 'J26001', V_MIRROR_STUDENT_ID, {
    student_no: V_MIRROR_STUDENT_NO,
    student_name: '验证兜底生',
    source_system: null,
    source_id: null,
  });

  const jhStu = await q(
    `SELECT id, student_no, student_name, class_id, class_name FROM ${D.jh}.t_class_student WHERE student_no = ? AND is_deleted = 0 LIMIT 1`,
    [V_MIRROR_STUDENT_NO],
  );
  const finNo = await q(
    `SELECT COUNT(*) AS c FROM ${D.finance}.t_finance_fee WHERE student_no = ? AND is_deleted = 0`,
    [V_MIRROR_STUDENT_NO],
  );

  if (jhStu.length && Number(finNo[0].c) === 0) {
    // 造一条本地台账（模拟「财务还没录，教学管理自己记过一笔」）
    // 先删旧行，保证脚本可重复执行
    await q(`DELETE FROM ${D.jh}.t_class_fee WHERE id = ?`, [V_MIRROR_FEE_ID]);
    await q(
      `INSERT INTO ${D.jh}.t_class_fee
        (id, create_time, create_by, is_deleted, student_id, student_no, student_name, class_id, class_name,
         dept_code, fee_type, fee_amount, pay_status, pay_date, expire_date, source_system, source_id)
       VALUES (?, NOW(), 'verify', 0, ?, ?, ?, ?, ?, 1, 2, 88000, 2, '2026-09-20', '2026-12-01', 'local', NULL)`,
      [V_MIRROR_FEE_ID, jhStu[0].id, jhStu[0].student_no, jhStu[0].student_name, jhStu[0].class_id, jhStu[0].class_name],
    );

    const mirrorDetail = await api('GET', `/api/class-jh/student/detail?id=${jhStu[0].id}`, {
      token: jhTeacher.token,
    });
    const md = mirrorDetail.json?.data ?? {};
    check(
      '财务无该学号 → 详情回落台账（feeMeta.source=mirror）',
      md.feeMeta?.source === 'mirror' && md.feeMeta?.mirrorFrom === 'class-jh',
      `source=${md.feeMeta?.source} mirrorFrom=${md.feeMeta?.mirrorFrom}`,
    );
    check(
      '兜底时标记 degraded=true 并给出提示文案（前端会显示黄条）',
      md.feeMeta?.degraded === true && !!md.feeMeta?.message,
      md.feeMeta?.message,
    );
    check(
      '兜底记录能被读到（台账里那 1 条住宿费）',
      (md.fee ?? []).length >= 1 && (md.fee ?? []).some((r) => r.feeId === V_MIRROR_FEE_ID),
      `共 ${(md.fee ?? []).length} 条`,
    );
  } else {
    check(
      '兜底场景前置数据可用（初高有该学生、财务无该学号）',
      false,
      `初高学生 ${jhStu.length} 条 / 财务记录 ${finNo[0]?.c} 条 —— 演示数据变了，请调整脚本里的 V_MIRROR_STUDENT_NO`,
    );
  }

  /* ============ 3) 实训 · 学员档案 · 缴费记录 ============ */
  section('3) 实训（就业管理）学员档案 · 缴费记录 ← 财务管理');

  // 用实训侧**真实存在**的学员（种子数据里有 U26011）；找不到才现场补一条
  // （补的时候学号不能撞 uk_student_no，所以用 VERIFY 前缀而不是 U26011）
  let jobStu = await q(
    `SELECT id, student_no FROM ${D.job}.t_student_base WHERE student_no = ? AND is_deleted = 0 LIMIT 1`,
    [V_JOB_STUDENT_NO],
  );
  if (!jobStu.length) {
    await q(`DELETE FROM ${D.job}.t_student_base WHERE id = ? OR student_no = ?`, [V_JOB_STUDENT_ID, V_JOB_STUDENT_NO]);
    await q(
      `INSERT INTO ${D.job}.t_student_base
        (id, create_time, is_deleted, student_no, student_name, gender, dept_code, class_id, class_name,
         head_teacher_id, head_teacher_name, student_status, stage, phone)
       VALUES (?, NOW(), 0, ?, '验证学生-缴费同步', 1, 2, 'CLS-JOB-SX2601', 'SX2601', 'VERIFY-T', '验证班主任', 1, 301, '13800000000')`,
      [V_JOB_STUDENT_ID, V_JOB_STUDENT_NO],
    );
    jobStu = [{ id: V_JOB_STUDENT_ID, student_no: V_JOB_STUDENT_NO }];
  }
  const jobStuId = jobStu[0].id;

  const jobFin = await q(
    `SELECT COUNT(*) AS c FROM ${D.finance}.t_finance_fee WHERE student_no = ? AND is_deleted = 0`,
    [jobStu[0].student_no],
  );

  const feeRec = await api(
    'GET',
    `/api/job/class-info/fee-records?studentId=${encodeURIComponent(jobStuId)}`,
    { token: admin.token },
  );
  const fr = feeRec.json?.data ?? {};
  check(
    '实训缴费记录接口不再「未接入」（available=true 或至少不是路由错误）',
    feeRec.json?.code === 200,
    `HTTP ${feeRec.status} code=${feeRec.json?.code} msg=${feeRec.json?.message} available=${fr.available}`,
  );
  check(
    '取到的是财务实时数据（source=finance）',
    fr.source === 'finance',
    `source=${fr.source} degraded=${fr.degraded}`,
  );
  check(
    '记录条数与财务库该学号一致（旧实现永远 0 条）',
    (fr.records ?? []).length === Number(jobFin[0].c),
    `接口 ${(fr.records ?? []).length} 条 vs 财务 ${jobFin[0].c} 条`,
  );
  check(
    '返回结构含汇总 summary（应缴 / 已缴 / 待缴）',
    !!fr.summary && /^\d+\.\d{2}$/.test(String(fr.summary?.totalAmountYuan)),
    fr.summary ? `应缴=${fr.summary.totalAmountYuan} 已缴=${fr.summary.totalPaidYuan} 待缴=${fr.summary.totalUnpaidYuan}` : '',
  );

  /* ============ 4) 大学部 · 缴费列表口径统一 ============ */
  section('4) 大学部（班级管理）· 缴费情况口径统一');

  const clsList = await api('GET', '/api/class/fee/list?page=1&size=10', { token: admin.token });
  const cl = clsList.json?.data ?? {};
  const clRows = cl.list ?? [];
  check('大学部缴费列表接口可用', clsList.json?.code === 200, `code=${clsList.json?.code} total=${cl.total}`);
  check(
    '列表返回「部门」字段（deptName）',
    clRows.length === 0 || clRows.every((r) => typeof r.deptName === 'string'),
    clRows.length ? `首行 deptCode=${clRows[0].deptCode} deptName=${clRows[0].deptName}` : '（该账号可见行为 0，跳过字段断言）',
  );
  check(
    '列表返回「费用周期」字段（period）',
    clRows.length === 0 || clRows.every((r) => 'period' in r),
    clRows.length ? `首行 period=${clRows[0].period}` : '（无可见行，跳过）',
  );
  check(
    '缴费状态文案已统一到同一套（2=已缴（待核对） / 3=已缴（已核对））',
    clRows.every((r) => Object.values(STATUS_TEXT).includes(String(r.payStatusName))),
    clRows.length ? `首行 payStatus=${clRows[0].payStatus} → ${clRows[0].payStatusName}` : '（无可见行，跳过）',
  );

  /* ============ 5) 财务 → 初高 副本同步（写链路） ============ */
  section('5) 财务管理 新增 / 核对 缴费单 → 初高台账自动同步');

  // ⚠️ 用 admin 造单：门户给「财务负责人 zhoum」下发的 permissions 只有
  //    ['module:finance']，没有 finance:fee:add，调用会被 403（既有权限配置问题，
  //    见 --clean 说明与验证报告）。admin 带 '*' 可通行，不影响同步链路的验证目的。
  const addRes = await api('POST', '/api/finance/fee/add', {
    token: admin.token,
    body: {
      studentId: 'VERIFY-FIN-STU',
      studentNo: jhBase[0]?.student_no ?? 'VERIFY-NO',
      studentName: jhBase[0]?.student_name ?? '验证学生',
      className: jhBase[0]?.class_name ?? '—',
      deptCode: 1, // 二三期（初高部）
      feeType: 2, // 住宿费
      amount: 66000,
      // 核对要求「已缴费 + 有凭证」，所以直接建成待核对；凭证名随机（非餐费类型凭证唯一）
      payStatus: 2,
      voucherUrl: `/uploads/verify-fee-sync-${Date.now()}.png`,
      period: '2026-10',
      remark: 'VERIFY-FEE-SYNC',
    },
  });
  const addId = addRes.json?.data?.id;
  check(
    '财务新增缴费单（二三期 · 住宿费 660 元）成功',
    !!addId,
    `code=${addRes.json?.code} msg=${addRes.json?.message} id=${addId}`,
  );

  if (addId) {
    const syncRow = await q(
      `SELECT id, student_no, student_name, student_id, dept_code, fee_type, fee_amount, pay_status, period, source_system, source_id
         FROM ${D.jh}.t_class_fee WHERE source_system = 'finance' AND source_id = ?`,
      [addId],
    );
    check(
      '初高台账已生成同步副本（source_system=finance，按财务单 id 幂等）',
      syncRow.length === 1,
      syncRow.length ? JSON.stringify(syncRow[0]) : '未找到副本行',
    );
    check(
      '副本金额 / 类型 / 周期与财务单一致',
      syncRow.length === 1 &&
        Number(syncRow[0].fee_amount) === 66000 &&
        Number(syncRow[0].fee_type) === 2 &&
        syncRow[0].period === '2026-10',
      syncRow.length ? `金额=${syncRow[0].fee_amount} 类型=${syncRow[0].fee_type} 周期=${syncRow[0].period}` : '',
    );
    check(
      '副本学生 ID 按学号回查成了初高自己的学生（跨库认人只靠学号）',
      syncRow.length === 1 && !!syncRow[0].student_id && !String(syncRow[0].student_id).startsWith('S2026'),
      syncRow.length ? `student_id=${syncRow[0].student_id}` : '',
    );

    // 核对 → 状态应变成「已缴（已核对）」并回推到副本
    const verifyRes = await api('POST', '/api/finance/fee/verify', { token: admin.token, body: { id: addId } });
    await new Promise((r) => setTimeout(r, 300));
    const after = await q(`SELECT pay_status FROM ${D.jh}.t_class_fee WHERE source_id = ?`, [addId]);
    check(
      '财务「核对」后副本状态同步更新（2 待核对 → 3 已缴/已核对）',
      verifyRes.json?.code === 200 && after.length === 1 && Number(after[0].pay_status) === 3,
      `verify code=${verifyRes.json?.code} msg=${verifyRes.json?.message} → 副本 pay_status=${after[0]?.pay_status}`,
    );

    // 幂等：同一条单不会因为再推一次变成两行
    const dupRes = await api('POST', '/api/finance/fee/reject', {
      token: admin.token,
      body: { id: addId, rejectReason: 'VERIFY 幂等测试' },
    });
    const dupRows = await q(`SELECT COUNT(*) AS c FROM ${D.jh}.t_class_fee WHERE source_id = ?`, [addId]);
    check(
      '重复推送保持幂等（同一张单在初高台账里始终只有 1 行）',
      Number(dupRows[0].c) === 1,
      `reject code=${dupRes.json?.code} → 副本行数=${dupRows[0].c}`,
    );
  }

  /* ============ 汇总 ============ */
  if (!process.argv.includes('--keep')) {
    console.log(`\n🧹 已清理本次验证数据：${await runCleanup()}`);
  }
  section('汇总');
  const passed = results.filter((r) => r.pass).length;
  console.log(`共 ${results.length} 项：通过 ${passed}，失败 ${results.length - passed}`);
  if (passed !== results.length) {
    console.log('\n失败项：');
    for (const r of results.filter((x) => !x.pass)) console.log(`  ❌ ${r.name}\n      ${r.detail ?? ''}`);
  }
  console.log('\n提示：验证数据可用 node tools/verify-fee-sync.mjs --clean 清理。');

  await conn.end();
  process.exitCode = passed === results.length ? 0 : 1;
}

main().catch((e) => {
  console.error('脚本异常：', e);
  process.exit(1);
});
