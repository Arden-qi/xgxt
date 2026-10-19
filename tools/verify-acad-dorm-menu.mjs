/**
 * 教务老师「宿舍管理」入口校验
 * ============================================================
 *
 * 【背景】3dfb416 给 R08（ACAD_STAFF）写角色页面台账时，只保留了
 *   /edu/student 与 /edu/dorm，其余 54 页全部 enabled=0。
 *   而 `applyLedgerToCodes()` 会把「置 0 页面」对应的权限码一起摘掉，
 *   于是教务手上的 classjh:dorm:view / class:dorm:view / job:dorm:view 全没了。
 *
 *   但合并域菜单「宿舍管理」（/teaching/dorm）的显隐只认这三个码
 *   （STAGE_ACCESS.dorm 里根本没有 edu 学段），
 *   → 教务老师的宿舍入口**静默消失**：不报错、权限码 edu:dorm:view 还在，就是不显示。
 *
 * 【本次修法】在 config/menu.ts 补一个独立入口「教务宿舍」（/edu/dorm），
 *   走 hasPage + pageEnabled 的通用判定，只认 edu:dorm:view。
 *
 * 【本脚本验证四件事】
 *   ① 静态：菜单项 / 路由 / 页面注册表 / 后端挂载 四处齐全且 pageCode 一致
 *   ② 运行时：教务老师登录后确实拿到 edu:dorm:view（且确实没有三学段 dorm 码）
 *   ③ 运行时：教务老师调 /api/edu/dorm/* 真闸放行（不是"菜单有、接口 403"）
 *   ④ 反证：教务老师调 /api/teaching/dorm/* 应被拒（证明两套宿舍确实是分开的）
 *
 * 用法（项目根目录执行，后端需在 8004 监听）：
 *   node tools/verify-acad-dorm-menu.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const BASE = 'http://localhost:8004';
const DEMO_PWD = '123456';
const ACAD_ACCOUNT = 'zhengym'; // 教务老师（教务部，模块 edu + class-jh）

let failed = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? '  ✅' : '  ❌'} ${name}${detail ? '  → ' + detail : ''}`);
  if (!ok) failed += 1;
}

async function req(method, url, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(BASE + url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  let j = null;
  const t = await r.text();
  try {
    j = JSON.parse(t);
  } catch {
    /* ignore */
  }
  return { status: r.status, body: j, raw: t };
}

/* ============================================================
 * ① 静态校验
 * ============================================================ */
console.log('=== ① 静态：四处配置是否齐全 ===');

const menuSrc = read('web-job/src/config/menu.ts');
const menuHit = menuSrc.match(
  /\{\s*title:\s*'教务宿舍'[\s\S]{0,400}?path:\s*'\/edu\/dorm'[\s\S]{0,200}?pageCode:\s*'edu:dorm:view'/,
);
check('config/menu.ts 有「教务宿舍」入口（path=/edu/dorm, pageCode=edu:dorm:view）', !!menuHit);

const routerSrc = read('web-job/src/router/index.ts');
const routeHit = routerSrc.match(
  /path:\s*'\/edu\/dorm'[\s\S]{0,200}?pageCode:\s*'edu:dorm:view'/,
);
check('router/index.ts 注册了 /edu/dorm 且 meta.pageCode 一致', !!routeHit);

const regSrc = read('server-job/src/perm/config/pageRegistry.ts');
const regHit = regSrc.match(/path:\s*'\/edu\/dorm'[\s\S]{0,120}?pageCode:\s*'edu:dorm:view'/);
check('pageRegistry 登记了 edu:/edu/dorm（台账层能按 path 反查到码）', !!regHit);

const appSrc = read('server-job/src/app.ts');
const mountHit = appSrc.match(
  /app\.use\(\s*'\/api\/edu\/dorm'[\s\S]{0,200}?requirePage\('edu:dorm:view'\)/,
);
check("app.ts 挂载 /api/edu/dorm 并挂 requirePage('edu:dorm:view')", !!mountHit);

// 反证用的口径：合并宿舍页不认 edu 码
const teachHit = appSrc.match(
  /app\.use\(\s*'\/api\/teaching\/dorm'[\s\S]{0,400}?requireAnyPage\(\[([^\]]+)\]\)/,
);
const teachCodes = teachHit ? teachHit[1] : '';
check(
  '/api/teaching/dorm 的权限码不含 edu:dorm:view（证明教务宿舍必须单开入口）',
  !!teachCodes && /classjh:dorm:view/.test(teachCodes) && !/edu:dorm:view/.test(teachCodes),
  teachCodes.replace(/\s+/g, ' '),
);

/* ============================================================
 * ②~④ 运行时校验
 * ============================================================ */
console.log('\n=== ② 运行时：教务老师登录后的权限码 ===');
const login = await req('POST', '/api/portal/account/login', {
  body: { account: ACAD_ACCOUNT, password: DEMO_PWD },
});
if (login.status !== 200 || !login.body?.data?.token) {
  check(`登录 ${ACAD_ACCOUNT}`, false, `HTTP ${login.status} ${login.raw.slice(0, 120)}`);
  console.log('\n后端未就绪或账号不可用，运行时校验跳过。');
  process.exit(failed ? 1 : 0);
}
const token = login.body.data.token;
check(
  `登录 ${ACAD_ACCOUNT}（教务老师）`,
  true,
  `modules=${JSON.stringify(login.body.data.modules || login.body.data.visibleModules?.map((m) => m.key))}`,
);

const myPages = await req('GET', '/api/job/auth/my-pages', { token });
const perms = myPages.body?.data?.permissions || [];
const paths = (myPages.body?.data?.pages || []).map((p) => p.path);
check('拿到 edu:dorm:view', perms.includes('edu:dorm:view'));
check('my-pages 下发 /edu/dorm 页面', paths.includes('/edu/dorm'), `共 ${paths.length} 页`);
const hasStageCodes = ['classjh:dorm:view', 'class:dorm:view', 'job:dorm:view'].filter((c) =>
  perms.includes(c),
);
check(
  '三学段 dorm 码已被台账摘除（= 合并域入口对他不可见，故必须单开入口）',
  hasStageCodes.length === 0,
  hasStageCodes.length ? `仍持有 ${hasStageCodes.join(',')}` : '三个码都没有',
);

console.log('\n=== ③ 运行时：教务宿舍接口真闸放行 ===');
// 这组接口就是「教务宿舍」页（views/edu/DormList.vue）打开时实际会调的：
//   宿舍总名单 / 分派宿舍 / 申请审批 三个 Tab 各取一个。
// ⚠️ edu 侧的成功码是 200（不是 0），两种都算通过。
for (const u of ['/api/edu/dorm/list', '/api/edu/dorm/assign/list', '/api/edu/dorm/approval-stats']) {
  const r = await req('GET', u, { token });
  const code = r.body?.code;
  check(`GET ${u}`, r.status === 200 && (code === 0 || code === 200), `HTTP ${r.status} code=${code ?? '-'}`);
}

console.log('\n=== ④ 反证：合并宿舍页对教务应拒绝（两套宿舍确实分开）===');
const teach = await req('GET', '/api/teaching/dorm/rooms', { token });
check(
  'GET /api/teaching/dorm/rooms 被拒（403）',
  teach.status === 403 || (teach.body?.code ?? 0) !== 0,
  `HTTP ${teach.status} code=${teach.body?.code ?? '-'}`,
);

console.log(`\n${failed === 0 ? '✅ 全部通过' : `❌ ${failed} 项未通过`}`);
process.exit(failed ? 1 : 0);
