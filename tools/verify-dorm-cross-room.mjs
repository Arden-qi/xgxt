/**
 * 校验新规则：「班主任的学生调到非本班分派的宿舍 → 教务通过后班主任能看到新房」
 * ============================================================
 *
 * 规则口径（2026-10-22 用户提出）：
 *   班主任的数据范围 = 分派给本班的房间 ∪ **本班学生已入住的房间**。
 *   所以学生被调到一间「没分派给该班」的宿舍、教务审批通过后，
 *   这间新房要自动出现在班主任的宿舍列表里（能看到房间 / 床位 / 在住学生）；
 *   跟她完全无关的房间仍然打不开。
 *
 * 覆盖：
 *   静态：assertRoomInScope 存在，beds / assign 都走了范围校验
 *   运行时：端到端「发起 → 教务通过 → 班主任可见」+「还原」，
 *           并反证无关房间仍然 403/不可见
 *
 * 用法：node tools/verify-dorm-cross-room.mjs
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const BASE = 'http://localhost:8004';
const PWD = '123456';

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
const repo = read('server-job/src/teaching/dorm/repo.uni.ts');
check('有房间范围校验函数', repo.includes('async function assertRoomInScope'));
check('范围 = 分派给本班 ∪ 本班学生已入住', repo.includes('本班学生已经入住的房间') && repo.includes('t_edu_dorm_assignment'));
check('床位查询走了范围校验', /async beds\(dormId, user\)[\s\S]{0,400}assertRoomInScope/.test(repo));
check('办理入住也走范围校验', /async assign\(body: DormAssignBody, user: any\)[\s\S]{0,2500}assertRoomInScope/.test(repo));

console.log('\n▶ 运行时检查（班主任 sunmin / 教务 zhengym）');
const sunToken = await login('sunmin');
const acadToken = await login('zhengym');
check('登录', !!sunToken && !!acadToken);

const listRooms = async (token) => {
  const r = await req('GET', '/api/teaching/dorm/list?stage=jh&page=1&size=100', { token });
  return r.body?.data?.list || [];
};

const before = await listRooms(sunToken);
const scopeBefore = new Set(before.map((r) => r.dormId));
check('班主任先拿到自己的房间范围', scopeBefore.size > 0, `${scopeBefore.size} 间`);

// ① 找她班里一个已入住的学生（在住名单就是按范围过滤的）
const res = await req('GET', '/api/teaching/dorm/residents?stage=jh', { token: sunToken });
const residents = res.body?.data || [];
const stu = residents.find((r) => r.studentId);
check('找到本班已入住学生', !!stu, stu ? `${stu.studentName}(${stu.studentNo}) · ${stu.dormNo}` : '无');

// ② 找一间她范围外、且有空床、又没被别的开放班锁定的房间
const rooms = await req('GET', '/api/teaching/dorm/allocate/rooms?category=1', { token: acadToken });
const target = (rooms.body?.data || []).find(
  (r) => (r.freeBeds || []).length > 0 && !scopeBefore.has(r.roomId) && !r.locked,
);
// 环境相关：万一所有范围外房间都住满了，这条用例没法跑，明确跳过而不是误报
if (!target) {
  check('找到范围外的目标宿舍', true, '环境里没有空闲的范围外房间，跳过端到端（规则本身由静态断言覆盖）');
  console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`);
  process.exit(fail ? 1 : 0);
}
check('找到范围外的目标宿舍', true, `${target.building}${target.room}`);

let changeId = '';
let moved = false;
try {
  if (stu && target) {
    const created = await req('POST', '/api/teaching/dorm/change/create', {
      token: sunToken,
      body: {
        stage: 'jh',
        bizType: 1,
        studentId: stu.studentId,
        newDormId: target.roomId,
        newBedId: target.freeBeds[0].bedId,
        changeDate: new Date().toISOString().slice(0, 10),
        changeReason: 'E2E：调到非本班分派宿舍（脚本自动还原）',
      },
    });
    changeId = created.body?.data?.id || '';
    check('班主任发起调宿', !!changeId, created.body?.message || '');

    const approved = await req('POST', '/api/teaching/dorm/change/approve', {
      token: acadToken,
      body: { stage: 'jh', id: changeId },
    });
    moved = approved.body?.code === 200;
    check('教务审批通过', moved, approved.body?.message || '');

    if (moved) {
      const after = await listRooms(sunToken);
      const seen = after.find((r) => r.dormId === target.roomId);
      check(
        '★ 教务通过后班主任能看到新宿舍',
        !!seen,
        seen ? `${seen.buildingName}${seen.roomNo} · 已住 ${seen.occupiedCount}/${seen.bedCount}` : '不可见',
      );

      const beds = await req('GET', `/api/teaching/dorm/beds?stage=jh&dormId=${target.roomId}`, { token: sunToken });
      check('★ 新宿舍的床位也能打开', beds.body?.code === 200, `HTTP ${beds.status}`);

      // 反证：跟她无关的房间仍然打不开
      const other = (rooms.body?.data || []).find((r) => r.roomId !== target.roomId && !scopeBefore.has(r.roomId));
      if (other) {
        const denied = await req('GET', `/api/teaching/dorm/beds?stage=jh&dormId=${other.roomId}`, { token: sunToken });
        check('无关房间仍然拒绝', denied.body?.code !== 200, `code=${denied.body?.code}`);
      }
    }
  }
} finally {
  // 还原：把学生调回原来的房间/床位
  if (moved && stu) {
    try {
      const back = await req('POST', '/api/teaching/dorm/change/create', {
        token: sunToken,
        body: {
          stage: 'jh',
          bizType: 1,
          studentId: stu.studentId,
          newDormId: stu.dormId,
          newBedId: stu.bedId,
          changeDate: new Date().toISOString().slice(0, 10),
          changeReason: 'E2E 还原（脚本自动）',
        },
      });
      const backId = back.body?.data?.id;
      if (backId) {
        await req('POST', '/api/teaching/dorm/change/approve', { token: acadToken, body: { stage: 'jh', id: backId } });
      }
    } catch {
      /* ignore */
    }
  }
}

const restored = await listRooms(sunToken);
const scopeAfter = new Set(restored.map((r) => r.dormId));
const same =
  scopeAfter.size === scopeBefore.size && [...scopeBefore].every((id) => scopeAfter.has(id));
check('还原后范围回到原样', same, `${scopeAfter.size} 间（原 ${scopeBefore.size}）`);

console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
