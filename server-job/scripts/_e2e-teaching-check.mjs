/**
 * 第 1 期「入口合并」端到端冒烟检查（启动 → 等待 → 测试 → 关闭，一次跑完）
 *
 * 为什么写成一体脚本：沙箱里后台进程活不过一轮对话，必须一条命令内完成。
 *
 * 检查项：
 *   A. 后端 8004 /health 200
 *   B. 门户登录接口 200（走前端 Vite 代理 → 验证代理链路）
 *   C. 前端 5173 / 200
 *   D. ★ 新增的合并入口模块能被 Vite 正常转译：
 *        /src/teaching/domainConfig.ts
 *        /src/teaching/access.ts
 *        /src/teaching/routes.ts
 *        /src/teaching/TeachingDomain.vue
 *        /src/config/menu.ts
 *        /src/App.vue
 *      （dev 模式下 Vite 按需转译单文件，400/500 = 语法或 import 有毛病）
 */

import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';

const ROOT = 'D:/学管/新/良志学管-三块合并-第1期';
const NODE = process.execPath;

const procs = [];
function launch(cwd, args, tag) {
  const p = spawn(NODE, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let err = '';
  p.stdout.on('data', () => {});
  p.stderr.on('data', (c) => { err += c.toString(); });
  p.on('error', (e) => { err += 'SPAWN ERROR: ' + e.message; });
  procs.push({ p, tag, err: () => err });
  return p;
}

function req(url, { method = 'GET', body = null, timeout = 8000 } = {}) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(url); } catch { return resolve({ status: 0, body: 'BAD URL', ms: 0 }); }
    const t0 = Date.now();
    const r = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method,
        headers: body ? { 'Content-Type': 'application/json' } : {} },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => resolve({ status: res.statusCode, body: d, ms: Date.now() - t0 }));
      },
    );
    r.on('error', (e) => resolve({ status: 0, body: 'ERR ' + e.message, ms: Date.now() - t0 }));
    r.setTimeout(timeout, () => r.destroy());
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

async function waitFor(label, url, ms = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const r = await req(url, { timeout: 3000 });
    if (r.status >= 200 && r.status < 400) return { ok: true, waited: Date.now() - t0 };
    await new Promise((s) => setTimeout(s, 1500));
  }
  return { ok: false, waited: Date.now() - t0 };
}

function killAll() {
  for (const { p } of procs) {
    if (!p.pid) continue;
    try { spawnSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
  }
}

const out = [];
const log = (s) => { out.push(s); console.log(s); };

(async () => {
  try {
    log('== 启动后端 8004 ==');
    launch(`${ROOT}/server-job`, ['node_modules/tsx/dist/cli.mjs', 'src/app.ts'], 'backend');
    const be = await waitFor('backend', 'http://127.0.0.1:8004/health');
    const h = await req('http://127.0.0.1:8004/health');
    log(`A. 后端 /health          → ${h.status} ${be.ok ? '(就绪 ' + be.waited + 'ms)' : '(未就绪!)'} ${h.body.slice(0, 80)}`);

    log('== 启动前端 5173 ==');
    launch(`${ROOT}/web-job`, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'], 'frontend');
    const fe = await waitFor('frontend', 'http://127.0.0.1:5173/');
    log(`C. 前端 /                → ${fe.ok ? 200 : 0} ${fe.ok ? '(就绪 ' + fe.waited + 'ms)' : '(未就绪!)'}`);

    const login = await req('http://127.0.0.1:5173/api/portal/account/login', {
      method: 'POST',
      body: { account: 'admin', password: '123456' },
    });
    let who = '';
    try { who = JSON.parse(login.body)?.data?.user?.userName || JSON.parse(login.body)?.message || ''; } catch {}
    log(`B. 登录(经 vite 代理)    → ${login.status} ${String(who).slice(0, 40)}`);

    log('== D. 新模块能否被 Vite 正常转译 ==');
    const files = [
      '/src/teaching/domainConfig.ts',
      '/src/teaching/access.ts',
      '/src/teaching/routes.ts',
      '/src/teaching/TeachingDomain.vue',
      '/src/config/menu.ts',
      '/src/App.vue',
      '/src/router/index.ts',
    ];
    for (const f of files) {
      const r = await req('http://127.0.0.1:5173' + f);
      log(`   ${String(r.status).padEnd(4)} ${f}  (${r.body.length} bytes)`);
    }
  } catch (e) {
    log('EXCEPTION: ' + (e && e.stack ? e.stack : e));
  } finally {
    log('== 关闭进程 ==');
    killAll();
    for (const { tag, err } of procs) {
      const e = err();
      if (e) log(`--- ${tag} stderr(尾 400) ---\n${e.slice(-400)}`);
    }
    log('DONE');
  }
  process.exit(0);
})();
