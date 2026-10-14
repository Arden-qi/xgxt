/**
 * 分班 + 升学 链路验证（★ 2026-10-05）
 *
 * 覆盖两条新信息流转链路（真登录 + 真调接口 + 查库断言）：
 *   ① 咨询「分班」（收款与缴费，缴费状态=已缴才可分班）
 *      → 大学部开放班级：推「待接收学员」，班主任同意后入班
 *      → 初高开放班级：**直接**进入对应班级（sms_class_jh.t_class_student）
 *   ② 初高「升学」（基础数据操作流程）
 *      → 选大学部开放班级 → 推「待接收学员」→ 班主任同意后入班
 *
 * 用法：node tools/verify-assign-promote.mjs
 * 前提：后端 8004 已起（MySQL 3306）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_JOB = path.join(HERE, '..', 'server-job');

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
  password: env.DB_PASSWORD || '',
  multipleStatements: false,
};
const D = {
  class: env.DB_NAME_CLASS || 'sms_class',
  consult: env.DB_NAME_CONSULT || 'sms_consult',
  classJh: env.DB_NAME_CLASS_JH || 'sms_class_jh',
};

/* mysql2 从 server-job 解析（tools 下没有自己的 node_modules） */
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

let db;
async function q(sql, params = []) {
  const [rows] = await db.query(sql, params);
  return rows;
}

/* ============================================================
 * 临时验证数据（VRFX 前缀）
 * ------------------------------------------------------------
 * ⚠️ 2026-10-06 起演示数据里「已缴的咨询学员」**全部已经分过班**
 *    （种子脚本 seed-all-demo.mjs 刻意如此，好让「待接收学员」有内容）。
 *    而分班接口现在会正确拦住「已分派的学生」—— 于是老脚本里
 *    「随便挑一笔已缴单去分班」的取数方式必然失败（不是回归，是夹具过期）。
 *    这里改成**自己造两个「已缴 + 未分派」的学员**，跑完即删，与演示数据无关。
 * ============================================================ */
const FX = {
  noA: 'VRFX2601', cA: 'CST-VRFX2601', ordA: 'ORD-VRFX2601',
  noB: 'VRFX2602', cB: 'CST-VRFX2602', ordB: 'ORD-VRFX2602',
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
  // ⚠️ ④「初高升学」推给大学部的推送单，consult_no 是**初高侧生成的学号**（S2026xxxx），
  //    不是 VRFX2602 —— 所以不能只按 consult_no 前缀删，要按 student_name 标记兜底。
  await q(`DELETE FROM \`${D.class}\`.t_class_consult_push
            WHERE student_name LIKE '验证分班%' OR consult_no LIKE 'VRFX%' OR id LIKE 'PUSH-VRFX%'`);
  await q(`DELETE FROM \`${D.class}\`.t_class_student WHERE student_no LIKE 'VRFX%' OR source_id LIKE 'VRFX%'`);
  await q(`DELETE FROM \`${D.classJh}\`.t_class_student WHERE student_no LIKE 'VRFX%' OR source_id LIKE 'VRFX%'`);
  await q(`DELETE FROM \`${D.consult}\`.t_consult_fee_order WHERE student_no LIKE 'VRFX%' OR order_no LIKE 'SKVRFX%'`);
  await q(`DELETE FROM \`${D.consult}\`.t_consult_student WHERE student_no LIKE 'VRFX%'`);
  await q(
    `UPDATE \`${D.class}\`.t_class_info SET student_count =
       (SELECT COUNT(*) FROM \`${D.class}\`.t_class_student s WHERE s.class_id = t_class_info.id)`,
  );
}

async function seedFx() {
  await cleanFx();
  // 基准行取种子里 U26016（咨询状态=正式，已有已缴单）
  await cloneRow(`${D.consult}.t_consult_student`, 'student_no', 'U26016', FX.cA,
    { student_no: FX.noA, student_name: '验证分班甲' });
  await cloneRow(`${D.consult}.t_consult_student`, 'student_no', 'U26016', FX.cB,
    { student_no: FX.noB, student_name: '验证分班乙' });
  await cloneRow(`${D.consult}.t_consult_fee_order`, 'student_no', 'U26016', FX.ordA,
    { consult_student_id: FX.cA, student_no: FX.noA, student_name: '验证分班甲', status: 2, order_no: `SK${FX.noA}` });
  await cloneRow(`${D.consult}.t_consult_fee_order`, 'student_no', 'U26016', FX.ordB,
    { consult_student_id: FX.cB, student_no: FX.noB, student_name: '验证分班乙', status: 2, order_no: `SK${FX.noB}` });
  console.log(`  已造临时学员：${FX.noA} / ${FX.noB}（已缴 + 未分派）`);
}

/* ============================== 主流程 ============================== */

async function main() {
  db = await mysql.createConnection({ ...DB, database: D.class });

  const consultT = await login('zhangls'); // 市场咨询负责人
  const principalT = await login('qiansy'); // 校长（全权）
  const sunminT = await login('sunmin'); // 初高班主任
  const zhanghtT = await login('zhanght'); // 大学部班主任

  /* ---------- 一、开放班级聚合 ---------- */
  section('一、开放班级聚合（分班/升学弹窗数据源）');
  const oc = await api('GET', '/api/consult/student/open-classes', { token: consultT });
  check('①-1 zhangls 调 /consult/student/open-classes 成功', oc.json?.code === 200, `code=${oc.json?.code} msg=${oc.json?.message}`);
  const univ = oc.json?.data?.univ ?? [];
  const jh = oc.json?.data?.jh ?? [];
  check('①-2 大学部开放班级 ≥ 1', univ.length > 0, `n=${univ.length}`);
  check('①-3 初高开放班级 ≥ 1', jh.length > 0, `n=${jh.length}`);
  const univClassId = univ[0].id || univ[0].classId;
  const jhClassId = jh[0].classId || jh[0].id;
  const univClassName = univ[0].className;
  const jhClassName = jh[0].className;
  console.log(`           大学部目标：${univClassName}(${univClassId})  初高目标：${jhClassName}(${jhClassId})`);

  /* ---------- 二、咨询「分班」→ 大学部（待接收学员） ---------- */
  section('二、咨询「分班」→ 大学部「待接收学员」');
  // 自造「已到账(2) + 未分派」的学员（演示数据里的已缴学员都已分过班）
  await seedFx();
  const paidStuId = FX.cA;
  const paidStuName = '验证分班甲';
  check('②-0 临时学员已就绪（已缴 + 未分派）', true, `${FX.noA} / ${paidStuId}`);

  const enr = await api('POST', '/api/consult/student/enroll-to-class', {
    token: consultT,
    body: { id: paidStuId, classId: univClassId, module: 'class' },
  });
  check('②-1 已缴学员分班（大学部）成功', enr.json?.code === 200, `code=${enr.json?.code} msg=${enr.json?.message}`);
  const consultNo = enr.json?.data?.consultNo;
  const pushed = Number(enr.json?.data?.inserted ?? 0) + Number(enr.json?.data?.skipped ?? 0);
  check('②-2 返回 consultNo', !!consultNo, String(consultNo));

  const univPush = await q(
    `SELECT id, student_name, intend_class_id, intend_class_name, apply_status, source_system
       FROM \`${D.class}\`.t_class_consult_push WHERE consult_no = ? ORDER BY create_time DESC LIMIT 1`,
    [consultNo],
  );
  check('②-3 大学部 t_class_consult_push 产生待接收记录', univPush.length === 1 && pushed > 0);
  check(
    '②-4 意向班级正确',
    univPush[0]?.intend_class_id === univClassId,
    `intend=${univPush[0]?.intend_class_id}/${univPush[0]?.intend_class_name}`,
  );

  const enr2 = await api('POST', '/api/consult/student/enroll-to-class', {
    token: consultT,
    body: { id: paidStuId, classId: univClassId, module: 'class' },
  });
  // ★ 2026-10-06 新口径：已分派（待接收）就不能再分派 —— 重复分班被后端拦下，
  //   不再走「幂等跳过」那条路（幂等只对「非法重放」兜底）。
  check(
    '②-5 重复分班被拦（已分派不可再分派）',
    enr2.json?.code === 40006 && /不能重复分派|已分班/.test(enr2.json?.message ?? ''),
    `code=${enr2.json?.code} msg=${enr2.json?.message}`,
  );

  // 未缴学员分班必须被拒
  const unpaid = await q(
    `SELECT consult_student_id, student_name FROM \`${D.consult}\`.t_consult_fee_order
      WHERE status = 0 AND is_deleted = 0 ORDER BY create_time DESC LIMIT 1`,
  );
  if (unpaid.length) {
    const enr3 = await api('POST', '/api/consult/student/enroll-to-class', {
      token: consultT,
      body: { id: unpaid[0].consult_student_id, classId: univClassId, module: 'class' },
    });
    check(
      '②-6 未缴学员分班被拒（业务码 40006）',
      enr3.json?.code !== 200,
      `code=${enr3.json?.code} msg=${enr3.json?.message}`,
    );
  }

  /* ---------- 三、咨询「分班」→ 初高（直接入班） ---------- */
  section('三、咨询「分班」→ 教学管理（初高）直接入班');
  const jhStuId = FX.cB;
  const jhStuName = '验证分班乙';

  const enrJh = await api('POST', '/api/consult/student/enroll-to-class', {
    token: consultT,
    body: { id: jhStuId, classId: jhClassId, module: 'class-jh' },
  });
  check('③-1 已缴学员分班（初高）成功', enrJh.json?.code === 200, `code=${enrJh.json?.code} msg=${enrJh.json?.message}`);
  const jhConsultNo = enrJh.json?.data?.consultNo;

  const jhStu = await q(
    `SELECT id, student_no, student_name, class_id, class_name, student_status, source_system, source_id
       FROM \`${D.classJh}\`.t_class_student
      WHERE source_system = 'consult' AND source_id = ? LIMIT 1`,
    [jhConsultNo],
  );
  check('③-2 初高 t_class_student 直建入档', jhStu.length === 1);
  check('③-3 落入所选班级', jhStu[0]?.class_id === jhClassId, `${jhStu[0]?.class_name}`);
  check('③-4 状态=正式在读(5)', Number(jhStu[0]?.student_status) === 5, String(jhStu[0]?.student_status));

  const enrJh2 = await api('POST', '/api/consult/student/enroll-to-class', {
    token: consultT,
    body: { id: jhStuId, classId: jhClassId, module: 'class-jh' },
  });
  // ★ 2026-10-06 新口径：已经直建入初高的学生，再点「分班」会被后端拦下
  //   （初高入档本身的幂等 duplicate 由 tools/class-jh 的 QA 覆盖）
  check(
    '③-5 初高已入班后重复分班被拦',
    enrJh2.json?.code === 40006 && /已直接进入|不能再分派/.test(enrJh2.json?.message ?? ''),
    `code=${enrJh2.json?.code} msg=${enrJh2.json?.message}`,
  );

  /* ---------- 四、初高「升学」→ 大学部「待接收学员」 ---------- */
  section('四、初高「升学」→ 大学部「待接收学员」');
  // 选一名初高「正式在读」学生（就用 ③ 刚入档的，保证存在）
  const targets = await api('GET', '/api/class-jh/classInfo/upgrade-targets', { token: sunminT });
  check('④-1 sunmin 调 /classInfo/upgrade-targets 成功（大学部开放班级）', targets.json?.code === 200 && (targets.json?.data?.length ?? 0) > 0, `n=${targets.json?.data?.length}`);
  const promoteTarget = targets.json?.data?.[0]?.id;

  const promoteStu = jhStu[0];
  const pr = await api('POST', '/api/class-jh/student/promote', {
    token: sunminT,
    body: { id: promoteStu.id, targetClassId: promoteTarget, remark: '链路验证' },
  });
  check('④-2 初高班主任发起升学成功', pr.json?.code === 200, `code=${pr.json?.code} msg=${pr.json?.message}`);

  const upPush = await q(
    `SELECT id, student_name, intend_class_id, source_system, origin_student_id, from_class_id, from_class_name
       FROM \`${D.class}\`.t_class_consult_push WHERE consult_no = ? ORDER BY create_time DESC LIMIT 1`,
    [promoteStu.student_no],
  );
  check('④-3 大学部产生「待接收」记录（幂等键=初高学号）', upPush.length === 1);
  check('④-4 来源标记 source_system=upgrade', upPush[0]?.source_system === 'upgrade', String(upPush[0]?.source_system));
  check('④-5 携带来源学生ID', upPush[0]?.origin_student_id === promoteStu.id,
    `push.origin_student_id=${upPush[0]?.origin_student_id} · 初高学生id=${promoteStu.id} · 初高学号=${promoteStu.student_no}`);

  const pr2 = await api('POST', '/api/class-jh/student/promote', {
    token: sunminT,
    body: { id: promoteStu.id, targetClassId: promoteTarget },
  });
  check(
    '④-6 重复升学幂等',
    pr2.json?.code === 200 && Number(pr2.json?.data?.inserted ?? 0) === 0,
    `inserted=${pr2.json?.data?.inserted} skipped=${pr2.json?.data?.skipped}`,
  );

  // 大学部班主任的「待接收学员」列表能看到这条升学记录
  const univList = await api('GET', '/api/class/consult/list?page=1&size=50', { token: zhanghtT });
  const upRow = (univList.json?.data?.list ?? univList.json?.data?.records ?? []).find(
    (x) => x.consultNo === promoteStu.student_no,
  );
  check('④-7 大学部待接收列表可见升学记录', !!upRow, upRow ? `sourceKind=${upRow.sourceKind}` : '(未找到)');
  if (upRow) {
    check('④-8 显示「初高升学」来源', upRow.sourceKind === '初高升学', String(upRow.sourceKind));
  }

  /* ---------- 五、模块隔离（负例） ---------- */
  section('五、模块隔离负例');
  const neg1 = await api('POST', '/api/class-jh/student/promote', {
    token: zhanghtT,
    body: { id: promoteStu.id, targetClassId: promoteTarget },
  });
  check('⑤-1 大学部班主任调初高升学被拒(403)', neg1.status === 403, `HTTP ${neg1.status} code=${neg1.json?.code}`);

  /* ---------- 汇总 ---------- */
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${'='.repeat(72)}\n结果：${passed}/${results.length} 通过\n${'='.repeat(72)}`);
  process.exitCode = passed === results.length ? 0 : 1;
}

main()
  .catch((e) => {
    console.error('验证脚本异常：', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (db) {
      try {
        await cleanFx();
        console.log('（已清理 VRFX 临时验证数据）');
      } catch (e) {
        console.error('清理临时数据失败：', e.message);
      }
      await db.end();
    }
  });
