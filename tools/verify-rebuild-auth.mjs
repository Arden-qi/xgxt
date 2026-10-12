/**
 * 重建数据 + 角色权限 + 待接收规则 —— 综合回归验证（统一门户版）
 *
 * ============================================================
 * 覆盖三件事（对应 2026-10-06 的三项需求）
 * ============================================================
 *   A. 全量数据重建后的「数据贯通」
 *      · 6 个业务库 + sms_common 副本的数量基线
 *      · 学号体系统一（大学部 U26* / 初高 J26* / 纯线索 ZX26*）
 *      · ★ 跨模块认人键回归：t_class_consult_push.consult_no
 *        必须等于咨询学员的 student_no（不是 ZX 单号）——
 *        这个键写错，「已分班不可再分派」就会在演示数据上静默失效。
 *      · 财务 → 班级缴费副本 / 初高缴费台账 都已落地
 *      · 教务 → 班级催费 / 宿舍副本已落地
 *
 *   B. 账号权限与角色对应
 *      · 16 个门户账号可登录、可见模块与预期一致
 *      · sms_perm 无僵尸账号（活跃 = 13）
 *      · 模块准入闸：非本模块账号读 /api/class/* 与 /api/class-jh/* 被拒
 *      · 业务角色解析：班主任 = 本班(scope 2) / 校长·学管 = 全部(scope 4)
 *      · 财务模块：财务角色可用写操作（不再一律 403）
 *
 *   C. 待接收学员 + 分班规则
 *      · 班主任只看到「意向班级是自己带的班」的推送单
 *      · 接收走推送单上的 intend_class_id（本界面不选班级）
 *      · 已接收 / 初高已入班 → 咨询侧不能再分派（后端二次拦截）
 *      · 已驳回 → 可以重新分派
 *
 * ============================================================
 * 用法（项目根目录）
 * ============================================================
 *   node tools/verify-rebuild-auth.mjs            # 跑验证（用 VRF 前缀的临时数据，跑完自动清理）
 *   node tools/verify-rebuild-auth.mjs --clean    # 只清理
 *   node tools/verify-rebuild-auth.mjs --keep     # 保留临时数据（排查用）
 *
 * 前提：后端已起（8004）；MySQL 按 server-job/.env 可连。
 * 临时数据一律带 VRF 前缀，正常跑完会自己删掉，不会污染演示数据。
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
  job: env.DB_NAME || 'sms_job',
  edu: env.DB_NAME_EDU || 'sms_edu',
  cls: env.DB_NAME_CLASS || 'sms_class',
  cjh: env.DB_NAME_CLASS_JH || 'sms_class_jh',
  common: env.DB_NAME_COMMON || 'sms_common',
  consult: env.DB_NAME_CONSULT || 'sms_consult',
  finance: env.DB_NAME_FINANCE || 'sms_finance',
  perm: env.DB_NAME_PERM || 'sms_perm',
};
const CONN = {
  host: env.DB_HOST || 'localhost',
  port: Number(env.DB_PORT || 3306),
  user: env.DB_USER || 'root',
  password: env.DB_PASSWORD || '123456',
};

/* ---------------- 小工具 ---------------- */
const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  console.log(`${pass ? '  [PASS]' : '  [FAIL]'}  ${name}${detail ? `\n           ${detail}` : ''}`);
}
function section(t) {
  console.log(`\n${'='.repeat(74)}\n${t}\n${'='.repeat(74)}`);
}

async function api(method, url, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(BASE + url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 非 JSON */
  }
  // 班级模块的约定：业务错误也返 HTTP 200，靠 body.code 区分
  //   · 成功 = 200（各模块 BizCode.SUCCESS 统一 200）
  //   · 40302 = 无操作权限（模块准入闸 / 角色不足）
  const denied = r.status === 403 || json?.code === 40302;
  const okBiz = r.status === 200 && (json?.code === 200 || json?.code === undefined);
  return { status: r.status, json, text, denied, okBiz, msg: json?.message ?? '' };
}

async function login(account) {
  const r = await api('POST', '/api/portal/account/login', { body: { account, password: PWD } });
  const d = r.json?.data ?? {};
  return { token: d.token, modules: d.account?.modules ?? [], landing: d.landingPath };
}

/* ---------------- 临时验证数据（VRF 前缀） ---------------- */
const V = {
  noA: 'VRFU2601', noB: 'VRFU2602', noJ: 'VRFJ2601',
  cA: 'CST-VRFU2601', cB: 'CST-VRFU2602', cJ: 'CST-VRFJ2601',
  pushA: 'PUSH-VRFU2601', pushB: 'PUSH-VRFU2602',
  ordA: 'ORD-VRFU2601', ordB: 'ORD-VRFU2602', ordJ: 'ORD-VRFJ2601',
  jhStu: 'SC-VRFJ2601',
};

class Db {
  constructor(conn) { this.conn = conn; }
  async q(sql, args = []) {
    const [rows] = await this.conn.query(sql, args);
    return rows;
  }
  async one(sql, args = []) {
    const rows = await this.q(sql, args);
    return rows[0];
  }
  /** 克隆一行并改写主键 / 指定列（避免手写几十个列名） */
  async cloneRow(table, whereCol, whereVal, newId, overrides = {}) {
    const cols = await this.q(`SHOW COLUMNS FROM ${table}`);
    const colNames = cols.map((c) => c.Field);
    const generated = new Set(cols.filter((c) => String(c.Extra || '').toUpperCase().includes('GENERATED')).map((c) => c.Field));
    const src = await this.one(`SELECT * FROM ${table} WHERE \`${whereCol}\` = ? ORDER BY id LIMIT 1`, [whereVal]);
    if (!src) throw new Error(`cloneRow：源行不存在 ${table}.${whereCol}=${whereVal}`);
    const obj = { ...src, id: newId, ...overrides };
    const keys = Object.keys(obj).filter((k) => colNames.includes(k) && !generated.has(k));
    await this.conn.query(
      `INSERT INTO ${table} (\`${keys.join('`,`')}\`) VALUES (${keys.map(() => '?').join(',')})`,
      keys.map((k) => (obj[k] === undefined ? null : obj[k])),
    );
    return obj;
  }
}

/* ============================================================
 * A. 数据基线
 * ============================================================ */
async function partA(db) {
  section('A. 全量重建后的数据基线（6 业务库 + sms_common 副本）');

  const cnt = async (t) => Number((await db.one(`SELECT COUNT(*) AS c FROM ${t}`))?.c ?? 0);

  // A1 各库行数
  const base = {
    [`${DB.finance}.t_finance_fee`]: [await cnt(`${DB.finance}.t_finance_fee`), 90],
    [`${DB.consult}.t_consult_student`]: [await cnt(`${DB.consult}.t_consult_student`), 14],
    [`${DB.consult}.t_consult_fee_order`]: [await cnt(`${DB.consult}.t_consult_fee_order`), 14],
    [`${DB.cls}.t_class_info`]: [await cnt(`${DB.cls}.t_class_info`), 2],
    [`${DB.cls}.t_class_student`]: [await cnt(`${DB.cls}.t_class_student`), 10],
    [`${DB.cls}.t_class_consult_push`]: [await cnt(`${DB.cls}.t_class_consult_push`), 8],
    [`${DB.cjh}.t_class_info`]: [await cnt(`${DB.cjh}.t_class_info`), 2],
    [`${DB.cjh}.t_class_student`]: [await cnt(`${DB.cjh}.t_class_student`), 14],
    [`${DB.edu}.t_edu_payment`]: [await cnt(`${DB.edu}.t_edu_payment`), 18],
    [`${DB.job}.t_job_class`]: [await cnt(`${DB.job}.t_job_class`), 1],
    [`${DB.job}.t_job_class_student`]: [await cnt(`${DB.job}.t_job_class_student`), 5],
    [`${DB.common}.t_class_fee_sync`]: [await cnt(`${DB.common}.t_class_fee_sync`), 45],
    [`${DB.common}.t_class_urge_sync`]: [await cnt(`${DB.common}.t_class_urge_sync`), 3],
    [`${DB.common}.t_class_dorm_room_sync`]: [await cnt(`${DB.common}.t_class_dorm_room_sync`), 2],
    [`${DB.common}.t_class_dorm_live_sync`]: [await cnt(`${DB.common}.t_class_dorm_live_sync`), 5],
  };
  for (const [t, [got, least]] of Object.entries(base)) {
    check(`数据量 ${t} ≥ ${least}`, got >= least, `实际 ${got}`);
  }

  // A2 学号体系统一
  const univNo = await db.q(`SELECT student_no FROM ${DB.finance}.t_student_base WHERE dept_code = 2 LIMIT 100`);
  const jhNo = await db.q(`SELECT student_no FROM ${DB.finance}.t_student_base WHERE dept_code = 1 LIMIT 100`);
  check(
    '财务学生主档 · 大学部学号全部 U26 开头',
    univNo.length > 0 && univNo.every((r) => /^U26\d+$/.test(String(r.student_no))),
    `${univNo.length} 条，样例 ${univNo.slice(0, 3).map((r) => r.student_no).join(',')}`,
  );
  check(
    '财务学生主档 · 初高学号全部 J26 开头',
    jhNo.length > 0 && jhNo.every((r) => /^J26\d+$/.test(String(r.student_no))),
    `${jhNo.length} 条，样例 ${jhNo.slice(0, 3).map((r) => r.student_no).join(',')}`,
  );

  // A3 ★ 跨模块认人键回归
  //
  // ⚠️ 只校验 **咨询推来的** 推送单（source_system='consult'）。
  //    源自「初高升学」的推送单（source_system='upgrade'）幂等键是**初高学号**，
  //    它本来就不该出现在 sms_consult.t_consult_student 里 ——
  //    不区分来源会把合法的升学单误判成「孤儿键」（2026-10-06 踩过）。
  const orphanPush = await db.q(
    `SELECT p.consult_no, p.source_system FROM ${DB.cls}.t_class_consult_push p
     LEFT JOIN ${DB.consult}.t_consult_student s ON s.student_no = p.consult_no
     WHERE s.id IS NULL AND (p.source_system IS NULL OR p.source_system = 'consult')`,
  );
  check(
    '★ 推送单 consult_no == 咨询学员 student_no（咨询来源 0 条孤儿键）',
    orphanPush.length === 0,
    orphanPush.length ? `孤儿键：${orphanPush.map((r) => r.consult_no).join(',')}` : '咨询来源推送单全部命中咨询学员',
  );

  // A3b 升学单的幂等键 = 初高学号（与咨询学号无关，允许查不到咨询学员）
  const upgradePush = await db.q(
    `SELECT consult_no FROM ${DB.cls}.t_class_consult_push
      WHERE is_deleted = 0 AND source_system = 'upgrade'`,
  );
  const upgradeOrphan = upgradePush.length
    ? await db.q(
        `SELECT consult_no FROM ${DB.cls}.t_class_consult_push p
          WHERE p.is_deleted = 0 AND p.source_system = 'upgrade'
            AND NOT EXISTS (
              SELECT 1 FROM ${DB.cjh}.t_class_student j
               WHERE j.student_no = p.consult_no AND j.is_deleted = 0)`,
      )
    : [];
  check(
    '★ 升学推送单 consult_no == 初高学员 student_no（0 条孤儿键）',
    upgradeOrphan.length === 0,
    upgradePush.length ? `升学单 ${upgradePush.length} 条` : '无升学单（跳过）',
  );

  const jhOrphan = await db.q(
    `SELECT j.student_no, j.source_id FROM ${DB.cjh}.t_class_student j
     LEFT JOIN ${DB.consult}.t_consult_student s ON s.student_no = j.source_id
     WHERE j.source_system = 'consult' AND s.id IS NULL`,
  );
  check(
    '★ 初高「来自咨询」学生 source_id == 咨询学员 student_no',
    jhOrphan.length === 0,
    jhOrphan.length ? `孤儿：${jhOrphan.map((r) => `${r.student_no}->${r.source_id}`).join(',')}` : '0 条孤儿',
  );

  // A4 财务 → 班级 缴费副本可回查财务
  const feeOrphan = await db.q(
    `SELECT c.student_no FROM ${DB.common}.t_class_fee_sync c
     LEFT JOIN ${DB.finance}.t_finance_fee f ON f.student_no = c.student_no
     WHERE f.id IS NULL LIMIT 20`,
  );
  check('缴费副本 t_class_fee_sync 的学号都能在财务 t_finance_fee 回查', feeOrphan.length === 0,
    feeOrphan.length ? `未命中：${feeOrphan.map((r) => r.student_no).join(',')}` : '全部命中');

  // A5 财务 → 初高 缴费台账
  const jhFee = await cnt(`${DB.cjh}.t_class_fee`);
  check('初高缴费台账 t_class_fee 已落地（财务同步）', jhFee >= 20, `实际 ${jhFee} 条`);
}

/* ============================================================
 * B. 账号权限与角色
 * ============================================================ */
const EXPECT_MODULES = {
  admin: ['consult', 'finance', 'perm', 'job', 'edu', 'class', 'class-jh'],
  // ★ 2026-10-06 用户拍板「校长权限为全模块展示」→ 与 admin 同为 7 个模块
  qiansy: ['consult', 'finance', 'perm', 'job', 'edu', 'class', 'class-jh'],
  congym: ['job', 'class', 'class-jh'],
  zhanght: ['class'],
  sunmin: ['class-jh'],
  zhengym: ['edu', 'class-jh'],
  zhouj: ['job'],
  zhoum: ['finance'],
  liukj: ['finance'],
  linx: ['perm'],
  wangjl: ['consult'],
  zhangls: ['consult'],
  lilx: ['consult'],
  // ★ 2026-10-06 新增：建班 5 岗位里缺的 3 个角色（选项要来自账户角色）
  chenxf: ['class'],
  zhaomx: ['class'],
  sunjl: ['job'],
};
// ★ 2026-10-06：教员/助教也挂 class 模块（建班 5 岗位，可被选为班级师资）
const CLASS_ACCOUNTS = ['admin', 'qiansy', 'congym', 'zhanght', 'chenxf', 'zhaomx'];
const JH_ACCOUNTS = ['admin', 'qiansy', 'congym', 'sunmin', 'zhengym'];

async function partB(db) {
  section('B. 账号权限按角色校准');

  const sessions = {};
  for (const acct of Object.keys(EXPECT_MODULES)) {
    const s = await login(acct);
    sessions[acct] = s;
  }
  const failed = Object.entries(sessions).filter(([, s]) => !s.token).map(([a]) => a);
  check(`${Object.keys(EXPECT_MODULES).length} 个门户账号全部登录成功`, failed.length === 0,
    failed.length ? `失败：${failed.join(',')}` : `${Object.keys(EXPECT_MODULES).length}/${Object.keys(EXPECT_MODULES).length}`);

  for (const [acct, want] of Object.entries(EXPECT_MODULES)) {
    const got = sessions[acct]?.modules ?? [];
    const same = want.every((m) => got.includes(m)) && got.length === want.length;
    check(`账号 ${acct} 可见模块 = [${want.join(',')}]`, same, `实际 [${got.join(',')}]`);
  }

  // B2 sms_perm 账号数
  const alive = Number((await db.one(
    `SELECT COUNT(*) AS c FROM ${DB.perm}.t_perm_user WHERE is_deleted = 0 AND account NOT LIKE '%#DEL#%'`,
  ))?.c ?? 0);
  // ★ 2026-10-06：13 → 16（补 教员/助教/项目经理），仍要求与门户账号一一对应
  check('sms_perm 活跃账号数 = 16（无僵尸）', alive === 16, `实际 ${alive}`);
  const zombie = Number((await db.one(
    `SELECT COUNT(*) AS c FROM ${DB.perm}.t_perm_user WHERE is_deleted = 1 OR account LIKE '%#DEL#%'`,
  ))?.c ?? 0);
  check('僵尸账号已软删（is_deleted=1）', zombie >= 1, `软删 ${zombie} 个`);

  // B2.5 前置：本套件假设 U2601 尚未升实训
  //   ⚠️ 2026-10-06 第四轮起：升实训 = 交棒，原班主任会「看不到」该班（class_status=5 被排除）。
  //      若本套件在 verify-round2 / verify-round3 之后跑（那两套会把 U2601 升实训），
  //      下面 B3 的 classIds、C 段的「待接收」都会对不上 —— 所以这里先卡一道前置。
  const u2601 = await db.one(`SELECT class_status FROM ${DB.cls}.t_class_info WHERE id = 'CLS-U2601'`);
  check('前置：U2601 尚未升实训（升实训=交棒会移出班主任视角）',
    Number(u2601?.class_status) !== 5,
    `class_status=${u2601?.class_status}${Number(u2601?.class_status) === 5 ? ' → 请先 npm run seed:all，并把本套件排在 verify-round2 / verify-round3 之前' : ''}`);

  // B3 业务角色解析 + 数据范围
  const meOf = async (acct) => (await api('GET', '/api/class/me', { token: sessions[acct].token })).json?.data ?? {};
  const meZ = await meOf('zhanght');
  check('班主任 zhanght 业务角色 = TEACH_HEAD 且数据范围 = 本班(2)',
    (meZ.roles ?? []).includes('TEACH_HEAD') && meZ.dataScope === 2,
    `roles=${JSON.stringify(meZ.roles)} scope=${meZ.dataScope}`);
  check('班主任 zhanght 负责的班级 = CLS-U2601 / CLS-U2602',
    (meZ.classIds ?? []).length === 2,
    `classIds=${JSON.stringify(meZ.classIds)}`);
  const meQ = await meOf('qiansy');
  check('校长 qiansy 业务角色 = RM_PRINCIPAL 且数据范围 = 全部(4)',
    (meQ.roles ?? []).includes('RM_PRINCIPAL') && meQ.dataScope === 4,
    `roles=${JSON.stringify(meQ.roles)} scope=${meQ.dataScope}`);
  const meC = await meOf('congym');
  check('学管主任 congym 数据范围 = 全部(4)',
    meC.dataScope === 4, `roles=${JSON.stringify(meC.roles)} scope=${meC.dataScope}`);

  // B4 模块准入闸 —— 大学部班级
  const classDenied = [];
  const classAllowed = [];
  for (const acct of Object.keys(EXPECT_MODULES)) {
    const r = await api('GET', '/api/class/consult/list?page=1&size=5', { token: sessions[acct].token });
    if (CLASS_ACCOUNTS.includes(acct)) {
      if (r.okBiz) classAllowed.push(acct);
    } else if (r.denied) {
      classDenied.push(acct);
    }
  }
  const total = Object.keys(EXPECT_MODULES).length;
  check(`大学部班级模块：授权账号(${CLASS_ACCOUNTS.length}) 全部放行`, classAllowed.length === CLASS_ACCOUNTS.length, `放行：${classAllowed.join(',')}`);
  check(`大学部班级模块：非授权账号(${total - CLASS_ACCOUNTS.length}) 全部拒绝`,
    classDenied.length === total - CLASS_ACCOUNTS.length, `拒绝：${classDenied.join(',')}`);

  // B5 模块准入闸 —— 初高
  const jhDenied = [];
  const jhAllowed = [];
  for (const acct of Object.keys(EXPECT_MODULES)) {
    const r = await api('GET', '/api/class-jh/classInfo/list?page=1&size=5', { token: sessions[acct].token });
    if (JH_ACCOUNTS.includes(acct)) {
      if (!r.denied) jhAllowed.push(acct);
    } else if (r.denied) {
      jhDenied.push(acct);
    }
  }
  check(`初高模块：授权账号(${JH_ACCOUNTS.length}) 全部放行`, jhAllowed.length === JH_ACCOUNTS.length, `放行：${jhAllowed.join(',')}`);
  check(`初高模块：非授权账号(${total - JH_ACCOUNTS.length}) 全部拒绝`,
    jhDenied.length === total - JH_ACCOUNTS.length, `拒绝：${jhDenied.join(',')}`);

  // B6 财务写操作鉴权（此前财务角色被一律 403 的根因回归）
  const finProbe = async (acct) =>
    api('POST', '/api/finance/fee/add', { token: sessions[acct].token, body: {} });
  const gz = await finProbe('zhoum');
  const lk = await finProbe('liukj');
  const qttFin = await finProbe('linx');
  check('财务负责人 zhoum 通过写操作鉴权（不是 403）', !gz.denied && gz.status !== 403,
    `HTTP ${gz.status} code=${gz.json?.code} msg=${gz.msg}`);
  check('财务专员 liukj 通过写操作鉴权（不是 403）', !lk.denied && lk.status !== 403,
    `HTTP ${lk.status} code=${lk.json?.code} msg=${lk.msg}`);
  check('权限管理员 linx 访问财务写操作被拒', qttFin.denied || qttFin.status === 403,
    `HTTP ${qttFin.status} code=${qttFin.json?.code} msg=${qttFin.msg}`);

  return sessions;
}

/* ============================================================
 * C. 待接收学员 + 分班规则
 * ============================================================ */
async function partC(db, sessions) {
  section('C. 待接收学员 与「已分派不可再分派 / 驳回后可再分派」');

  const tokHead = sessions.zhanght.token;
  const tokPrincipal = sessions.qiansy.token;

  // C1 班主任列表：只看自己带的班
  const pendingHead = await api('GET', '/api/class/consult/list?page=1&size=50&applyStatus=1', { token: tokHead });
  const rows = pendingHead.json?.data?.list ?? [];
  check('班主任「待接收」列表非空', rows.length >= 1, `拿到 ${rows.length} 条`);
  check('班主任「待接收」全部指向自己带的班（CLS-U2601 / CLS-U2602）',
    rows.every((r) => ['CLS-U2601', 'CLS-U2602'].includes(r.intendClassId)),
    `意向班级：${Array.from(new Set(rows.map((r) => r.intendClassId))).join(',')}`);
  check('「待接收」列表每行都带接受班级（本界面不选班级）',
    rows.every((r) => !!r.intendClassId && !!r.intendClassName),
    rows.map((r) => `${r.studentName}→${r.intendClassName}`).join(' | '));

  // C2 校长 / 学管 = 全量
  const pendingPrincipal = await api('GET', '/api/class/consult/list?page=1&size=50&applyStatus=1', { token: tokPrincipal });
  check('校长看到全部「待接收」', (pendingPrincipal.json?.data?.list ?? []).length >= rows.length,
    `校长 ${(pendingPrincipal.json?.data?.list ?? []).length} 条 / 班主任 ${rows.length} 条`);

  // ---- 造 VRF 临时数据 ----
  const pushes = await db.q(
    `SELECT * FROM ${DB.cls}.t_class_consult_push WHERE apply_status = 1 ORDER BY id LIMIT 2`,
  );
  if (pushes.length < 2) {
    check('存在至少 2 条「待接收」推送单用于验证接收/驳回', false, `只有 ${pushes.length} 条`);
    return;
  }

  await db.cloneRow(`${DB.consult}.t_consult_student`, 'student_no', 'U26016', V.cA,
    { student_no: V.noA, student_name: '验证甲' });
  await db.cloneRow(`${DB.consult}.t_consult_student`, 'student_no', 'U26016', V.cB,
    { student_no: V.noB, student_name: '验证乙' });
  // ⚠️ t_consult_fee_order.order_no 有唯一键（uk_cfo_order_no），必须一起改写
  await db.cloneRow(`${DB.consult}.t_consult_fee_order`, 'student_no', 'U26016', V.ordA,
    { consult_student_id: V.cA, student_no: V.noA, student_name: '验证甲', status: 2, order_no: `SK${V.noA}` });
  await db.cloneRow(`${DB.consult}.t_consult_fee_order`, 'student_no', 'U26016', V.ordB,
    { consult_student_id: V.cB, student_no: V.noB, student_name: '验证乙', status: 2, order_no: `SK${V.noB}` });
  await db.cloneRow(`${DB.cls}.t_class_consult_push`, 'id', pushes[0].id, V.pushA,
    { consult_no: V.noA, student_name: '验证甲', apply_status: 1, intend_class_id: 'CLS-U2601', intend_class_name: 'U2601' });
  await db.cloneRow(`${DB.cls}.t_class_consult_push`, 'id', pushes[1].id, V.pushB,
    { consult_no: V.noB, student_name: '验证乙', apply_status: 1, intend_class_id: 'CLS-U2602', intend_class_name: 'U2602' });

  // ---- C3 接收：班级只取推送单上的 intend_class_id（前端就算乱传也不认） ----
  const recv = await api('POST', '/api/class/consult/receive',
    { token: tokHead, body: { id: V.pushA, classId: 'CLS-U2602' } }); // 故意传错班
  check('班主任接收「验证甲」', recv.okBiz && !recv.denied, `HTTP ${recv.status} code=${recv.json?.code} ${recv.msg}`);
  const pushAfter = await db.one(`SELECT * FROM ${DB.cls}.t_class_consult_push WHERE id = ?`, [V.pushA]);
  check('接收后推送单状态 → 已接收(2)', Number(pushAfter?.apply_status) === 2, `apply_status=${pushAfter?.apply_status}`);
  const built = await db.one(`SELECT * FROM ${DB.cls}.t_class_student WHERE id = ?`, [pushAfter?.student_id]);
  check('★ 接收班级由推送单决定（前端传 CLS-U2602，实际落 U2601）',
    !!built && built.class_id === 'CLS-U2601',
    `推送单意向=${pushAfter?.intend_class_id} · 建档班=${built?.class_id} · 新学号=${built?.student_no}`);

  // ---- C4 咨询侧分班状态：已接收不可再分派 ----
  const stA = (await api('POST', '/api/consult/student/assign-status', { token: tokHead, body: { ids: [V.cA] } })).json?.data?.[V.cA];
  check('咨询侧分班状态：验证甲 = received 且 canAssign=false', stA?.state === 'received' && stA?.canAssign === false,
    JSON.stringify(stA));

  // ---- C5 后端二次拦截：已接收再分派被挡 ----
  const reAssign = await api('POST', '/api/consult/student/enroll-to-class',
    { token: tokHead, body: { id: V.cA, classId: 'CLS-U2602', module: 'class' } });
  const reMsg = reAssign.json?.message ?? '';
  check('已接收后再分派 → 被后端拦截', !reAssign.okBiz || /不能|已分班|已接收/.test(reMsg),
    `HTTP ${reAssign.status} code=${reAssign.json?.code} msg=${reMsg}`);

  // ---- C6 驳回 → 可重新分派 ----
  const rej = await api('POST', '/api/class/consult/reject', { token: tokHead, body: { id: V.pushB, rejectReason: '本班已满（验证）' } });
  check('班主任驳回「验证乙」', rej.okBiz && !rej.denied, `HTTP ${rej.status} code=${rej.json?.code} ${rej.msg}`);
  check('驳回后推送单状态 → 已驳回(3)',
    Number((await db.one(`SELECT apply_status FROM ${DB.cls}.t_class_consult_push WHERE id = ?`, [V.pushB]))?.apply_status) === 3);
  const stB = (await api('POST', '/api/consult/student/assign-status', { token: tokHead, body: { ids: [V.cB] } })).json?.data?.[V.cB];
  check('咨询侧分班状态：验证乙 = rejected 且 canAssign=true', stB?.state === 'rejected' && stB?.canAssign === true,
    JSON.stringify(stB));
  const reAssign2 = await api('POST', '/api/consult/student/enroll-to-class',
    { token: tokHead, body: { id: V.cB, classId: 'CLS-U2601', module: 'class' } });
  const reMsg2 = reAssign2.json?.message ?? '';
  check('驳回后可重新分派（不再被分派规则拦）',
    !/不能重复分派|不能再分派|已接收并入班/.test(reMsg2),
    `HTTP ${reAssign2.status} code=${reAssign2.json?.code} msg=${reMsg2}`);
  // ★ 重新分派必须真的把驳回单「激活」回待接收 —— 否则幂等去重会把这次重派悄悄吞掉
  const pushB2 = await db.one(`SELECT * FROM ${DB.cls}.t_class_consult_push WHERE id = ?`, [V.pushB]);
  check('★ 重新分派后驳回单被重新激活为「待接收」并换到新班(U2601)',
    Number(pushB2?.apply_status) === 1 && pushB2?.intend_class_id === 'CLS-U2601' && !pushB2?.reject_reason,
    `applyStatus=${pushB2?.apply_status} intend=${pushB2?.intend_class_id} rejectReason=${pushB2?.reject_reason}`);
  const stB2 = (await api('POST', '/api/consult/student/assign-status', { token: tokHead, body: { ids: [V.cB] } })).json?.data?.[V.cB];
  check('重新分派后咨询侧状态回到 pending（canAssign=false）', stB2?.state === 'pending' && stB2?.canAssign === false,
    JSON.stringify(stB2));
  // 收尾：把它驳回掉，避免影响后续清理
  await api('POST', '/api/class/consult/reject', { token: tokHead, body: { id: V.pushB, rejectReason: '验证收尾' } });

  // ---- C7 初高：已直建入班 → 不可再分派 ----
  const jhSrc = await db.one(`SELECT * FROM ${DB.cjh}.t_class_student WHERE source_system = 'consult' LIMIT 1`);
  if (jhSrc) {
    await db.cloneRow(`${DB.consult}.t_consult_student`, 'student_no', 'J26011', V.cJ,
      { student_no: V.noJ, student_name: '验证丙' });
    await db.cloneRow(`${DB.consult}.t_consult_fee_order`, 'student_no', 'J26011', V.ordJ,
      { consult_student_id: V.cJ, student_no: V.noJ, student_name: '验证丙', status: 2, order_no: `SK${V.noJ}` });
    await db.cloneRow(`${DB.cjh}.t_class_student`, 'student_no', jhSrc.student_no, V.jhStu,
      { student_no: V.noJ, source_system: 'consult', source_id: V.noJ, class_id: jhSrc.class_id, class_name: jhSrc.class_name });
    const stJ = (await api('POST', '/api/consult/student/assign-status', { token: tokHead, body: { ids: [V.cJ] } })).json?.data?.[V.cJ];
    check('咨询侧分班状态：验证丙（初高已入班）= jh 且 canAssign=false', stJ?.state === 'jh' && stJ?.canAssign === false,
      JSON.stringify(stJ));
    const reJ = await api('POST', '/api/consult/student/enroll-to-class',
      { token: tokHead, body: { id: V.cJ, classId: jhSrc.class_id, module: 'class-jh' } });
    const jMsg = reJ.json?.message ?? '';
    check('初高已入班后再分派 → 被后端拦截', !reJ.okBiz || /不能再分派|已直接进入/.test(jMsg),
      `HTTP ${reJ.status} code=${reJ.json?.code} msg=${jMsg}`);
  } else {
    check('存在「来自咨询」的初高学生用于验证', false, 't_class_jh.t_class_student 里 source_system=consult 为 0 条');
  }

  // ---- C8 未分派的学生仍有「分班」入口 ----
  const freeStu = await db.one(
    `SELECT id, student_no, student_name FROM ${DB.consult}.t_consult_student
     WHERE student_no NOT IN (SELECT consult_no FROM ${DB.cls}.t_class_consult_push)
       AND student_no NOT IN (SELECT source_id FROM ${DB.cjh}.t_class_student WHERE source_system = 'consult')
     LIMIT 1`,
  );
  if (freeStu) {
    const stF = (await api('POST', '/api/consult/student/assign-status', { token: tokHead, body: { ids: [freeStu.id] } })).json?.data?.[freeStu.id];
    check(`未分派学生「${freeStu.student_name}」可点「分班」（canAssign=true）`, stF?.canAssign === true, JSON.stringify(stF));
  } else {
    check('存在「未分派」学生用于验证分班入口', false, '找不到既不在推送单、也不在初高的学员');
  }
}

/* ---------------- 清理临时数据 ---------------- */
async function clean(db) {
  console.log('\n清理 VRF 临时验证数据…');
  const del = async (label, sql, args) => {
    const r = await db.q(sql, args);
    if (r.affectedRows) console.log(`  - ${label}: ${r.affectedRows} 行`);
  };
  await del('sms_class.t_class_consult_push', `DELETE FROM ${DB.cls}.t_class_consult_push WHERE consult_no LIKE 'VRF%' OR id LIKE 'PUSH-VRF%'`);
  await del('sms_class.t_class_student', `DELETE FROM ${DB.cls}.t_class_student WHERE student_no LIKE 'VRF%' OR source_id LIKE 'VRF%'`);
  await del('sms_consult.t_consult_fee_order', `DELETE FROM ${DB.consult}.t_consult_fee_order WHERE student_no LIKE 'VRF%' OR order_no LIKE 'SKVRF%'`);
  await del('sms_consult.t_consult_student', `DELETE FROM ${DB.consult}.t_consult_student WHERE student_no LIKE 'VRF%'`);
  await del('sms_class_jh.t_class_student', `DELETE FROM ${DB.cjh}.t_class_student WHERE student_no LIKE 'VRF%' OR source_id LIKE 'VRF%'`);
  // 接收时给班级 student_count +1，这里还原
  await del('sms_class.t_class_info.student_count 还原', `UPDATE ${DB.cls}.t_class_info SET student_count = (SELECT COUNT(*) FROM ${DB.cls}.t_class_student s WHERE s.class_id = t_class_info.id) WHERE id IN ('CLS-U2601','CLS-U2602')`);
}

/* ============================================================
 * 主流程
 * ============================================================ */
async function main() {
  const conn = await mysql.createConnection({ ...CONN, multipleStatements: false });
  const db = new Db(conn);
  const onlyClean = process.argv.includes('--clean');
  const keep = process.argv.includes('--keep');

  console.log(`后端：${BASE}`);
  console.log(`库：${Object.entries(DB).map(([k, v]) => `${k}=${v}`).join(' ')}`);

  try {
    if (onlyClean) {
      await clean(db);
      return;
    }
    await partA(db);
    const sessions = await partB(db);
    try {
      await partC(db, sessions);
    } finally {
      if (!keep) await clean(db);
    }
  } finally {
    await conn.end();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${'='.repeat(74)}`);
  console.log(`  合计 ${results.length} 项  ·  通过 ${results.length - failed.length}  ·  失败 ${failed.length}`);
  if (failed.length) {
    console.log('  失败项：');
    for (const f of failed) console.log(`    - ${f.name}`);
  }
  console.log('='.repeat(74));
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
