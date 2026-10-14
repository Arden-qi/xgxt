/**
 * 2026-10-06 第三轮 3 项修复 验证（真登录 + 真调接口 + 查库断言）
 *
 *   ① 【交棒】升实训后，原班主任/教员退出：
 *      「班级管理」列表与「班级信息管理」花名册都不再展示该实训班，
 *      写操作（改学生等）被收回（403）；监督角色（校长/学管）不受影响、仍可见。
 *      （口径 2026-10-06 第四轮由用户明确：升实训 = 交棒，管理者变为
 *        就业指导老师（班主任角色）+ 项目经理（教员角色））
 *   ② 咨询「学生管理 → 入班」= 选学段（大学部 / 初高中）+ 选该学段开放班级 →
 *      确认后学生进班（大学部走「待接收学员」/ 初高**直接入班**）
 *   ③ 「审批中心 → 分配咨询老师」下拉不再「无数据」：
 *      候选来自「门户账号 × sms_perm 角色」，且经理真的能分配（不再被降级成咨询师 → 403）
 *
 * 用法：node tools/verify-round3.mjs [--clean]
 *   默认跑完自动清理临时数据（VR3 前缀）；--clean 只清理不验证。
 * 前提：后端 8004 已起（MySQL 3306）。
 *   ⚠️ ①段需要「班主任名下 + 已升实训」的班；本套件会**幂等**地把 U2601 升实训
 *      （没升才升），所以不再依赖 verify-round2 先跑。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_JOB = path.join(HERE, '..', 'server-job');

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
  password: env.DB_PASSWORD || '',
  multipleStatements: false,
};
const D = {
  class: env.DB_NAME_CLASS || 'sms_class',
  consult: env.DB_NAME_CONSULT || 'sms_consult',
  classJh: env.DB_NAME_CLASS_JH || 'sms_class_jh',
};

const require = createRequire(path.join(SERVER_JOB, 'package.json'));
const mysql = require('mysql2/promise');

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
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
  return { status: r.status, json };
}

async function login(account) {
  const r = await api('POST', '/api/portal/account/login', { body: { account, password: PWD } });
  if (r.json?.code !== 200) throw new Error(`登录失败：${account} → ${JSON.stringify(r.json).slice(0, 120)}`);
  return r.json.data.token;
}
function userIdOf(token) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).userId;
  } catch {
    return '';
  }
}

/**
 * 幂等保证「班主任名下 + 已升实训」的回归场景成立。
 *
 * ⚠️ 原来本套件第①段依赖 verify-round2 先跑（它第⑤段才会真的升实训 U2601）。
 *    现在本套件自己升（没升才升）—— 单独跑也成立，顺序依赖消除。
 */
async function ensureU2601Upgraded(qiansyToken) {
  const rows = await q(`SELECT id, class_status FROM \`${D.class}\`.t_class_info WHERE id = 'CLS-U2601'`);
  if (!rows.length) return '⚠️ U2601 不存在，跳过升实训前置';
  if (Number(rows[0].class_status) === 5) return 'U2601 已是实训中（无需升级）';
  const pms =
    (await api('GET', '/api/class/meta/staff?group=projectManager', { token: qiansyToken })).json?.data?.list ?? [];
  const ets =
    (await api('GET', '/api/class/meta/staff?group=employmentTeacher', { token: qiansyToken })).json?.data?.list ??
    [];
  const pm = pms[0];
  const et = ets[0];
  const up = await api('POST', '/api/class/info/training/upgrade', {
    token: qiansyToken,
    body: {
      classId: 'CLS-U2601',
      projectManagerId: pm?.userId,
      projectManagerName: pm?.userName,
      employmentTeacherId: et?.userId,
      employmentTeacherName: et?.userName,
      remark: 'VERIFY-ROUND3',
    },
  });
  return `U2601 升实训 → code=${up.json?.code}（项目经理=${pm?.userName} / 就业指导=${et?.userName}）`;
}

let db;
async function q(sql, params = []) {
  const [rows] = await db.query(sql, params);
  return rows;
}

/* ============================================================
 * 临时验证数据（VR3 前缀）
 * ============================================================ */
const FX = {
  noEnroll: 'VR3ENR1', cEnroll: 'CST-VR3ENR1', ordEnroll: 'ORD-VR3ENR1',
  noEnroll2: 'VR3ENR2', cEnroll2: 'CST-VR3ENR2', ordEnroll2: 'ORD-VR3ENR2',
  noAssign: 'VR3AST1', cAssign: 'CST-VR3AST1',
};

async function cloneRow(table, whereCol, whereVal, newId, overrides = {}) {
  const cols = await q(`SHOW COLUMNS FROM ${table}`);
  const names = cols.map((c) => c.Field);
  const gen = new Set(
    cols.filter((c) => String(c.Extra || '').toUpperCase().includes('GENERATED')).map((c) => c.Field),
  );
  const [src] = await q(`SELECT * FROM ${table} WHERE \`${whereCol}\` = ? ORDER BY id LIMIT 1`, [whereVal]);
  if (!src) throw new Error(`缺少基准行：${table}.${whereCol}=${whereVal}`);
  const obj = { ...src, id: newId, ...overrides };
  const keys = Object.keys(obj).filter((k) => names.includes(k) && !gen.has(k));
  await db.query(
    `INSERT INTO ${table} (\`${keys.join('`,`')}\`) VALUES (${keys.map(() => '?').join(',')})`,
    keys.map((k) => (obj[k] === undefined ? null : obj[k])),
  );
}

async function cleanFx() {
  await q(`DELETE FROM \`${D.class}\`.t_class_consult_push
            WHERE consult_no LIKE 'VR3%' OR id LIKE 'PUSH-VR3%' OR student_name LIKE '验证入班%'`);
  await q(`DELETE FROM \`${D.class}\`.t_class_student WHERE student_no LIKE 'VR3%' OR source_id LIKE 'VR3%'`);
  await q(`DELETE FROM \`${D.classJh}\`.t_class_student WHERE student_no LIKE 'VR3%' OR source_id LIKE 'VR3%'`);
  await q(`DELETE FROM \`${D.consult}\`.t_consult_fee_order WHERE student_no LIKE 'VR3%' OR order_no LIKE 'SKVR3%'`);
  await q(`DELETE FROM \`${D.consult}\`.t_consult_student WHERE student_no LIKE 'VR3%'`);
  await q(`DELETE FROM \`${D.consult}\`.t_consult_history WHERE consult_student_id LIKE 'CST-VR3%'`);
  await q(
    `UPDATE \`${D.class}\`.t_class_info SET student_count =
       (SELECT COUNT(*) FROM \`${D.class}\`.t_class_student s WHERE s.class_id = t_class_info.id AND s.is_deleted = 0)`,
  );
}

async function seedFx() {
  await cleanFx();
  // 已缴 + 未分派（正式学员状态 7）→ 用于「入班」两路
  await cloneRow(`${D.consult}.t_consult_student`, 'student_no', 'U26016', FX.cEnroll, {
    student_no: FX.noEnroll, student_name: '验证入班甲', class_name: null, class_id: null,
  });
  await cloneRow(`${D.consult}.t_consult_fee_order`, 'student_no', 'U26016', FX.ordEnroll, {
    consult_student_id: FX.cEnroll, student_no: FX.noEnroll, student_name: '验证入班甲',
    status: 2, order_no: `SK${FX.noEnroll}`,
  });
  // ⚠️ 初高入班后该生「已在初高」→ 同一人不能再分派到大学部（业务规则），
  //    所以「大学部」这一路必须用**另一个**学员。
  await cloneRow(`${D.consult}.t_consult_student`, 'student_no', 'U26016', FX.cEnroll2, {
    student_no: FX.noEnroll2, student_name: '验证入班乙', class_name: null, class_id: null,
  });
  await cloneRow(`${D.consult}.t_consult_fee_order`, 'student_no', 'U26016', FX.ordEnroll2, {
    consult_student_id: FX.cEnroll2, student_no: FX.noEnroll2, student_name: '验证入班乙',
    status: 2, order_no: `SK${FX.noEnroll2}`,
  });
  // 待分配（状态 1）→ 用于「分配咨询老师」
  await cloneRow(`${D.consult}.t_consult_student`, 'student_no', 'U26016', FX.cAssign, {
    student_no: FX.noAssign, student_name: '验证分配甲', consult_state: 1,
    owner_id: null, owner_name: null, owner_title: null, class_name: null, class_id: null,
  });
  console.log(`  已造临时学员：${FX.noEnroll} / ${FX.noEnroll2}（已缴·未分派） / ${FX.noAssign}（待分配）`);
}

/* ============================== 主流程 ============================== */

async function main() {
  const onlyClean = process.argv.includes('--clean');
  db = await mysql.createConnection({ ...DB, database: D.class });

  if (onlyClean) {
    await cleanFx();
    console.log('已清理 VR3 临时数据。');
    await db.end();
    return;
  }

  const zhanghtT = await login('zhanght');   // 大学部班主任
  const qiansyT = await login('qiansy');     // 校长（全权）
  const zhanglsT = await login('zhangls');   // 市场咨询负责人
  const wangjlT = await login('wangjl');     // 咨询经理
  const lilxT = await login('lilx');         // 咨询师

  /* ============================================================
   * 一、升实训 = 交棒：原班主任/教员退出（大学部不再展示该班）
   * ============================================================ */
  section('一、升实训「交棒」后，大学部班级管理/花名册不再展示该班（问题①）');

  console.log('  ' + (await ensureU2601Upgraded(qiansyT)));

  const zhanghtId = userIdOf(zhanghtT);
  // 班主任名下的全部班（不过滤阶段）
  const allMine = await q(
    `SELECT id, class_name, class_status FROM \`${D.class}\`.t_class_info
      WHERE is_deleted = 0
        AND (head_teacher_id = ? OR teacher_id = ? OR assistant_id = ?)`,
    [zhanghtId, zhanghtId, zhanghtId],
  );
  const trainingOnes = allMine.filter((c) => Number(c.class_status) === 5);
  const normalOnes = allMine.filter((c) => Number(c.class_status) !== 5);
  check('①-1 前置：演示数据里存在「班主任名下 + 已升实训(5)」的班（回归场景成立）',
    trainingOnes.length > 0,
    `实训班=${trainingOnes.map((c) => c.class_name).join(',') || '无'} / 未升实训=${normalOnes.map((c) => c.class_name).join(',') || '无'}`);

  const infoRes = await api('GET', '/api/class/info/list?page=1&size=200', { token: zhanghtT });
  const gotIds = new Set((infoRes.json?.data?.list ?? []).map((x) => x.id));
  const stillThere = trainingOnes.filter((c) => gotIds.has(c.id));
  check('①-2 交棒：实训班**不再出现**在班主任的「班级管理」列表',
    infoRes.json?.code === 200 && stillThere.length === 0,
    `仍出现=${stillThere.map((c) => c.class_name).join(',') || '无'}`);

  const missingNormal = normalOnes.filter((c) => !gotIds.has(c.id));
  check('①-3 交棒只针对已升实训的班 —— 班主任名下的非实训班照常显示',
    missingNormal.length === 0,
    `应 ${normalOnes.length} 个 / 缺 ${missingNormal.map((c) => c.class_name).join(',') || '无'}`);

  const expectStu = await q(
    `SELECT student_no FROM \`${D.class}\`.t_class_student
      WHERE is_deleted = 0 AND class_id IN (${trainingOnes.map(() => '?').join(',') || "''"})`,
    trainingOnes.map((c) => c.id),
  );
  const stuRes = await api('GET', '/api/class/student/list?page=1&size=200', { token: zhanghtT });
  const gotNos = new Set((stuRes.json?.data?.list ?? []).map((x) => x.studentNo));
  const leakedStu = expectStu.filter((s) => gotNos.has(s.student_no));
  check('①-4 交棒：实训班学生**不再出现**在班主任的「班级信息管理」花名册',
    stuRes.json?.code === 200 && leakedStu.length === 0,
    `实训班学生 ${expectStu.length} 人 / 泄漏 ${leakedStu.length} 人`);

  const tStuRes = await api('GET', '/api/class/student/list?page=1&size=200&classId=' + (trainingOnes[0]?.id ?? ''), {
    token: zhanghtT,
  });
  check('①-5 交棒：按实训班筛选花名册 → 空',
    (tStuRes.json?.data?.total ?? 0) === 0,
    `班级=${trainingOnes[0]?.class_name} total=${tStuRes.json?.data?.total}`);

  // 写操作收回：班主任改实训班学生 → 被拦（无权管理该学生）
  const someStu = await q(
    `SELECT id, student_no FROM \`${D.class}\`.t_class_student
      WHERE is_deleted = 0 AND class_id = ? LIMIT 1`,
    [trainingOnes[0]?.id],
  );
  const wr = await api('PUT', '/api/class/student/update', {
    token: zhanghtT,
    body: { studentId: someStu[0]?.id },
  });
  const wrMsg = String(wr.json?.msg ?? wr.json?.message ?? wr.json?.error ?? ''); // 40302 = 无操作权限
  check('①-6 交棒：班主任对实训班学生的写操作被收回',
    wr.status === 403 || Number(wr.json?.code) === 40302 || /无权/.test(wrMsg),
    `${someStu[0]?.student_no}: http=${wr.status} code=${wr.json?.code} msg=${wrMsg || '(空)'}`);

  // 监督角色不受影响：校长/学管仍看得到该实训班与其学生
  const pInfo = await api('GET', '/api/class/info/list?page=1&size=200', { token: qiansyT });
  const pIds = new Set((pInfo.json?.data?.list ?? []).map((x) => x.id));
  const pRes = await api('GET', '/api/class/student/list?page=1&size=200&classId=' + (trainingOnes[0]?.id ?? ''), {
    token: qiansyT,
  });
  check('①-7 监督角色不受交棒影响：校长仍能看到该实训班与其学生',
    trainingOnes.every((c) => pIds.has(c.id)) && (pRes.json?.data?.total ?? 0) > 0,
    `班级在校长列表=${trainingOnes.every((c) => pIds.has(c.id))} 学生数=${pRes.json?.data?.total}`);

  /* ============================================================
   * 二、咨询「学生管理 → 入班」：选学段 + 选开放班级
   * ============================================================ */
  section('二、咨询「入班」= 选学段（大学部/初高中）+ 选开放班级（问题②）');

  await seedFx();

  const oc = await api('GET', '/api/consult/student/open-classes', { token: zhanglsT });
  const univ = oc.json?.data?.univ ?? [];
  const jh = oc.json?.data?.jh ?? [];
  check('②-1 入班弹窗数据源 /open-classes 正常（大学部 + 初高）',
    oc.json?.code === 200 && univ.length > 0 && jh.length > 0,
    `大学部 ${univ.length} 个 / 初高 ${jh.length} 个`);

  const univClassId = univ[0]?.id || univ[0]?.classId;
  const jhClassId = jh[0]?.classId || jh[0]?.id;

  // ②-2 初高：直接入班
  const jhRes = await api('POST', '/api/consult/student/enroll-to-class', {
    token: zhanglsT,
    body: { id: FX.cEnroll, classId: jhClassId, module: 'class-jh' },
  });
  // ⚠️ 初高会给学员**重新生成学号**（generateStudentNo），所以只能用
  //    幂等键 source_system='consult' + source_id=<咨询学号> 回查。
  const jhRow = await q(
    `SELECT student_no, class_id, class_name FROM \`${D.classJh}\`.t_class_student
      WHERE source_system = 'consult' AND source_id = ? AND is_deleted = 0`,
    [FX.noEnroll],
  );
  check('②-2 选「初高中」+ 开放班级 → 学生**直接**进入该班（sms_class_jh.t_class_student）',
    jhRes.json?.code === 200 && jhRow.length === 1 && jhRow[0].class_id === jhClassId,
    `code=${jhRes.json?.code} msg=${jhRes.json?.message} 落库 class=${jhRow[0]?.class_id ?? '无'}(${jhRow[0]?.class_name ?? '-'})`);

  // ②-3 大学部：推「待接收学员」（另一个学员，避免撞「已在初高」规则）
  const uvRes = await api('POST', '/api/consult/student/enroll-to-class', {
    token: zhanglsT,
    body: { id: FX.cEnroll2, classId: univClassId, module: 'class' },
  });
  const uvPush = await q(
    `SELECT consult_no, intend_class_id, apply_status FROM \`${D.class}\`.t_class_consult_push
      WHERE consult_no = ? AND is_deleted = 0`,
    [FX.noEnroll2],
  );
  check('②-3 选「大学部」+ 开放班级 → 学生进入该班「待接收学员」',
    uvRes.json?.code === 200 && uvPush.length === 1 && Number(uvPush[0].apply_status) === 1,
    `code=${uvRes.json?.code} msg=${uvRes.json?.message} 推送单=${uvPush[0]?.consult_no ?? '无'} status=${uvPush[0]?.apply_status ?? '-'}`);

  check('②-4 推送单上的意向班级 = 所选开放班级',
    uvPush[0]?.intend_class_id === univClassId,
    `intend=${uvPush[0]?.intend_class_id} / 选=${univClassId}`);

  // ②-5 重复确认：被「已分派不可再分派」拦下，且不会产生重复数据
  const uvAgain = await api('POST', '/api/consult/student/enroll-to-class', {
    token: zhanglsT,
    body: { id: FX.cEnroll2, classId: univClassId, module: 'class' },
  });
  const dupRows = await q(
    `SELECT COUNT(*) AS c FROM \`${D.class}\`.t_class_consult_push
      WHERE consult_no = ? AND is_deleted = 0`,
    [FX.noEnroll2],
  );
  check('②-5 重复确认被拦下（已分派不可再分派），且库里没有重复推送单',
    uvAgain.json?.code !== 200 && Number(dupRows[0]?.c ?? 0) === 1,
    `code=${uvAgain.json?.code} msg=${uvAgain.json?.message} 推送单数=${dupRows[0]?.c}`);

  // ②-5b 初高侧同理：不会重复建档
  const jhAgain = await api('POST', '/api/consult/student/enroll-to-class', {
    token: zhanglsT,
    body: { id: FX.cEnroll, classId: jhClassId, module: 'class-jh' },
  });
  const jhDup = await q(
    `SELECT COUNT(*) AS c FROM \`${D.classJh}\`.t_class_student
      WHERE source_system = 'consult' AND source_id = ? AND is_deleted = 0`,
    [FX.noEnroll],
  );
  check('②-5b 初高重复入班不会重复建档',
    Number(jhDup[0]?.c ?? 0) === 1,
    `code=${jhAgain.json?.code} msg=${jhAgain.json?.message} 初高学生数=${jhDup[0]?.c}`);

  // ②-6 未缴不允许入班（业务闸仍然生效）
  await q(`UPDATE \`${D.consult}\`.t_consult_fee_order SET status = 1 WHERE consult_student_id = ?`, [FX.cEnroll2]);
  const noPay = await api('POST', '/api/consult/student/enroll-to-class', {
    token: zhanglsT,
    body: { id: FX.cEnroll2, classId: univClassId, module: 'class' },
  });
  check('②-6 未缴（无已到账收款单）时被拦下',
    noPay.json?.code !== 200,
    `code=${noPay.json?.code} msg=${noPay.json?.message}`);
  await q(`UPDATE \`${D.consult}\`.t_consult_fee_order SET status = 2 WHERE consult_student_id = ?`, [FX.cEnroll2]);

  /* ============================================================
   * 三、审批中心「分配咨询老师」下拉
   * ============================================================ */
  section('三、审批中心「分配咨询老师」下拉不再无数据（问题③）');

  const cRes = await api('GET', '/api/consult/student/consultants', { token: wangjlT });
  const list = cRes.json?.data ?? [];
  check('③-1 咨询老师候选不为空', Array.isArray(list) && list.length > 0, `n=${list.length}`);
  check('③-2 每条都有 id / name / title（前端 el-option 三个字段都吃）',
    list.every((c) => c.id && c.name && c.title),
    JSON.stringify(list.map((c) => `${c.name}(${c.title})`)));
  check('③-3 候选与 sms_perm 角色一致（含咨询经理 + 咨询师）',
    list.some((c) => c.name === '王经理') && list.some((c) => c.title.includes('咨询师')),
    list.map((c) => `${c.name}·${c.title}`).join(' | '));
  check('③-4 每条都带名下学生数 count（前端可展示）',
    list.every((c) => typeof c.count === 'number'),
    list.map((c) => `${c.name}=${c.count}`).join(' '));

  // 经理能分配（角色不再被降级成咨询师 → 不再 403）
  const center = await api('GET', '/api/consult/approve/center', { token: wangjlT });
  const target = (center.json?.data?.pendingAssignList ?? []).find((x) => x.consultStudentId === FX.cAssign)
    ?? (center.json?.data?.pendingAssignList ?? [])[0];
  const aRes = await api('POST', '/api/consult/student/assign', {
    token: wangjlT,
    body: { consultStudentId: target?.consultStudentId, ownerName: list[0]?.name },
  });
  check('③-5 咨询经理能成功分配（原来是 403：被降级成咨询师）',
    aRes.json?.code === 200, `http=${aRes.status} code=${aRes.json?.code} msg=${aRes.json?.message}`);

  const aDeny = await api('POST', '/api/consult/student/assign', {
    token: lilxT,
    body: { consultStudentId: target?.consultStudentId, ownerName: list[0]?.name },
  });
  check('③-6 咨询师**不能**分配（权限边界还在）',
    aDeny.json?.code !== 200, `http=${aDeny.status} code=${aDeny.json?.code} msg=${aDeny.json?.message}`);

  /* ---------- 清理 ---------- */
  await cleanFx();
  console.log('\n已清理 VR3 临时数据。');

  /* ---------- 汇总 ---------- */
  const failed = results.filter((r) => !r.pass);
  section(`汇总：${results.length - failed.length}/${results.length} 通过`);
  if (failed.length) {
    for (const f of failed) console.log(`  ❌ ${f.name}`);
    process.exitCode = 1;
  }
  await db.end();
}

main().catch(async (e) => {
  console.error('✗ 异常：', e.message);
  try {
    if (db) await db.end();
  } catch {
    /* ignore */
  }
  process.exitCode = 1;
});
