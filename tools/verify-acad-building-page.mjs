/**
 * 校验「楼栋设置」搬家后的状态（2026-10-22）
 * ============================================================
 *
 * 楼栋设置现在只在「宿舍管理」第 4 个页签里（系统设置页签与独立页都已下线）。
 *
 * 静态：
 *   ① 独立入口已彻底移除：菜单 / 路由 / 页面文件 / 后端注册 / 台账 KEEP
 *   ② 宿舍管理仍有「楼栋设置」页签，且排在「申请审批」之后
 *   ③ 班主任看不到该页签
 *
 * 运行时（教务老师 zhengym）：
 *   ① /api/teaching/building/list = 200（楼栋数据仍读得到）
 *
 * 用法：node tools/verify-acad-building-page.mjs
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
const menu = read('web-job/src/config/menu.ts');
const router = read('web-job/src/router/index.ts');
const setting = read('web-job/src/class-jh/views/SettingList.vue');
const perms = read('server-job/src/config/pagePermissions.ts');
const registry = read('server-job/src/perm/config/pageRegistry.ts');
const source = read('server-job/src/utils/pagePermissionSource.ts');
const ledger = read('server-job/scripts/perm-role-page-acad-staff.ts');

// ★ 2026-10-22：独立入口（菜单 / 路由 / 页面 / 后端注册 / 台账）应全部下线
check('菜单已无「楼栋设置」独立入口', !/title:\s*'楼栋设置'/.test(menu) && !menu.includes('classjh:building:view'));
check('路由已无 /class-jh/building', !router.includes("path: '/class-jh/building'") && !router.includes('BuildingList.vue'));
check('pagePermissions 已移除 classjh:building:view', !perms.includes("code: 'classjh:building:view'"));
check('pageRegistry 已移除 /class-jh/building', !registry.includes("path: '/class-jh/building'"));
check('CLASS_JH_ACAD_PAGES 已移除 classjh:building:view', !source.includes('classjh:building:view'));
check('R08 台账 KEEP 已移除 /class-jh/building', !ledger.includes("'/class-jh/building'"));
check('BuildingList.vue 页面文件已删除', read('web-job/src/class-jh/views/BuildingList.vue') === '');
// ★ 2026-10-22：楼栋设置已从「系统设置」下线（搬到宿舍管理），这里断言真的没了
check(
  '系统设置已移除楼栋设置页签',
  !/<el-tab-pane[^>]*label="楼栋设置"/.test(setting) && !/^import BuildingSettingPanel/m.test(setting),
);

// ★ 2026-10-22：楼栋设置搬进「宿舍管理」成为子页签（排在申请审批后面）
const teachingDorm = read('web-job/src/teaching/views/TeachingDorm.vue');
const buildingPane = /<el-tab-pane[^>]*label="楼栋设置"[^>]*name="building"/.test(teachingDorm);
const approvalIdx = teachingDorm.indexOf('label="申请审批"');
const buildingIdx = teachingDorm.indexOf('label="楼栋设置"');
check('宿舍管理含「楼栋设置」子页签', buildingPane && teachingDorm.includes('BuildingSettingPanel'));
check('楼栋设置页签排在申请审批之后', approvalIdx > 0 && buildingIdx > approvalIdx);
check('班主任看不到楼栋设置页签', /<el-tab-pane[^>]*v-if="!isOnlyHeadTeacher"[^>]*label="楼栋设置"/.test(teachingDorm));

console.log('\n▶ 运行时检查（教务老师 zhengym）');
const login = await req('POST', '/api/portal/account/login', { body: { account: ACCOUNT, password: PWD } });
if (login.status !== 200 || !login.body?.data?.token) {
  check('登录', false, `HTTP ${login.status} ${login.raw.slice(0, 120)}`);
} else {
  check('登录', true);
  const token = login.body.data.token;

  const myPages = await req('GET', '/api/job/auth/my-pages', { token });
  const list = myPages.body?.data?.permissions || myPages.body?.data?.perms || [];
  check('不再持有 classjh:building:view（页面已下线）', !list.includes('classjh:building:view'));
  check('不持有 classjh:setting:view', !list.includes('classjh:setting:view'));
  check('持有宿舍页权限 classjh:dorm:view', list.includes('classjh:dorm:view'));

  const buildings = await req('GET', '/api/teaching/building/list', { token });
  check('楼栋列表 200', buildings.status === 200, `共 ${(buildings.body?.data || []).length} 栋`);
}

console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
