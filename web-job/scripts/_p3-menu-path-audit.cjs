/**
 * 菜单路径 → 路由 对账（第 3 期 D2 副产品）
 * ============================================================
 *
 * 【为什么有这个脚本】
 *   修 `/refund` 时顺手发现的 bug：**consult 和 finance 两个子模块的菜单路径
 *   全都漏了模块前缀**（写 `/refund`，路由实际是 `/consult/refund`），
 *   点菜单必然 404 —— 而这是**合并遗留的老 bug**，跟本次改动无关。
 *
 *   既然发现了一处，就得全文扫一遍还有没有第二处。
 *
 * 【判据】
 *   菜单里写的 path，必须能在 `router/index.ts` 里找到**完全相同**的 `path:`。
 *   匹配不上 = 点下去必然 404（或落到同名但错误的页面）。
 */
const fs = require('fs');
const path = require('path');

const WEB = path.resolve(__dirname, '..');
const routerSrc = fs.readFileSync(path.join(WEB, 'src/router/index.ts'), 'utf8');

/** router 里真实登记的所有 path */
const realPaths = new Set([...routerSrc.matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1]));

/**
 * ★ 动态生成的路由也要算
 *   `/teaching/<域>` 不写在 router/index.ts 里，而是由 `teaching/routes.ts`
 *   按 TEACHING_DOMAINS 动态生成（`/teaching/${d.key}`）。
 *   → 首版漏了它，导致我刚改的 4 处 `/teaching/*` 全被误报「找不到路由」。
 */
const teachingCfg = fs.readFileSync(path.join(WEB, 'src/teaching/domainConfig.ts'), 'utf8');
for (const k of teachingCfg.matchAll(/^\s{4}key:\s*'([^']+)'/gm)) {
  realPaths.add('/teaching/' + k[1]);
}

/** 允许的「非路由」用法：这些 path 有别的机制兜着，不算错 */
const WHITELIST = new Set(['/', '/coming', '/login', '/403', '/404']);

/* ---------- 扫所有 MENU_MAP ---------- */
console.log('=== 菜单路径 → 路由 对账 ===');
console.log('');
console.log('router/index.ts 登记的 path 共 ' + realPaths.size + ' 个');
console.log('');

const files = [];
function walk(dir) {
  let ents = [];
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(ts|vue)$/.test(e.name)) files.push(p);
  }
}
walk(path.join(WEB, 'src'));

/**
 * ★ 跳过备份目录
 *   `src/_p3d2-backup/` 是 D2 删除前的备份（保留旧路由以便还原），
 *   里面的 path 全部「找不到对应路由」是**正常的** ——
 *   首版没排除，把 23 条备份里的旧路由全报成问题，纯误报。
 */
const BACKUP_DIR = path.join(WEB, 'src/_p3d2-backup');
const isBackup = (f) => path.resolve(f).startsWith(path.resolve(BACKUP_DIR));

let problems = 0;
let checked = 0;

for (const f of files) {
  if (isBackup(f)) continue;
  const src = fs.readFileSync(f, 'utf8');
  const rel = path.relative(WEB, f).replace(/\\/g, '/');

  // 抓两种形态：MENU_MAP 里的 path，以及 router.push('/xxx') / $router.push('/xxx')
  /**
   * ★ 剔掉注释行再匹配
   *   首版把「注释里的历史说明文字」也当成真跳转，报了 5 处误报
   *   （如 `* 部门管理 gotoPage('/role') router.push('/user')` 这种
   *   「以前怎么做的」说明文字）—— 注释里的路径不是代码。
   *   判据：行首是 `/*`、`*`、`//` 的都算注释。
   */
  const codeOnly = src
    .split('\n')
    .filter((l) => !/^\s*(\/\*|\*|\*\/|\/\/)/.test(l))
    .join('\n');

  const all = [
    ...new Set([
      ...[...codeOnly.matchAll(/(?:path|to)\s*:\s*'(\/[^']*)'/g)].map((m) => m[1]),
      ...[
        ...codeOnly.matchAll(/router\.push\(\s*'(\/[^']*)'/g),
        ...codeOnly.matchAll(/router\.push\(\s*\{\s*path:\s*'(\/[^']*)'/g),
        ...codeOnly.matchAll(/\$router\.push\(\s*'(\/[^']*)'/g),
        ...codeOnly.matchAll(/\$router\.push\(\s*\{\s*path:\s*'(\/[^']*)'/g),
      ].map((m) => m[1]),
    ]),
  ];

  for (const p of all) {
    if (WHITELIST.has(p)) continue;
    // 动态路由 / 带参数的路径，跳过
    if (p.includes(':') || p.includes('*')) continue;
    // api 路径不是前端路由
    if (p.startsWith('/api/')) continue;
    checked += 1;
    if (!realPaths.has(p)) {
      problems += 1;
      console.log(`  ❌ ${p.padEnd(28)} ← ${rel}`);
    }
  }
}

console.log('');
if (problems === 0) {
  console.log(`✅ 核对 ${checked} 个跳转路径，全部能在 router 里找到对应路由`);
} else {
  console.log(`❌ 核对 ${checked} 个跳转路径，其中 ${problems} 个找不到对应路由（点了会 404）`);
  console.log('');
  console.log('修法：把 path 改成 router/index.ts 里真实存在的那个。');
  console.log('⚠️ 注意别只改「能显示」就完 —— 路径写成别的模块的同名页面，');
  console.log('   点进去会看到错的数据，比 404 更难查。');
}

process.exit(problems === 0 ? 0 : 1);
