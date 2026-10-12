// 后端冒烟脚本：门户登录 + 鉴权链路 + 权限解析（统一门户版合并后端）
// 用法（在【项目根目录】执行）：node tools/smoke-backend.mjs
// 前提：后端已起来（一键启动.bat 或 cd server-job && npm run dev），监听 8004
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

// 本脚本放在 tools/，而 JWT_SECRET 与 jsonwebtoken 依赖都在 server-job/，
// 所以显式去 server-job 里取，保证「在项目根目录直接 node tools/... 就能跑」。
const serverJob = path.join(root, 'server-job');
const envTxt = fs.readFileSync(path.join(serverJob, '.env'), 'utf8');
const jwt = createRequire(path.join(serverJob, 'package.json'))('jsonwebtoken');
const getEnv = (k) => {
  const m = envTxt.match(new RegExp('^' + k + '=(.*)$', 'm'));
  return m ? m[1].trim() : '';
};
const secret = getEnv('JWT_SECRET') || 'sms-dev-secret-change-me';
const base = 'http://localhost:8004';
const DEMO_PWD = '123456';

async function req(method, url, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(base + url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  let j = null;
  const t = await r.text();
  try { j = JSON.parse(t); } catch { /* ignore */ }
  return { status: r.status, body: j, raw: t };
}

const brief = (b) => {
  if (!b) return '(non-json)';
  const d = b.data;
  const extra = d && typeof d === 'object'
    ? ' data=' + JSON.stringify({
        account: d.account,
        userName: d.userName,
        kind: d.kind,
        modules: d.modules,
        visibleModules: Array.isArray(d.visibleModules) ? d.visibleModules.map((m) => m.key) : undefined,
        roles: d.roles,
        hasToken: !!d.token,
      })
    : '';
  return `code=${b.code} msg=${b.message}${extra}`;
};

console.log('=== 1) 未带 token 访问门户 profile（DEV_MODE 关闭后应为 401）===');
let r = await req('GET', '/api/portal/account/profile');
console.log(`HTTP ${r.status} ${brief(r.body)}`);

console.log('\n=== 2) 真实登录 admin（系统管理员）===');
r = await req('POST', '/api/portal/account/login', { body: { account: 'admin', password: DEMO_PWD } });
console.log(`HTTP ${r.status} ${brief(r.body)}`);
const adminToken = r.body?.data?.token;

console.log('\n=== 3) 真实登录 zhangls（市场咨询 · 模块负责人）===');
r = await req('POST', '/api/portal/account/login', { body: { account: 'zhangls', password: DEMO_PWD } });
console.log(`HTTP ${r.status} ${brief(r.body)}`);
const consultToken = r.body?.data?.token;

console.log('\n=== 4) 真实登录 linx（权限管理）===');
r = await req('POST', '/api/portal/account/login', { body: { account: 'linx', password: DEMO_PWD } });
console.log(`HTTP ${r.status} ${brief(r.body)}`);
const permToken = r.body?.data?.token;

console.log('\n=== 5) 错误密码（应 401/失败）===');
r = await req('POST', '/api/portal/account/login', { body: { account: 'admin', password: 'wrong-pass' } });
console.log(`HTTP ${r.status} ${brief(r.body)}`);

console.log('\n=== 6) 伪造/错误 secret 的 token（应 401）===');
const forged = jwt.sign({ kind: 'sys_admin', account: 'admin' }, 'wrong-secret');
r = await req('GET', '/api/portal/account/profile', { token: forged });
console.log(`HTTP ${r.status} ${brief(r.body)}`);

console.log('\n=== 7) admin token → 门户 profile（应 200，可见 3 个模块）===');
r = await req('GET', '/api/portal/account/profile', { token: adminToken });
console.log(`HTTP ${r.status} ${brief(r.body)}`);

console.log('\n=== 8) zhangls token → 门户 profile（应 200，可见 consult）===');
r = await req('GET', '/api/portal/account/profile', { token: consultToken });
console.log(`HTTP ${r.status} ${brief(r.body)}`);

console.log('\n=== 9) zhangls token → 咨询业务接口 /api/consult/account/profile（应 200）===');
r = await req('GET', '/api/consult/account/profile', { token: consultToken });
console.log(`HTTP ${r.status} ${brief(r.body)}`);

console.log('\n=== 10) admin token → 就业页面权限 /api/job/auth/my-pages（应 200）===');
r = await req('GET', '/api/job/auth/my-pages', { token: adminToken });
console.log(`HTTP ${r.status} code=${r.body?.code} pages=${r.body?.data?.pages?.length} roles=${JSON.stringify(r.body?.data?.roles)}`);

console.log('\n=== 11) linx token → 权限模块总览 /api/perm/overview/get（应 200）===');
r = await req('GET', '/api/perm/overview/get', { token: permToken });
console.log(`HTTP ${r.status} code=${r.body?.code} msg=${r.body?.message}`);

console.log('\n=== 12) 无 token 访问就业接口（应 401）===');
r = await req('GET', '/api/job/auth/my-pages');
console.log(`HTTP ${r.status} code=${r.body?.code} msg=${r.body?.message}`);
