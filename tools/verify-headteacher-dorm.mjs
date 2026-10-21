/**
 * 校验「班主任」权限下的宿舍管理页（2026-10-21 调整）
 * ============================================================
 *
 * 业务口径：班主任在宿舍域只做「查看本班住宿 + 发起调宿/退宿申请」，
 * **没有「新增房间」按钮，也没有「班级分派」子页签**（房间与班级分派归教务/学管）。
 *
 * 静态：
 *   · 页签「班级分派」带 `v-if="!isOnlyHeadTeacher"`
 *   · 「新增房间」按钮带 `!isOnlyHeadTeacher`
 *   · 角色判定排除 教务/校长/管理员/学管主任，且 SUPER_TEST 不受影响
 * 运行时：
 *   · 班主任仍持有 *:dorm:view、/meta 200（页面本身能进）
 *   · 班主任仍能发起调宿（/change/create 走参数校验 40000，不是 40302）
 *   · 教务老师仍持有 classjh:dorm:view 且 /meta 可写（该看的人不受影响）
 *
 * 用法：node tools/verify-headteacher-dorm.mjs
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
check('保留「宿舍房间」页签', dorm.includes('label="宿舍房间"'));
check('「班级分派」对班主任隐藏', /v-if="!isOnlyHeadTeacher"[\s\S]{0,80}label="班级分派"/.test(dorm));
check('「新增房间」对班主任隐藏', dorm.includes('canCreate && !isOnlyHeadTeacher'));
check('保持「调宿/退宿申请」入口', dorm.includes('调宿/退宿申请'));
check('班主任判定排除更高角色', dorm.includes('HEAD_TEACHER_SUPERIOR_ROLES') && dorm.includes('RoleCode.TEACH_HEAD'));
check('SUPER_TEST 不受影响', /isSuperTest\.value\) return false/.test(dorm));

console.log('\n▶ 运行时检查');
// ① 班主任：能进页面、能发起调宿，但（前端）不给建房间/班级分派
for (const a of [
  { account: 'sunmin', label: '初高班主任', code: 'classjh:dorm:view', stage: 'jh' },
  { account: 'zhanght', label: '大学班主任', code: 'class:dorm:view', stage: 'class' },
]) {
  const login = await req('POST', '/api/portal/account/login', { body: { account: a.account, password: PWD } });
  if (login.status !== 200 || !login.body?.data?.token) {
    check(`${a.label} 登录`, false, `HTTP ${login.status}`);
    continue;
  }
  const token = login.body.data.token;
  const myPages = await req('GET', '/api/job/auth/my-pages', { token });
  const perms = myPages.body?.data?.permissions || [];
  check(`${a.label} 仍可进宿舍页`, perms.includes(a.code));

  const meta = await req('GET', '/api/teaching/dorm/meta', { token });
  check(`${a.label} /meta 200`, meta.status === 200 && (meta.body?.data || []).length > 0);

  // 调宿申请：空 body 应命中「原因必填/业务类型」这类参数校验（40000），说明入口仍可用
  const change = await req('POST', '/api/teaching/dorm/change/create', { token, body: { stage: a.stage } });
  check(`${a.label} 仍可发起调宿（参数校验）`, change.body?.code === 40000, `code=${change.body?.code}`);
}

// ② 教务：两个功能都还在（不能被误伤）
const acad = await req('POST', '/api/portal/account/login', { body: { account: 'zhengym', password: PWD } });
if (acad.status === 200 && acad.body?.data?.token) {
  const token = acad.body.data.token;
  const myPages = await req('GET', '/api/job/auth/my-pages', { token });
  check('教务仍持 classjh:dorm:view', (myPages.body?.data?.permissions || []).includes('classjh:dorm:view'));
  const meta = await req('GET', '/api/teaching/dorm/meta', { token });
  check('教务 /meta 可写', meta.status === 200 && (meta.body?.data || []).every((m) => m.hasCreate));
  const classes = await req('GET', '/api/teaching/dorm/allocate/classes', { token });
  check('教务班级分派数据源 200', classes.status === 200, `${(classes.body?.data || []).length} 个班`);
} else {
  check('教务登录', false, `HTTP ${acad.status}`);
}

console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
