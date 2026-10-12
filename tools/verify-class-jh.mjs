#!/usr/bin/env node
/**
 * 教学管理（初高）并入统一门户 —— 端到端验证
 * ============================================================
 *
 * 验证 2026-10-05 把「教学管理（初高）」（原 server-class/8003）并入
 * 统一门户版（server-job/8004，接口前缀 /api/class-jh/*）之后的：
 *
 *   ① 后端活着 + 初高模块健康
 *   ② 门户账号能登录，且 modules 里正确带 / 不带 'class-jh'
 *   ③ 初高 11 个页面对应的接口，初高班主任（sunmin）全部可达、且有数据
 *   ④ 【模块隔离】大学部班主任（zhanght）拿合法 token 直连 /api/class-jh/*
 *      → 必须 403（两套班级模块共用角色码，靠模块门槛隔开）
 *   ⑤ 【只读管理员】admin 在初高模块里能被读、不能写（与 /api/job 只读总闸同口径）
 *
 * 用法：
 *   node tools/verify-class-jh.mjs
 *   （后端未启动会失败，请先 `npm run dev`）
 *
 * ⚠️ 本脚本只做读操作 + 一个"应被权限拦下"的写请求（不会真正落库），
 *    可安全重复执行。
 */

import process from 'node:process';

// 绕开沙箱/系统代理，否则本机请求会得到误导性 502
process.env.NO_PROXY = '127.0.0.1,localhost';
process.env.no_proxy = '127.0.0.1,localhost';

const BASE = process.env.SMS_BASE || 'http://127.0.0.1:8004';
const PW = '123456';

let pass = 0;
let fail = 0;
const failures = [];

function check(name, cond, detail = '') {
  if (cond) {
    pass += 1;
    console.log(`  ✅ ${name}`);
  } else {
    fail += 1;
    failures.push(name);
    console.log(`  ❌ ${name}${detail ? `  → ${detail}` : ''}`);
  }
}

async function http(method, path, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* 非 JSON */
  }
  return { status: res.status, body: json };
}

async function login(account) {
  const r = await http('POST', '/api/portal/account/login', { body: { account, password: PW } });
  return r.body?.data?.token || '';
}

/** 初高模块 11 个页面 ↔ 后端接口（用于"页面可达"验证） */
const PAGE_ENDPOINTS = [
  ['工作台', '/api/class-jh/dashboard/stat'],
  ['基础数据', '/api/class-jh/student/list'],
  ['班级管理', '/api/class-jh/classInfo/list'],
  ['出勤管理', '/api/class-jh/attendance/list'],
  ['考试管理', '/api/class-jh/exam/list'],
  ['成绩管理', '/api/class-jh/examScore/list'],
  ['宿舍管理', '/api/class-jh/dorm/room/list'],
  ['催费管理', '/api/class-jh/fee/list'],
  ['退费', '/api/class-jh/refund/list'],
  ['教职·学术审批', '/api/class-jh/flow/list'],
  ['系统设置', '/api/class-jh/setting/detail'],
];

async function main() {
  console.log('\n═══ 教学管理（初高）并入验证 ═══\n');

  /* ---------- ① 服务健康 ---------- */
  console.log('[1] 后端健康');
  const health = await http('GET', '/api/class-jh/health');
  check('GET /api/class-jh/health → 200', health.status === 200 && health.body?.code === 200,
    `status=${health.status}`);

  /* ---------- ② 登录 & 门户模块 ---------- */
  console.log('\n[2] 门户登录 & 模块授权');
  const tokens = {};
  for (const acc of ['admin', 'sunmin', 'zhanght', 'congym', 'zhengym', 'zhouj']) {
    tokens[acc] = await login(acc);
    check(`登录 ${acc}`, !!tokens[acc], '未拿到 token');
  }

  const profiles = {};
  for (const acc of ['admin', 'sunmin', 'zhanght', 'congym', 'zhengym', 'zhouj']) {
    if (!tokens[acc]) continue;
    const p = await http('GET', '/api/portal/account/profile', { token: tokens[acc] });
    profiles[acc] = (p.body?.data?.visibleModules || []).map((m) => String(m.key));
    console.log(`   · ${acc} 可见模块 → [${profiles[acc].join(', ')}]`);
  }

  check('admin 含 class-jh', (profiles.admin || []).includes('class-jh'));
  check('sunmin（初高班主任）含 class-jh', (profiles.sunmin || []).includes('class-jh'));
  check('sunmin 不含 class（大学部）', !(profiles.sunmin || []).includes('class'),
    `实际=[${(profiles.sunmin || []).join(',')}]`);
  check('zhanght（大学部班主任）不含 class-jh', !(profiles.zhanght || []).includes('class-jh'),
    `实际=[${(profiles.zhanght || []).join(',')}]`);
  check('zhanght 含 class（大学部）', (profiles.zhanght || []).includes('class'));
  check('congym（学管主任）含 class-jh', (profiles.congym || []).includes('class-jh'));
  check('zhengym（教务）含 class-jh', (profiles.zhengym || []).includes('class-jh'));
  check('zhouj（就业）不含 class-jh', !(profiles.zhouj || []).includes('class-jh'));

  /* ---------- ③ my-pages 页面码 ---------- */
  console.log('\n[3] 页面权限码（/api/job/auth/my-pages）');
  const myPages = {};
  for (const acc of ['admin', 'sunmin', 'zhanght', 'congym', 'zhengym']) {
    if (!tokens[acc]) continue;
    const r = await http('GET', '/api/job/auth/my-pages', { token: tokens[acc] });
    const pages = r.body?.data?.pages || [];
    const jh = pages.filter((p) => String(p.code).startsWith('classjh:'));
    myPages[acc] = { total: pages.length, jh: jh.length, jhPaths: jh.map((p) => p.path) };
    console.log(`   · ${acc} → 共 ${pages.length} 页，其中初高 ${jh.length} 页`);
  }
  check('admin 初高页 = 11', myPages.admin?.jh === 11, `实际 ${myPages.admin?.jh}`);
  check('sunmin（初高班主任）初高页 = 10（无系统设置）', myPages.sunmin?.jh === 10, `实际 ${myPages.sunmin?.jh}`);
  check('sunmin 初高页不含 /class-jh/setting', !(myPages.sunmin?.jhPaths || []).includes('/class-jh/setting'));
  check('congym（学管主任）初高页 = 11', myPages.congym?.jh === 11, `实际 ${myPages.congym?.jh}`);
  check('zhengym（教务）初高页 = 3', myPages.zhengym?.jh === 3, `实际 ${myPages.zhengym?.jh}`);
  // ★ 关键：zhanght 的角色（TEACH_HEAD）**也**给了初高页 —— 但模块没有，前端会隐藏、后端会拦
  check('zhanght 角色虽给初高页（10），但模块被隔离', myPages.zhanght?.jh === 10,
    `实际 ${myPages.zhanght?.jh}`);

  /* ---------- ④ 初高接口可达（sunmin） ---------- */
  console.log('\n[4] 初高 11 页接口可达（sunmin）');
  for (const [name, path] of PAGE_ENDPOINTS) {
    const r = await http('GET', path, { token: tokens.sunmin });
    const okCode = r.body?.code === 200;
    check(`${name.padEnd(10, '　')} ${path}`, r.status === 200 && okCode,
      `status=${r.status} code=${r.body?.code}`);
  }

  /* ---------- ⑤ 模块隔离（后端硬拦） ---------- */
  console.log('\n[5] 模块隔离：大学部账号直连初高接口必须 403');
  for (const acc of ['zhanght', 'zhouj']) {
    const r = await http('GET', '/api/class-jh/student/list', { token: tokens[acc] });
    check(`${acc} GET /api/class-jh/student/list → 403`,
      r.status === 403 && r.body?.code === 40302,
      `status=${r.status} code=${r.body?.code}`);
  }
  // 反向对照：sunmin 拿同一个接口是 200
  const ctl = await http('GET', '/api/class-jh/student/list', { token: tokens.sunmin });
  check('sunmin GET 同一接口 → 200（对照组）', ctl.status === 200 && ctl.body?.code === 200,
    `status=${ctl.status}`);

  /* ---------- ⑥ 只读管理员 ---------- */
  console.log('\n[6] 只读管理员（admin 能读不能写）');
  const adminRead = await http('GET', '/api/class-jh/student/list', { token: tokens.admin });
  check('admin GET student/list → 200（可读）', adminRead.status === 200 && adminRead.body?.code === 200,
    `status=${adminRead.status}`);
  const adminWrite = await http('POST', '/api/class-jh/student/add', { token: tokens.admin, body: {} });
  check('admin POST student/add → 403（只读，被拦）',
    adminWrite.status === 403 && adminWrite.body?.code === 40302,
    `status=${adminWrite.status} code=${adminWrite.body?.code}`);
  const sunminWrite = await http('POST', '/api/class-jh/student/add', { token: tokens.sunmin, body: {} });
  check('sunmin POST student/add → 非 403（有写权限，仅参数校验失败）',
    sunminWrite.status !== 403 && sunminWrite.status !== 401,
    `status=${sunminWrite.status} code=${sunminWrite.body?.code}`);

  /* ---------- ⑦ 演示数据 ---------- */
  console.log('\n[7] 演示数据（sms_class_jh 已播种）');
  const stu = await http('GET', '/api/class-jh/student/list', { token: tokens.sunmin });
  const stuTotal = stu.body?.data?.total ?? (Array.isArray(stu.body?.data) ? stu.body.data.length : 0);
  check('学生列表有数据（>0）', Number(stuTotal) > 0, `total=${stuTotal}`);
  const cls = await http('GET', '/api/class-jh/classInfo/list', { token: tokens.sunmin });
  const clsTotal = cls.body?.data?.total ?? (Array.isArray(cls.body?.data) ? cls.body.data.length : 0);
  check('班级列表有数据（>0）', Number(clsTotal) > 0, `total=${clsTotal}`);

  /* ---------- 汇总 ---------- */
  console.log('\n══════════════════════════════');
  console.log(`  通过 ${pass} 项，失败 ${fail} 项`);
  if (fail) {
    console.log('  失败项：');
    for (const f of failures) console.log(`   · ${f}`);
  }
  console.log('══════════════════════════════\n');
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('\n❌ 验证脚本异常：', e.message);
  console.error('   请确认后端已启动（8004）且已执行 npm run seed:class-jh / seed:portal');
  process.exit(1);
});
