/**
 * 校验「班级状态 → 宿舍分派锁」
 * ============================================================
 *
 * 需求（2026-10-22）：
 *   ① 分派给**开放**班的宿舍不能再分给其他班；
 *   ② 班级**封班**后，该班宿舍的空床位分配权交回教务 ——
 *      房间解锁、空床位重新可选，教务可以继续调配；
 *   ③ 班主任在封班后不能再往该房间填学生（前端隐藏「入住」）。
 *
 * 覆盖：
 *   静态：锁判定/解锁提示/班主任入住限制的代码都在
 *   运行时：开放 → 分派被拒；封班 → 房间解锁、空床可选；最后还原班级状态
 *
 * 用法：node tools/verify-dorm-class-lock.mjs
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const BASE = 'http://localhost:8004';
const PWD = '123456';
const CLASS = 'G2601';

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) {
    pass++;
    console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function read(rel) {
  try {
    return readFileSync(join(ROOT, rel), 'utf8');
  } catch {
    return '';
  }
}

function mysql(sql) {
  const env = read('server-job/.env');
  const pwd = /^DB_PASSWORD=(.*)$/m.exec(env)?.[1]?.trim() || '';
  return execFileSync('mysql', ['-uroot', `-p${pwd}`, '-N', '-e', sql], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

async function req(method, url, { token, body } = {}) {
  const r = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const raw = await r.text();
  let json = null;
  try {
    json = JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return { status: r.status, body: json, raw };
}

async function login(account) {
  const r = await req('POST', '/api/portal/account/login', { body: { account, password: PWD } });
  return r.body?.data?.token || '';
}

console.log('▶ 静态检查');
const helper = read('server-job/src/teaching/dorm/classStatus.ts');
const svc = read('server-job/src/teaching/dorm/allocate.service.ts');
const repo = read('server-job/src/teaching/dorm/repo.uni.ts');
const uiAlloc = read('web-job/src/teaching/views/DormAllocate.vue');
const uiDorm = read('web-job/src/teaching/views/TeachingDorm.vue');

check('有班级状态查询（跨三学段班级表）', helper.includes('loadClassStatuses') && helper.includes("sms_class_jh.t_class_info"));
check('封班 = 解锁，其它按锁定处理', helper.includes('isLockedByClassStatus') && helper.includes('CLASS_STATUS_CLOSED'));
check('房间返回 locked / 归属班状态', svc.includes('assignedStatus') && svc.includes('locked:') && svc.includes('assignedStatusName'));
check('开放班的分派被拒（保存时校验）', svc.includes('已分派给开放中的') && svc.includes('不能再分给其他班'));
check('封班房间重新给出空床位', svc.includes('freeBeds: locked ? []'));
check('入住/调宿也受锁定约束', repo.includes('roomOwner') && repo.includes('不能给其他班学生入住') && repo.includes('不能调入其他班学生'));
check('分派界面按 locked 禁选并提示', uiAlloc.includes('r.locked') && uiAlloc.includes('已封班，可调配'));
check('班主任封班后看不到「入住」', uiDorm.includes('assignedClassStatus === 2') && uiDorm.includes('分配权已交回教务'));

console.log('\n▶ 运行时检查');
const acadToken = await login('zhengym');
const sunToken = await login('sunmin');
check('教务 / 班主任登录', !!acadToken && !!sunToken);

try {
  const classes = await req('GET', '/api/teaching/dorm/allocate/classes', { token: acadToken });
  const row = (classes.body?.data || []).find((c) => c.className === CLASS);
  check('班级列表带班级状态', row?.classStatus === 1 && row?.classStatusName === '开放', row ? `${CLASS}=${row.classStatusName}` : '未找到班级');

  // ★ 班级分到的可能是男寝也可能是女寝 → 两类都查，别写死 category=1
  const roomsM = await req('GET', '/api/teaching/dorm/allocate/rooms?category=1', { token: acadToken });
  const roomsF = await req('GET', '/api/teaching/dorm/allocate/rooms?category=2', { token: acadToken });
  const allRooms = [...(roomsM.body?.data || []), ...(roomsF.body?.data || [])];
  const owned = allRooms.find((r) => r.assignedTo === CLASS);
  check('分给开放班的房间标记为 locked', !!owned && owned.locked === true, owned ? `${owned.building}${owned.room}` : '无');
  check('锁定房间不暴露空床位', !!owned && owned.freeBeds.length === 0);

  // 开放状态下，别的班来抢 → 拒绝
  if (owned) {
    const denied = await req('POST', '/api/teaching/dorm/allocate/save', {
      token: acadToken,
      body: {
        className: 'J2602',
        headTeacherName: '孙敏',
        maleRoomIds: owned.category === 1 ? [owned.roomId] : [],
        femaleRoomIds: owned.category === 2 ? [owned.roomId] : [],
      },
    });
    check('开放班的房间不能被其他班分派', denied.body?.code === 40000 && /开放中/.test(denied.body?.message || ''), denied.body?.message || '');
  }

  // 封班 → 解锁、空床重新可选
  mysql(`UPDATE sms_class_jh.t_class_info SET class_status=2 WHERE class_name='${CLASS}'`);
  const closedClasses = await req('GET', '/api/teaching/dorm/allocate/classes', { token: acadToken });
  const closedRow = (closedClasses.body?.data || []).find((c) => c.className === CLASS);
  check('封班后班级状态变封班', closedRow?.classStatus === 2, closedRow?.classStatusName || '');

  const closedRooms = await req('GET', `/api/teaching/dorm/allocate/rooms?category=${owned?.category || 1}`, { token: acadToken });
  const closedOwned = (closedRooms.body?.data || []).find((r) => r.roomId === owned?.roomId);
  check('封班后房间解锁', closedOwned?.locked === false, closedOwned?.assignedStatusName || '');
  check('封班后空床位重新可选', (closedOwned?.freeBeds || []).length > 0, `${closedOwned?.freeBeds?.length || 0} 张`);
} finally {
  // 还原班级状态，避免影响其它验证
  try {
    mysql(`UPDATE sms_class_jh.t_class_info SET class_status=1 WHERE class_name='${CLASS}'`);
  } catch {
    /* ignore */
  }
}

const dormList = await req('GET', '/api/teaching/dorm/list?stage=jh&page=1&size=20', { token: sunToken });
const ownRows = (dormList.body?.data?.list || []).filter((r) => r.assignedClassName === CLASS);
check(
  '班主任页面能拿到归属班状态',
  ownRows.length > 0 && ownRows.every((r) => r.assignedClassStatus === 1),
  ownRows.map((r) => `${r.buildingName}${r.roomNo}`).join('、') || '空',
);

console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
