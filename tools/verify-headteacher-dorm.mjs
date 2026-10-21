/**
 * 校验「班主任」权限下的宿舍管理页
 * ============================================================
 *
 * 覆盖用户反馈的两点：
 *   ① 看不到「新增房间」按钮
 *   ② 看不到「班级分派」子页签
 *
 * 静态：
 *   · TeachingDorm 顶部有两个页签（宿舍房间 / 班级分派）
 *   · 筛选栏有「新增房间」按钮，且 canCreate 在 meta 未加载时不再误判为无权限
 *
 * 运行时（初高班主任 sunmin / 大学班主任 zhanght）：
 *   · 持有 *:dorm:view；/meta 返回 hasCreate=true
 *   · /change 之外的写接口能过权限闸（空 body 返回参数错误 40000，而不是 40302）
 *   · /allocate/classes 200（班级分派页签的数据源）
 *
 * 用法：node tools/verify-headteacher-dorm.mjs
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const BASE = 'http://localhost:8004';
const PWD = '123456';
const ACCOUNTS = [
  { account: 'sunmin', label: '初高班主任', code: 'classjh:dorm:view' },
  { account: 'zhanght', label: '大学班主任', code: 'class:dorm:view' },
];

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
check('页签：宿舍房间 + 班级分派', dorm.includes('label="宿舍房间"') && dorm.includes('label="班级分派"'));
check('筛选栏有「新增房间」按钮', dorm.includes('新增房间') && dorm.includes('@click="openCreate"'));
check(
  'canCreate 不再因 meta 为空而隐藏',
  /if \(!metaList\.value\.length\) return true/.test(dorm),
);

console.log('\n▶ 运行时检查');
for (const a of ACCOUNTS) {
  const login = await req('POST', '/api/portal/account/login', { body: { account: a.account, password: PWD } });
  if (login.status !== 200 || !login.body?.data?.token) {
    check(`${a.label}(${a.account}) 登录`, false, `HTTP ${login.status}`);
    continue;
  }
  const token = login.body.data.token;
  const myPages = await req('GET', '/api/job/auth/my-pages', { token });
  const perms = myPages.body?.data?.permissions || [];
  check(`${a.label} 持有 ${a.code}`, perms.includes(a.code), perms.filter((p) => p.includes('dorm')).join(','));

  const meta = await req('GET', '/api/teaching/dorm/meta', { token });
  const metas = meta.body?.data || [];
  check(
    `${a.label} /meta 可写`,
    meta.status === 200 && metas.length > 0 && metas.every((m) => m.hasCreate),
    metas.map((m) => `${m.stage}:${m.hasCreate}`).join(','),
  );

  // 空 body 触发参数校验：返回 40000 说明已过权限闸（40302 才是没权限）
  const save = await req('POST', '/api/teaching/dorm/save', { token, body: { stage: metas[0]?.stage || 'jh' } });
  check(
    `${a.label} 写权限已放行`,
    save.body?.code === 40000,
    `code=${save.body?.code} msg=${save.body?.message}`,
  );

  const classes = await req('GET', '/api/teaching/dorm/allocate/classes', { token });
  check(`${a.label} 班级分派数据源 200`, classes.status === 200, `${(classes.body?.data || []).length} 个班`);
}

console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
