/**
 * 三条「信息流转」链路验证（统一门户版合并后端）
 *
 * ============================================================
 * 背景（2026-10-05 用户拍板的口径）
 * ============================================================
 *   班级管理模块的「缴费 / 催费 / 宿舍 / 待接收学员」四个页面读的是
 *   **只读副本**（sms_common.t_class_*_sync、sms_class.t_class_consult_push）。
 *   接收口一直存在，但从来没有生产端推过 —— 这就是当初「信息不流转」的根因。
 *   本次补齐了三个生产端，本脚本逐条验证它们真的把数据推到了位：
 *
 *     ① 咨询 → 班级   点「入班」→ t_class_consult_push
 *     ② 财务 → 班级   新增/编辑/核对缴费单 → t_class_fee_sync
 *     ③ 教务 → 班级   点「发起催费」→ t_class_urge_sync
 *                     点「分派宿舍 / 取消分派」→ t_class_dorm_room_sync
 *
 * ============================================================
 * 用法（在项目根目录执行，无需额外依赖）
 * ============================================================
 *   node tools/verify-sync-links.mjs
 *   node tools/verify-sync-links.mjs --clean   # 跑完后想清干净，可单独执行清理
 *
 * 前提：后端已起来（一键启动.bat 或 cd server-job && npm run dev），监听 8004，
 *       且 MySQL 按 server-job/.env 可连。
 *
 * 说明：脚本会自动补最小「验证用」数据（带 VERIFY 前缀，可随时清理），
 *       因为就业库 / 教务库的演示数据是空的，不补的话没法跑通链路 ③。
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
  password: env.DB_PASSWORD || '',
  multipleStatements: false,
};
const D = {
  class: env.DB_NAME_CLASS || 'sms_class',
  common: env.DB_NAME_COMMON || 'sms_common',
  job: env.DB_NAME || 'sms_job',
  edu: env.DB_NAME_EDU || 'sms_edu',
  finance: env.DB_NAME_FINANCE || 'sms_finance',
  consult: env.DB_NAME_CONSULT || 'sms_consult',
};

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
  return { token, accountId: r.json?.data?.account?.accountId, userName: r.json?.data?.account?.userName };
}

/* ---------------- 主流程 ---------------- */
/** 本次运行造出来的业务 ID（收尾时按它删干净，避免污染演示数据） */
const TRACK = { consultNos: [], feeSourceIds: [] };

/**
 * 清理本脚本造的验证数据。
 * ★ 2026-10-06：原来只在 `--clean` 时清，正常跑完会把推送单 / 缴费副本 / 财务单留在库里，
 *   下一轮别的脚本读到的就是脏数据。现在正常跑完也会调用一次（`--keep` 可跳过）。
 */
async function cleanup(q, track = TRACK) {
  const r1 = await q(`DELETE FROM ${D.job}.t_job_fee_call WHERE student_id = ?`, ['VERIFY-JOB-STU-1']);
  const r2 = await q(`DELETE FROM ${D.job}.t_student_base WHERE id = ?`, ['VERIFY-JOB-STU-1']);
  const r3 = await q(`DELETE FROM ${D.common}.t_class_urge_sync WHERE student_no = ?`, ['VERIFY0001']);
  await q(`DELETE FROM ${D.edu}.t_edu_dorm_assignment WHERE class_name IN ('U02','U03','U04','U05')`);
  const r4 = await q(
    `DELETE FROM ${D.common}.t_class_dorm_room_sync WHERE source_id IN (SELECT id FROM ${D.edu}.t_edu_dorm_room WHERE building = ?)`,
    ['验证楼'],
  );
  const r5 = await q(`DELETE FROM ${D.edu}.t_edu_dorm_bed WHERE room_id IN (SELECT id FROM ${D.edu}.t_edu_dorm_room WHERE building = ?)`, ['验证楼']);
  const r6 = await q(`DELETE FROM ${D.edu}.t_edu_dorm_room WHERE building = ?`, ['验证楼']);
  // 本次运行按业务 ID 造的数据
  let r7 = { affectedRows: 0 };
  let r8 = { affectedRows: 0 };
  let r9 = { affectedRows: 0 };
  let r10 = { affectedRows: 0 };
  for (const no of track.consultNos) {
    const r = await q(`DELETE FROM ${D.class}.t_class_consult_push WHERE consult_no = ?`, [no]);
    r7.affectedRows += r.affectedRows;
  }
  for (const id of track.feeSourceIds) {
    const a = await q(`DELETE FROM ${D.common}.t_class_fee_sync WHERE source_id = ?`, [id]);
    const b = await q(`DELETE FROM ${D.finance}.t_finance_bill WHERE source_id = ?`, [id]);
    const c = await q(`DELETE FROM ${D.finance}.t_finance_fee WHERE id = ?`, [id]);
    r8.affectedRows += a.affectedRows;
    r9.affectedRows += b.affectedRows;
    r10.affectedRows += c.affectedRows;
  }
  // 财务「未核对」单还会在班级副本里留下痕迹，按 remark 兜底
  await q(`DELETE FROM ${D.common}.t_class_fee_sync WHERE source_id IN (
      SELECT id FROM ${D.finance}.t_finance_fee WHERE remark LIKE '%VERIFY%')`);
  await q(`DELETE FROM ${D.finance}.t_finance_fee WHERE remark LIKE '%VERIFY%'`);
  return {
    text:
      `催费单 ${r1.affectedRows} · 就业学生 ${r2.affectedRows} · 催费副本 ${r3.affectedRows} · ` +
      `宿舍副本 ${r4.affectedRows} · 床位 ${r5.affectedRows} · 房间 ${r6.affectedRows} · ` +
      `咨询推送 ${r7.affectedRows} · 缴费副本 ${r8.affectedRows} · 财务账单 ${r9.affectedRows} · 财务单 ${r10.affectedRows}`,
  };
}

async function main() {
  const conn = await mysql.createConnection({ ...DB, database: D.class });
  const q = async (sql, args) => {
    const [rows] = await conn.query(sql, args);
    return rows;
  };

  /* ---------------- 清理模式：把本脚本造的验证数据删掉 ---------------- */
  if (process.argv.includes('--clean')) {
    console.log('🧹 清理验证数据…');
    const { text } = await cleanup(q);
    console.log(`  ${text}`);
    await conn.end();
    return;
  }

  console.log(`后端：${BASE}`);
  console.log(`库：class=${D.class} common=${D.common} job=${D.job} edu=${D.edu} finance=${D.finance} consult=${D.consult}`);

  /* ============ 前置：登录 ============ */
  section('前置：门户登录（方案 A —— 就业/教务/班级账号能进）');
  const admin = await login('admin');          // sys_admin：全模块，但【只读】
  const consult = await login('zhangls');      // 咨询师
  const edu = await login('zhengym');          // 教务老师（edu 页面 + 催费入口 + 分派宿舍）
  const classT = await login('zhanght');       // 班主任（班级）
  const principal = await login('qiansy');     // 校长（唯一全权角色）
  const tokAdmin = admin.token;
  const tokConsult = consult.token;
  const tokEdu = edu.token;
  const tokClass = classT.token;
  const tokPrincipal = principal.token;
  check('admin 登录成功', !!tokAdmin);
  check('zhangls（咨询师）登录成功', !!tokConsult);
  check('zhengym（教务老师）登录成功', !!tokEdu);
  check('zhanght（班主任）登录成功', !!tokClass);
  check('qiansy（校长）登录成功', !!tokPrincipal);

  const pagesOf = async (tok) => {
    const r = await api('GET', '/api/job/auth/my-pages', { token: tok });
    const d = r.json?.data ?? {};
    return { roles: d.roles ?? [], codes: (d.pages ?? []).map((p) => p.code) };
  };
  if (tokEdu) {
    const { roles, codes } = await pagesOf(tokEdu);
    check(
      '教务老师（zhengym）拿到 edu 页面权限（= 能点「分派宿舍」）',
      codes.some((c) => String(c).startsWith('edu:')),
      `roles=${JSON.stringify(roles)} eduPages=${codes.filter((c) => String(c).startsWith('edu:')).join(',')}`,
    );
    check(
      '教务老师（zhengym）不再有「催费」入口（2026-10-22 用户要求下线）',
      !codes.includes('job:feeCall:view') && !codes.includes('edu:fee:view'),
      `job:feeCall:view=${codes.includes('job:feeCall:view')} edu:fee:view=${codes.includes('edu:fee:view')}`,
    );
  }
  if (tokClass) {
    const { roles, codes } = await pagesOf(tokClass);
    check(
      '班主任（zhanght）拿到 class 页面权限',
      codes.some((c) => String(c).startsWith('class:')),
      `roles=${JSON.stringify(roles)} classPages=${codes.filter((c) => String(c).startsWith('class:')).length}`,
    );
  }

  /* ============================================================
   * 链路 ① 咨询 → 班级（点「入班」）
   * ============================================================ */
  section('链路 ①  咨询 → 班级：点「入班」推送「待接收学员」');
  // 找一个咨询学生（优先「试学中」，否则任意）
  const [cand] = await q(
    `SELECT id, student_no, student_name, consult_state FROM ${D.consult}.t_consult_student
      WHERE is_deleted = 0 ORDER BY (consult_state = 5) DESC, create_time DESC LIMIT 1`,
  );
  if (!cand) {
    check('链路①：咨询库有可推送的学生', false, 'sms_consult.t_consult_student 没有数据');
  } else {
    const consultNo = String(cand.student_no || '').trim() || String(cand.id);
    TRACK.consultNos.push(consultNo);
    console.log(`  用学生：${cand.student_name}（${consultNo}）state=${cand.consult_state}`);

    await q(`DELETE FROM ${D.class}.t_class_consult_push WHERE consult_no = ?`, [consultNo]);
    const before = await q(`SELECT COUNT(*) c FROM ${D.class}.t_class_consult_push WHERE consult_no = ?`, [consultNo]);

    const r = await api('POST', '/api/consult/student/enroll-to-class', {
      token: tokConsult,
      body: { id: cand.id },
    });
    const okBiz = r.json?.code === 200;
    check(
      '①-1 调 /api/consult/student/enroll-to-class 返回成功',
      okBiz,
      `HTTP ${r.status} code=${r.json?.code} msg=${r.json?.message} data=${JSON.stringify(r.json?.data)}`,
    );

    const after = await q(
      `SELECT id, consult_no, student_name, student_no, is_deleted FROM ${D.class}.t_class_consult_push WHERE consult_no = ?`,
      [consultNo],
    );
    check(
      '①-2 班级侧「待接收学员」确实落库（重复推送前清空过）',
      after.length === 1 && Number(before[0].c) === 0,
      `before=${before[0].c} after=${after.length}${after[0] ? ` row=${JSON.stringify(after[0])}` : ''}`,
    );

    // 再推一次 → 幂等（不新增）
    await api('POST', '/api/consult/student/enroll-to-class', { token: tokConsult, body: { id: cand.id } });
    const again = await q(
      `SELECT COUNT(*) c FROM ${D.class}.t_class_consult_push WHERE consult_no = ?`,
      [consultNo],
    );
    check('①-3 重复点「入班」幂等（不产生第二条）', Number(again[0].c) === 1, `count=${again[0].c}`);
  }

  /* ============================================================
   * 链路 ② 财务 → 班级（新增/编辑缴费单就推）
   * ============================================================ */
  section('链路 ②  财务 → 班级：新增缴费单 → 缴费只读副本');
  // 学号取一个班级侧真实存在的（验证「按学号回查学生ID」）
  // ⚠️ 2026-10-06：重建后的演示数据里班级侧学号是 U26xxx / J26xxx，
  //    不再是班级模块自己生成的 S2026xxxx，所以不能再按 'S%' 过滤取人。
  const [clsStu] = await q(
    `SELECT student_no, student_name FROM ${D.class}.t_class_student WHERE is_deleted = 0 ORDER BY student_no LIMIT 1`,
  );
  const feeStudentNo = clsStu?.student_no || 'U26001';
  const feeStudentName = clsStu?.student_name || '验证学生';
  console.log(`  用学号：${feeStudentNo}（${feeStudentName}）`);

  const addRes = await api('POST', '/api/finance/fee/add', {
    token: tokAdmin,
    body: {
      studentId: `VERIFY-${Date.now()}`,
      studentNo: feeStudentNo,
      studentName: feeStudentName,
      deptCode: 1,
      feeType: 1,
      amount: 100000,
      // ★ 带上凭证 → 单据直接落「待核对(2)」，下一步「核对」才走得通
      //   （核对要求单子已上传凭证；非餐费凭证需唯一，所以带时间戳）
      voucherUrl: `/uploads/verify-${Date.now()}.png`,
    },
  });
  const feeId = addRes.json?.data?.id;
  if (feeId) TRACK.feeSourceIds.push(feeId);
  check(
    '②-1 调 /api/finance/fee/add 返回成功',
    addRes.json?.code === 200 && !!feeId,
    `HTTP ${addRes.status} code=${addRes.json?.code} msg=${addRes.json?.message} id=${feeId}`,
  );

  if (feeId) {
    const rows = await q(
      `SELECT id, source_system, source_id, student_no, student_id, fee_type, amount, pay_status, is_deleted
         FROM ${D.common}.t_class_fee_sync WHERE source_id = ?`,
      [feeId],
    );
    const row = rows[0];
    check(
      '②-2 班级侧缴费副本已生成',
      !!row && Number(row.is_deleted) === 0 && row.source_system === 'finance',
      row ? JSON.stringify(row) : '未找到副本行',
    );
    check(
      '②-3 按学号回查到了班级侧真实学生ID（跨库 id 空间对齐）',
      !!row && row.student_id && row.student_id !== feeStudentNo,
      row ? `student_no=${row.student_no} → student_id=${row.student_id}` : '',
    );

    // 编辑路径：核对通过 → 状态应更新
    const verRes = await api('POST', '/api/finance/fee/verify', { token: tokAdmin, body: { id: feeId } });
    const after = await q(
      `SELECT pay_status, is_deleted FROM ${D.common}.t_class_fee_sync WHERE source_id = ?`,
      [feeId],
    );
    check(
      '②-4 财务「核对」后副本状态被更新（编辑也会推）',
      verRes.json?.code === 200 && after.length === 1 && Number(after[0].pay_status) >= 3,
      `verify: code=${verRes.json?.code} msg=${verRes.json?.message} → pay_status=${after[0]?.pay_status}`,
    );
  }

  /* ============================================================
   * 链路 ③a 教务 → 班级（点「发起催费」）
   * ============================================================ */
  section('链路 ③a  教务 → 班级：发起催费 → 催费只读副本');
  const VERIFY_STU_ID = 'VERIFY-JOB-STU-1';
  const VERIFY_STU_NO = 'VERIFY0001';
  // 补最小验证数据（就业库学生），并清掉历史验证催费单（否则触发「同类重复」校验）
  // ⚠️ head_teacher_id 设成「教务老师本人」的账号 ID —— 催费 handle 只允许该学生的班主任，
  //    这样下一步「催缴完成」才走得通（真实场景里是班主任操作）。
  await q(
    `INSERT INTO ${D.job}.t_student_base
       (id, create_time, is_deleted, student_no, student_name, dept_code, gender, student_status, head_teacher_id, head_teacher_name)
     VALUES (?, NOW(), 0, ?, ?, 2, 1, 5, ?, ?)
     ON DUPLICATE KEY UPDATE student_name = VALUES(student_name), is_deleted = 0, student_status = 5,
        head_teacher_id = VALUES(head_teacher_id), head_teacher_name = VALUES(head_teacher_name)`,
    [VERIFY_STU_ID, VERIFY_STU_NO, '验证学生A', edu.accountId || '', edu.userName || ''],
  );
  await q(`DELETE FROM ${D.job}.t_job_fee_call WHERE student_id = ?`, [VERIFY_STU_ID]);
  await q(`DELETE FROM ${D.common}.t_class_urge_sync WHERE student_no = ?`, [VERIFY_STU_NO]);

  const dueDate = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  /**
   * ★ 2026-10-22：教务的「催费」入口已按用户要求下线（菜单/权限都收了），
   *   所以这里从「教务能发起」改成「教务被拒」—— 链路本身用其他有权限的账号验。
   */
  const fcRes = await api('POST', '/api/job/fee-call/create', {
    token: tokEdu,
    body: { feeType: 2, studentId: VERIFY_STU_ID, feeAmount: 120000, dueDate, callReason: '链路验证' },
  });
  const fcId = fcRes.json?.data?.id;
  check(
    '③a-1 教务老师已无「发起催费」权限（入口已下线）',
    fcRes.json?.code !== 200,
    `HTTP ${fcRes.status} code=${fcRes.json?.code} msg=${fcRes.json?.message}`,
  );

  if (fcId) {
    const rows = await q(
      `SELECT id, source_system, source_id, student_no, student_id, fee_type, amount, pay_status, is_deleted
         FROM ${D.common}.t_class_urge_sync WHERE source_id = ?`,
      [fcId],
    );
    const row = rows[0];
    check(
      '③a-2 班级侧催费副本已生成',
      !!row && Number(row.is_deleted) === 0 && row.source_system === 'edu',
      row ? JSON.stringify(row) : '未找到副本行',
    );
    check(
      '③a-3 学号在班级侧查不到学生时降级用学号占位（不炸、不丢）',
      !!row && !!row.student_id,
      row ? `student_no=${row.student_no} → student_id=${row.student_id}` : '',
    );

    // 班主任「催缴完成」→ 状态应更新
    const hRes = await api('POST', '/api/job/fee-call/handle', {
      token: tokEdu,
      body: { id: fcId, callStatus: 3, handleRemark: '验证：已缴清' },
    });
    const after = await q(
      `SELECT pay_status, last_urge_time FROM ${D.common}.t_class_urge_sync WHERE source_id = ?`,
      [fcId],
    );
    check(
      '③a-4 催费状态变化后副本同步更新（已缴清 → pay_status=2）',
      hRes.json?.code === 200 && after.length === 1 && Number(after[0].pay_status) === 2,
      `handle: code=${hRes.json?.code} → pay_status=${after[0]?.pay_status}`,
    );
  }

  /* ============================================================
   * 链路 ③b 教务 → 班级（点「分派宿舍 / 取消分派」）
   * ============================================================ */
  section('链路 ③b  教务 → 班级：分派宿舍 / 取消分派 → 宿舍只读副本');
  const ROOM_BUILDING = '验证楼';
  const ROOM_NO = 'V101';
  const roomRes = await api('POST', '/api/edu/dorm/room/add', {
    token: tokEdu,
    body: { category: 1, building: ROOM_BUILDING, room: ROOM_NO, capacity: 4 },
  });
  let roomId = roomRes.json?.data?.id;
  if (!roomId) {
    // 之前跑过 → 房间已存在，直接取回来复用（幂等）
    const [exist] = await q(
      `SELECT id FROM ${D.edu}.t_edu_dorm_room WHERE building = ? AND room = ? LIMIT 1`,
      [ROOM_BUILDING, ROOM_NO],
    );
    roomId = exist?.id;
  }
  check(
    '③b-0 准备一间验证宿舍',
    !!roomId,
    `code=${roomRes.json?.code} msg=${roomRes.json?.message} id=${roomId}`,
  );

  if (roomId) {
    const CLASS_NAME = 'U02';
    // 清掉历史分派，保证从干净状态开始
    await q(`DELETE FROM ${D.edu}.t_edu_dorm_assignment WHERE class_name = ?`, [CLASS_NAME]);
    await q(`UPDATE ${D.common}.t_class_dorm_room_sync SET is_deleted = 1 WHERE source_id = ?`, [roomId]);

    const asRes = await api('POST', '/api/edu/dorm/assign', {
      token: tokEdu,
      body: { className: CLASS_NAME, roomIds: [roomId] },
    });
    const rows = await q(
      `SELECT id, source_system, source_id, dorm_no, building_name, bed_count, is_deleted
         FROM ${D.common}.t_class_dorm_room_sync WHERE source_id = ?`,
      [roomId],
    );
    const row = rows[0];
    check(
      '③b-1 点「分派宿舍」→ 班级侧房间副本已生成',
      asRes.json?.code === 200 && !!row && Number(row.is_deleted) === 0,
      `${JSON.stringify(asRes.json?.data)} | row=${row ? JSON.stringify(row) : '无'}`,
    );

    const clrRes = await api('POST', '/api/edu/dorm/assign/clear', {
      token: tokEdu,
      body: { className: CLASS_NAME },
    });
    const rows2 = await q(
      `SELECT is_deleted FROM ${D.common}.t_class_dorm_room_sync WHERE source_id = ?`,
      [roomId],
    );
    check(
      '③b-2 点「清空分派」→ 班级侧房间副本被标记删除（本次新增的 removedSourceIds 逻辑）',
      clrRes.json?.code === 200 && rows2.length === 1 && Number(rows2[0].is_deleted) === 1,
      `clear: ${JSON.stringify(clrRes.json?.data)} → is_deleted=${rows2[0]?.is_deleted}`,
    );
  }

  /* ---------------- 收尾清理（不污染演示数据） ---------------- */
  if (!process.argv.includes('--keep')) {
    const { text } = await cleanup(q);
    console.log(`\n🧹 已清理本次验证数据：${text}`);
  }

  /* ---------------- 汇总 ---------------- */
  section('汇总');
  const pass = results.filter((r) => r.pass).length;
  const fail = results.length - pass;
  console.log(`共 ${results.length} 项：通过 ${pass}，失败 ${fail}`);
  if (fail) {
    console.log('\n失败明细：');
    for (const r of results.filter((x) => !x.pass)) console.log(`  · ${r.name}  → ${r.detail || ''}`);
  }

  await conn.end();
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('\n💥 脚本异常：', e?.stack || e);
  process.exit(1);
});
