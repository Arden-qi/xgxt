/**
 * 第 3 期 · 阶段 D2 执行器：从 domainConfig.ts 摘掉八域的 stages 块
 * ⚠️ 只保留 unified，stages 整块删掉。
 *
 * 【为什么可以删 stages】
 *   ① 八个域全部已有 `unified`（脚本会先断言，不齐就中止）
 *   ② `TeachingDomain.vue` 的 `unified` 分支（第 68 行）直接渲染统一页，
 *      **根本不读 stages** —— stages 只在「无 unified」时才影响显示
 *   ③ 阶段 A 已把「学段可见性判权」从 `hasPage(旧路由)` 改成 `hasPerm(权限码)`，
 *      并在 TeachingDomain 里加了权限码兜底
 *
 * 【保留一列 stages 的域：fee 催费】
 *   催费域本期**没有合并**，没有 unified → 删了 stages 它就没页面了。
 */
const fs = require('fs');
const path = require('path');

const DC = path.resolve(__dirname, '../src/teaching/domainConfig.ts');
const DRY = process.argv.includes('--dry');

/** ★ 本次要清 stages 的域（= 已合并且有 unified 的八域） */
const CLEAR_STAGES = ['student', 'class', 'attendance', 'exam', 'score', 'refund', 'approval', 'dorm'];
/** 明确保留 stages 的域（本期没合并） */
const KEEP_STAGES = ['fee'];

const src = fs.readFileSync(DC, 'utf8');

/* ---------- 前置断言：八个域都必须已有 unified ---------- */
const unifiedOf = (key) => {
  const i = src.indexOf(`key: '${key}'`);
  if (i < 0) return null;
  const seg = src.slice(i, i + 2600);
  const m = seg.match(/unified:\s*defineAsyncComponent\(\(\)\s*=>\s*import\('([^']+)'\)\)/);
  return m ? m[1] : null;
};

console.log('=== 阶段 D2：从 domainConfig 摘掉八域的 stages ===');
console.log('');
console.log('--- 前置断言：八域必须都有 unified ---');
let ready = true;
for (const k of CLEAR_STAGES) {
  const u = unifiedOf(k);
  if (u) {
    console.log('  ✅ ' + k.padEnd(12) + u);
  } else {
    console.log('  ❌ ' + k.padEnd(12) + '没有 unified —— 不能删 stages');
    ready = false;
  }
}
if (!ready) {
  console.log('');
  console.log('中止：有域没 unified，删了 stages 会让它变空白页。');
  process.exit(1);
}

/* ---------- 逐域删 stages 块 ---------- */
console.log('');
console.log('--- 删除 stages 块 ---');

let out = src;
const removed = [];

for (const key of CLEAR_STAGES) {
  const ki = out.indexOf(`key: '${key}'`);
  if (ki < 0) {
    console.log('  ⚠️ ' + key + ' 域没找到，跳过');
    continue;
  }
  const si = out.indexOf('    stages: [', ki);
  if (si < 0) {
    console.log('  ⚠️ ' + key + ' 没有 stages 块，跳过');
    continue;
  }
  // 确认这个 stages 属于本域（不能越界吃到下一个域）
  const nextKey = out.indexOf('    key:', si);
  if (nextKey >= 0 && nextKey < si + 40) {
    console.log('  ⚠️ ' + key + ' 的 stages 块定位异常，跳过');
    continue;
  }
  // 从 'stages: [' 往里找配对的 '],'（按 4 空格缩进的右方括号）
  let depth = 0;
  let end = -1;
  for (let i = si + 11; i < out.length; i += 1) {
    if (out[i] === '[') depth += 1;
    else if (out[i] === ']') {
      depth -= 1;
      if (depth === 0) {
        end = i + 1; // 含 ']'
        break;
      }
    }
  }
  if (end < 0) {
    console.log('  ⚠️ ' + key + ' 的 stages 块找不到配对的 ]，跳过');
    continue;
  }
  // 连后面的逗号和换行一起吃掉
  let tail = end;
  if (out[tail] === ',') tail += 1;
  if (out[tail] === '\n') tail += 1;

  const block = out.slice(si, end);
  const lines = block.split('\n').length;
  out = out.slice(0, si) + out.slice(tail);
  removed.push({ key, lines });
  console.log(`  ✅ ${key.padEnd(12)} 删除 ${lines} 行 stages`);
}

console.log('');
console.log(`  合计删除 ${removed.length} 个 stages 块 / ${removed.reduce((s, r) => s + r.lines, 0)} 行`);

if (DRY) {
  console.log('');
  console.log('【干跑】未写入文件。去掉 --dry 执行。');
} else {
  fs.writeFileSync(DC, out);
  console.log('');
  console.log('  已写入 domainConfig.ts');
}

/* ---------- 删后校验 ---------- */
const checkSrc = DRY ? out : fs.readFileSync(DC, 'utf8');
console.log('');
console.log('--- 删后校验 ---');
let bad = 0;

/**
 * ★ 精确定位「某个域的块」——
 *   不能只看 `key: 'x'` 往后 N 个字符，因为**下一个域的 stages 会落进窗口内**
 *   （首版就因此把 fee 域的 stages 误判成 dorm 的没删干净）。
 *   正确做法：从本域 key 起，到**下一个 `    key:` 为止**。
 */
function blockOf(srcText, key) {
  const i = srcText.indexOf(`key: '${key}'`);
  if (i < 0) return '';
  const next = srcText.indexOf('\n    key:', i + 10);
  return srcText.slice(i, next > 0 ? next : srcText.length);
}

for (const k of CLEAR_STAGES) {
  const seg = blockOf(checkSrc, k);
  if (!seg) {
    console.log('  ❌ ' + k + ' 域块没找到（可能被误删）');
    bad += 1;
    continue;
  }
  const hasStages = /^\s*stages:\s*\[/m.test(seg);
  const hasUnified = /unified:\s*defineAsyncComponent/.test(seg);
  if (hasStages) {
    console.log('  ❌ ' + k.padEnd(12) + 'stages 还在');
    bad += 1;
  } else if (!hasUnified) {
    console.log('  ❌ ' + k.padEnd(12) + 'unified 丢了（严重）');
    bad += 1;
  } else {
    console.log('  ✅ ' + k.padEnd(12) + 'stages 已清 / unified 保留');
  }
}
for (const k of KEEP_STAGES) {
  const seg = blockOf(checkSrc, k);
  console.log(
    (/^\s*stages:\s*\[/m.test(seg) ? '  ✅ ' : '  ❌ ') + k.padEnd(12) + 'stages 保留（本域未合并）',
  );
}

console.log('');
console.log(bad === 0 ? '✅ 校验通过' : `❌ ${bad} 处异常`);
process.exit(bad === 0 ? 0 : 1);
