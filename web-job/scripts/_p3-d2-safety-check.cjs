/**
 * 阶段 D2 下线前安全检查（★ 删之前必须全绿）
 * ⚠️ 只读脚本。
 *
 * 四道检查：
 *   ① 要删的路由，组件确实存在（别照着清单删空气）
 *   ② ★保留的页面里没有 import 要删的组件（否则删完保留页面白屏）
 *   ③ 统一页里没有 import 要删的组件（阶段 A 应该已经清干净了）
 *   ④ 八个域在 domainConfig 里都已有 unified（有统一页才敢删旧的）
 */
const fs = require('fs');
const path = require('path');

const WEB = path.resolve(__dirname, '..');
const { ROUTES_TO_REMOVE, KEEP } = require(path.join(WEB, 'src/teaching/p3-d2-todo.cjs'));

function walk(dir, out = []) {
  let ents = [];
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

let problems = 0;
const bad = (m) => {
  console.log('  ❌ ' + m);
  problems += 1;
};
const good = (m) => console.log('  ✅ ' + m);

console.log('=== D2 下线前安全检查 ===');

/* ---------- ① 要删的组件确实存在 ---------- */
console.log('');
console.log('--- ① 要删的组件文件是否存在 ---');
const missingFiles = [];
for (const r of ROUTES_TO_REMOVE) {
  const p = path.join(WEB, 'src', r.comp.replace('@/', ''));
  if (!fs.existsSync(p)) missingFiles.push(r.comp);
}
if (missingFiles.length) {
  bad('清单里有 ' + missingFiles.length + ' 个组件文件不存在：\n     ' + missingFiles.join('\n     '));
} else {
  good(`${ROUTES_TO_REMOVE.length} 个组件文件全部存在`);
}

/* ---------- ② ★ 保留页面不能引用要删的组件 ---------- */
console.log('');
console.log('--- ② ★保留页面是否引用了要删的组件（删了会白屏）---');
const keepFiles = [];
for (const k of KEEP) {
  // 按 path 反查组件：从 router 里找该 path 对应的 component
  const router = fs.readFileSync(path.join(WEB, 'src/router/index.ts'), 'utf8');
  const idx = router.indexOf(`path: '${k.path}'`);
  if (idx < 0) {
    console.log(`     (router 里没找到 ${k.path}，跳过)`);
    continue;
  }
  const seg = router.slice(idx, idx + 300);
  const m = seg.match(/import\('([^']+)'\)/);
  if (m) keepFiles.push({ path: k.path, comp: m[1], why: k.why });
}
console.log(`     需保护的保留页面 ${keepFiles.length} 个`);

const delCompSet = new Set(ROUTES_TO_REMOVE.map((r) => r.comp));
const violations = [];
for (const kf of keepFiles) {
  const f = path.join(WEB, 'src', kf.comp.replace('@/', ''));
  if (!fs.existsSync(f)) continue;
  const src = fs.readFileSync(f, 'utf8');
  for (const del of delCompSet) {
    if (src.includes(del)) violations.push(`${kf.comp} 引用了 ${del}`);
  }
  // 还要查它引用的其它文件（api 等）是否引用了要删的组件
  const imps = [...src.matchAll(/from\s+['\"]([^'\"]+)['\"]/g)].map((m) => m[1]);
  for (const imp of imps) {
    if (!imp.startsWith('@/')) continue;
    const ip = path.join(WEB, 'src', imp.replace('@/', ''));
    for (const ext of ['', '.ts', '.vue']) {
      const cand = ip + ext;
      if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
        const isrc = fs.readFileSync(cand, 'utf8');
        for (const del of delCompSet) {
          if (isrc.includes(del)) violations.push(`${kf.comp} → ${imp} 引用了 ${del}`);
        }
        break;
      }
    }
  }
}
if (violations.length) {
  bad(`${violations.length} 处交叉引用（删了会白屏）：\n     ` + [...new Set(violations)].join('\n     '));
} else {
  good('保留页面（含它们 import 的 api 等）都没有引用要删的组件');
}

/* ---------- ③ 统一页是否还引用要删的组件 ---------- */
console.log('');
console.log('--- ③ 统一页是否引用了要删的组件 ---');
const uniFiles = fs
  .readdirSync(path.join(WEB, 'src/teaching/views'))
  .filter((f) => f.startsWith('Teaching') && f.endsWith('.vue'));
const uniViolations = [];
for (const f of uniFiles) {
  const src = fs.readFileSync(path.join(WEB, 'src/teaching/views', f), 'utf8');
  for (const del of delCompSet) {
    if (src.includes(del)) uniViolations.push(`${f} → ${del}`);
  }
}
if (uniViolations.length) {
  bad('统一页仍引用旧组件：\n     ' + uniViolations.join('\n     '));
} else {
  good(`${uniFiles.length} 个统一页都没有引用旧组件`);
}

/* ---------- ④ 八个域都已有 unified ---------- */
console.log('');
console.log('--- ④ domainConfig 里八个域是否都有 unified ---');
const dc = fs.readFileSync(path.join(WEB, 'src/teaching/domainConfig.ts'), 'utf8');
const DOMAINS = [
  'attendance',
  'exam',
  'score',
  'refund',
  'leave',
  'student',
  'class',
  'dorm',
];
const noUni = [];
for (const d of DOMAINS) {
  const i = dc.indexOf(`key: '${d}'`);
  if (i < 0) {
    noUni.push(`${d}（域都没找到）`);
    continue;
  }
  const seg = dc.slice(i, i + 600);
  const u = seg.indexOf('unified:');
  const s = seg.indexOf('stages:');
  if (u < 0 || (s >= 0 && u > s)) noUni.push(`${d}（有 unified 但位置异常）`);
  else if (!/Teaching\w+\.vue/.test(seg.slice(u, u + 200))) noUni.push(`${d}（unified 没指向 Teaching*.vue）`);
}
if (noUni.length) {
  bad('这些域没有可用的 unified：\n     ' + noUni.join('\n     '));
} else {
  good('八个域全部已有 unified 统一页');
}

/* ---------- ⑤ 旧路由的 path 是否还被别处引用 ---------- */
console.log('');
console.log('--- ⑤ 旧路由 path 是否被别处引用（删了会跳到 404）---');
const allSrc = walk(path.join(WEB, 'src')).filter((f) => /\.(ts|vue)$/.test(f));
const pathViolations = [];
for (const r of ROUTES_TO_REMOVE) {
  for (const f of allSrc) {
    const rel = path.relative(WEB, f).replace(/\\/g, '/');
    if (rel === 'src/router/index.ts') continue; // 它自己当然有
    if (rel === 'src/teaching/p3-d2-todo.cjs') continue; // 本清单
    if (rel === 'src/teaching/domainConfig.ts') continue; // stages 里会清掉
    const src = fs.readFileSync(f, 'utf8');
    if (src.includes("'" + r.path + "'") || src.includes('"' + r.path + '"')) {
      pathViolations.push(`${r.path} 被 ${rel} 引用`);
    }
  }
}
if (pathViolations.length) {
  bad(`${pathViolations.length} 处路由引用：\n     ` + [...new Set(pathViolations)].join('\n     '));
} else {
  good('没有别处引用这 25 条旧路由');
}

console.log('');
console.log(problems === 0 ? '✅ 四道检查全通过，可以安全下线' : `❌ ${problems} 类问题，先修再删`);
process.exit(problems === 0 ? 0 : 1);
