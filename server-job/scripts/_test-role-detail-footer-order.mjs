/**
 * 回归守卫：「职位详情」弹窗底栏按钮顺序 —— 编辑权限在左、「关闭」贴右
 * ============================================================================
 *
 * 背景（2026-10-20）：
 *   用户截图框出详情弹窗底部的「关闭」「编辑权限」，要求「互换一下位置」。
 *   原顺序：职位 ID：R01 ........ 关闭 | 编辑权限（主操作在最右，原型口径）
 *   新顺序：职位 ID：R01 ........ 编辑权限 | 关闭
 *
 *   ⚠️ 只改这一个弹窗。其余弹窗仍是「关闭在左、主操作在右」的原型口径，
 *      本脚本第三节专门守这一点，防止有人「统一风格」时把别的弹窗一起倒过来。
 *
 *   ⚠️ 底栏是 flex + justify-content:flex-end，`.lft` 用 margin-right:auto。
 *      所以「谁贴右边」完全由 DOM 顺序决定 —— 顺序写反了视觉就反了，
 *      不能用 CSS order 之类的技巧糊过去（那样键盘 Tab 顺序会和视觉不一致）。
 *
 * 跑法：cd server-job && node scripts/_test-role-detail-footer-order.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const P = (rel) => join(REPO, rel);
const read = (p) => readFileSync(p, 'utf8');

let pass = 0;
let fail = 0;
const lines = [];
const check = (label, cond, extra = '') => {
  if (cond) {
    pass++;
    lines.push(`  ✅ ${label}${extra ? '  —— ' + extra : ''}`);
  } else {
    fail++;
    lines.push(`  ❌ ${label}${extra ? '  —— ' + extra : ''}`);
  }
};

const ROLE = P('web-job/src/perm/views/RoleManage.vue');
const src = read(ROLE);

/* ============================================================
 * 一、详情弹窗底栏：顺序必须是「编辑权限」→「关闭」
 * ============================================================ */
const iDetail = src.indexOf('<!-- ==================== 职位详情');
const iNext = src.indexOf('<!-- ==================== 职位下人员');
const detailBlock = src.slice(iDetail, iNext);

check('定位到「职位详情」弹窗区块', iDetail > 0 && iNext > iDetail, `${iDetail} ~ ${iNext}`);

const iEdit = detailBlock.indexOf('>编辑权限</button>');
const iClose = detailBlock.indexOf('>关闭</button>');

check('底栏两个按钮都在（编辑权限 / 关闭）', iEdit > 0 && iClose > 0, `edit@${iEdit} close@${iClose}`);

check(
  '「编辑权限」排在「关闭」之前（DOM 顺序 = 视觉顺序）',
  iEdit > 0 && iClose > 0 && iEdit < iClose,
  iEdit < iClose ? '编辑权限 → 关闭' : '顺序反了：仍是关闭在前',
);

check(
  '「编辑权限」仍是主按钮 .btn.pri（互换位置不改深浅）',
  /class="btn pri" type="button" @click="openPermTreeFromDetail\('edit'\)">编辑权限</.test(detailBlock),
);

check(
  '「关闭」仍是普通按钮 .btn（不是主按钮）',
  /class="btn" type="button" @click="detailOpen = false">关闭</.test(detailBlock),
);

check(
  '左侧「职位 ID」说明仍在（互换只动两个按钮，没把这条挤掉）',
  /<div class="lft">职位 ID：\{\{ detail\?\.id \|\| '—' \}\}<\/div>/.test(detailBlock),
);

/* ============================================================
 * 二、改动不许用 CSS order 之类的手段绕过 DOM 顺序
 * ============================================================ */
const CSS = P('web-job/src/shared-ui/shared-ui.css');
const cssSrc = read(CSS);

check(
  'CSS：.dlg-f 仍是 flex-end（按钮组贴右，靠 DOM 顺序决定谁在最右）',
  /\.dlg-f\{[^}]*justify-content:\s*flex-end/.test(cssSrc),
);

check(
  'CSS：没有为这个弹窗加 order / flex-direction:row-reverse 之类的倒序技巧',
  !/dlg-f[^{}]*\{[^}]*order:\s*-?\d/.test(cssSrc) &&
    !/dlg-f[^{}]*\{[^}]*flex-direction:\s*row-reverse/.test(cssSrc),
);

/* ============================================================
 * 三、别误伤：其余弹窗仍是「关闭在左、主操作在右」
 * ============================================================ */
const footers = [...src.matchAll(/<template #footer>([\s\S]*?)<\/template>/g)].map((m) => m[1]);
check('本页弹窗底栏数量合理（≥5）', footers.length >= 5, `实测 ${footers.length} 个`);

/**
 * 只对「关闭 + 一个主操作」这种成对底栏做判定，跳过纯「取消/保存」表单类底栏。
 * 判定方式：底栏里同时出现「关闭」与某个 pri 按钮，且关闭不在最后。
 */
let pairCount = 0;
let badPairs = [];
for (const f of footers) {
  if (!f.includes('>关闭</button>')) continue;
  const iC = f.indexOf('>关闭</button>');
  const priIdx = f.indexOf('class="btn pri"');
  if (priIdx < 0) continue;
  pairCount++;
  // 这个详情弹窗是唯一"关闭在最后"的，其余必须关闭在前
  const isDetail = f.includes('openPermTreeFromDetail');
  if (!isDetail && iC > priIdx) badPairs.push(f.replace(/\s+/g, ' ').slice(0, 70));
}

check(
  '除职位详情外，「关闭」仍在主操作之前（其余弹窗没有被顺手倒过来）',
  badPairs.length === 0,
  pairCount ? `扫到 ${pairCount} 个成对底栏，异常 ${badPairs.length} 个` : '未扫到成对底栏',
);

console.log(lines.join('\n'));
console.log(`\n===== 结果：${pass}/${pass + fail} 通过 =====`);
if (fail) {
  lines.filter((l) => l.startsWith('  ❌')).forEach((l) => console.log('  失败：' + l.trim()));
  if (badPairs.length) badPairs.forEach((b) => console.log('  异常底栏：' + b));
  process.exit(1);
}
