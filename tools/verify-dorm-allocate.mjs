/**
 * 校验「宿舍管理 → 班级分派」子页面
 * ============================================================
 *
 * 静态：菜单/页面里确实挂了子页签与接口封装。
 * 运行时（教务老师 zhengym）：
 *   ① GET /api/teaching/dorm/allocate/classes  → 200，且每行含
 *      班级/班主任/男女生人数/状态/所分宿舍 六个字段
 *   ② GET /api/teaching/dorm/allocate/buildings?category=1 → 有男寝楼栋
 *   ③ GET /api/teaching/dorm/allocate/rooms?category=1&building=... → 含 capacity/occupied/remaining
 *   ④ 保存 G2601 现有分派（幂等）→ 200，回读状态仍为「已分派」
 *   ⑤ 旧入口 /api/edu/dorm/assign/list 对教务老师 403（说明只能走新接口）
 *
 * 用法：node tools/verify-dorm-allocate.mjs
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const BASE = 'http://localhost:8004';
const ACCOUNT = 'zhengym';
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
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
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

console.log('▶ 静态检查');
const dorm = read('web-job/src/teaching/views/TeachingDorm.vue');
const page = read('web-job/src/teaching/views/DormAllocate.vue');
const api = read('web-job/src/teaching/api/dormAllocate.ts');
const route = read('server-job/src/teaching/dorm/allocate.route.ts');
const app = read('server-job/src/app.ts');

check('TeachingDorm 挂了「班级分派」页签', /班级分派/.test(dorm) && /DormAllocate/.test(dorm));
check('DormAllocate 列表有六个必需列', ['班级', '班主任', '男生人数', '女生人数', '状态', '所分宿舍'].every((h) => page.includes(h)));
check('DormAllocate 左右两栏（男寝 / 女寝）', page.includes('男寝') && page.includes('女寝') && page.includes("loadRooms('male')") && page.includes("loadRooms('female')"));
check('前端接口封装指向 allocate/*', api.includes('/api/teaching/dorm/allocate/classes') && api.includes('/save'));
check('后端路由有 classes/buildings/rooms/save', ['/classes', '/buildings', '/rooms', '/save'].every((p) => route.includes(`'${p}'`)));
check('app.ts 在 /api/teaching/dorm 之前挂载 allocate', app.indexOf("'/api/teaching/dorm/allocate'") > -1 && app.indexOf("'/api/teaching/dorm/allocate'") < app.indexOf("'/api/teaching/dorm'"));

console.log('\n▶ 运行时检查（教务老师 zhengym）');
const login = await req('POST', '/api/portal/account/login', { body: { account: ACCOUNT, password: PWD } });
if (login.status !== 200 || !login.body?.data?.token) {
  check('登录', false, `HTTP ${login.status} ${login.raw.slice(0, 120)}`);
} else {
  check('登录', true);
  const token = login.body.data.token;

  const classes = await req('GET', '/api/teaching/dorm/allocate/classes', { token });
  const rows = classes.body?.data || [];
  check('班级列表 200', classes.status === 200, `共 ${rows.length} 个班`);
  const sample = rows[0] || {};
  check(
    '班级行字段齐全',
    rows.length > 0 &&
      'className' in sample &&
      'headTeacherName' in sample &&
      'maleCount' in sample &&
      'femaleCount' in sample &&
      'status' in sample &&
      'maleRooms' in sample &&
      'femaleRooms' in sample,
    JSON.stringify(sample).slice(0, 120),
  );

  const buildings = await req('GET', '/api/teaching/dorm/allocate/buildings?category=1', { token });
  const bList = buildings.body?.data || [];
  check('男寝楼栋非空', buildings.status === 200 && bList.length > 0, bList.join(','));

  const firstBuilding = bList[0] || 'A-1';
  const rooms = await req(
    'GET',
    `/api/teaching/dorm/allocate/rooms?category=1&building=${encodeURIComponent(firstBuilding)}`,
    { token },
  );
  const rList = rooms.body?.data || [];
  check(
    '宿舍列表含剩余床位',
    rooms.status === 200 &&
      rList.length > 0 &&
      typeof rList[0].capacity === 'number' &&
      typeof rList[0].occupied === 'number' &&
      typeof rList[0].remaining === 'number',
    rList.length ? `${rList[0].building} ${rList[0].room} 余 ${rList[0].remaining}` : '空',
  );

  // 幂等保存：挑一个已分派的班，把现有宿舍原样保存一遍
  const assigned = rows.find((r) => r.status === '已分派' && (r.maleRooms.length || r.femaleRooms.length));
  if (assigned) {
    const save = await req('POST', '/api/teaching/dorm/allocate/save', {
      token,
      body: {
        className: assigned.className,
        headTeacherName: assigned.headTeacherName,
        maleRoomIds: assigned.maleRooms.map((r) => r.roomId),
        femaleRoomIds: assigned.femaleRooms.map((r) => r.roomId),
      },
    });
    check('保存分派 200', save.status === 200 && save.body?.code === 200, save.body?.message || save.raw.slice(0, 80));

    const after = await req('GET', '/api/teaching/dorm/allocate/classes', { token });
    const row = (after.body?.data || []).find((r) => r.className === assigned.className);
    check('回读仍为已分派', !!row && row.status === '已分派', row ? `${row.className} ${row.status}` : '未找到班级');
  } else {
    check('保存分派 200', false, '没有可用于幂等保存的已分派班级（先手工分派一个班再跑本脚本）');
  }

  const oldApi = await req('GET', '/api/edu/dorm/assign/list', { token });
  check('旧入口 /api/edu/dorm/assign/list 对教务 403', oldApi.status === 403, `HTTP ${oldApi.status}`);
}

console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
