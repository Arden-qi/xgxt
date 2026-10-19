/**
 * 静态回归守卫：「账号详情」弹窗底部「去编辑」按钮的开关口径
 *
 * 背景（2026-10-19，分两轮）：
 *   该弹窗是共享组件 UserDetailDialog.vue，三处入口共用同一个底部按钮：
 *     · 账号管理（UserManage）—— 第一轮：列表行操作已有独立「编辑」→ 用户要求删掉重复入口
 *     · 职位管理（RoleManage）—— 第二轮：用户要求一并删掉（那页「职位下人员」行操作
 *       只有「移出该职位 / 账号详情」，删掉后本页就没有编辑账号的入口了，已提示用户）
 *     · 部门管理（DeptManage）—— 用户尚未要求，仍显示（成员列表另有独立「编辑」）
 *   所以做法不是删按钮，而是加 `showEdit` 开关（默认 true），前两页传 false。
 *   这个脚本把该口径钉住：谁要是「顺手清理」掉 prop、改了默认值、
 *   或者误把部门管理那处也关掉 / 误删它的 @edit 绑定，这里会立刻报红。
 *
 * 纯静态断言，不起服务、不连库；退出码 0 = 全通过。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const P = (rel) => join(REPO, rel);

const DETAIL = P('web-job/src/perm/components/UserDetailDialog.vue');
const USERM = P('web-job/src/perm/views/UserManage.vue');
const ROLEM = P('web-job/src/perm/views/RoleManage.vue');
const DEPTM = P('web-job/src/perm/views/DeptManage.vue');

const read = (p) => readFileSync(p, 'utf8');
const count = (s, sub) => s.split(sub).length - 1;

/**
 * 去掉注释后的源码 —— 本文件多处注释里「用反引号提到了 :show-edit="false"」，
 * 直接数会误判；统计代码层出现次数前先剥掉 HTML 注释 / 块注释 / 行注释。
 */
function stripComments(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

let pass = 0;
let fail = 0;
const results = [];

function ok(label, extra = '') {
  pass++;
  results.push(`  ✅ ${label}${extra ? '  —— ' + extra : ''}`);
}
function bad(label, extra = '') {
  fail++;
  results.push(`  ❌ ${label}${extra ? '  —— ' + extra : ''}`);
}
function check(label, cond, extra = '') {
  if (cond) ok(label, extra);
  else bad(label, extra);
}

/* ============================================================
 * 一、共享组件：开关存在、默认 true、按钮真的受控
 * ============================================================ */
const detail = read(DETAIL);

check(
  '组件声明了 showEdit 可选 prop',
  /showEdit\?:\s*boolean;/.test(detail),
  `showEdit? 出现 ${count(detail, 'showEdit?:')} 次`,
);

check(
  'showEdit 默认值为 true（不传的页面行为不变）',
  /fallback:\s*null,\s*showEdit:\s*true/.test(detail),
  'defaults = { fallback: null, showEdit: true }',
);

check(
  '底部「去编辑」按钮挂了 v-if="showEdit"',
  count(detail, 'v-if="showEdit"') === 1,
  `v-if="showEdit" 出现 ${count(detail, 'v-if="showEdit"')} 次`,
);

check(
  '按钮本体仍在（只是可隐藏，不是删掉）',
  count(detail, "emit('edit', props.userId)") === 1,
  `emit('edit') 出现 ${count(detail, "emit('edit'")} 次`,
);

check(
  '「关闭」按钮不受开关影响（永远显示）',
  /class="btn pri" type="button" @click="visible = false"/.test(detail),
);

/* ============================================================
 * 二、账号管理：开关传 false，且遗留的 @edit 绑定已清干净
 * ============================================================ */
const userm = read(USERM);
/** 去掉注释后的账号管理源码：只按「真实代码」统计，避免被注释里的举例干扰 */
const usermCode = stripComments(userm);

check(
  '账号管理给弹窗传了 :show-edit="false"（且只有一处）',
  count(usermCode, ':show-edit="false"') === 1,
  `代码里 ${count(usermCode, ':show-edit="false"')} 次（含注释共 ${count(userm, ':show-edit="false"')} 次）`,
);

check(
  '账号管理不再绑定 @edit（按钮没了，绑定就是死代码）',
  !/@edit=/.test(usermCode),
  `@edit= 出现 ${count(usermCode, '@edit=')} 次`,
);

check(
  '账号管理已删除 editFromDetail 函数体（注释里留个说明不算）',
  !/function editFromDetail/.test(usermCode),
  `function editFromDetail 出现 ${count(usermCode, 'function editFromDetail')} 次`,
);

check(
  '账号管理仍挂载着详情弹窗（没顺手连弹窗一起删了）',
  count(userm, '<UserDetailDialog') === 1,
);

check(
  '账号管理列表行操作仍有独立「编辑」入口（删了弹窗内按钮也不至于没法编辑）',
  /@click="openEdit\(u\)">编辑</.test(userm),
);

/* ============================================================
 * 三、职位管理：第二轮也关掉了（用户 2026-10-19 追加要求）
 * ============================================================ */
const rolem = read(ROLEM);
const rolemCode = stripComments(rolem);

check(
  '职位管理给弹窗传了 :show-edit="false"（且只有一处）',
  count(rolemCode, ':show-edit="false"') === 1,
  `代码里 ${count(rolemCode, ':show-edit="false"')} 次（含注释共 ${count(rolem, ':show-edit="false"')} 次）`,
);

check(
  '职位管理不再绑定 @edit（按钮没了，绑定就是死代码）',
  !/@edit=/.test(rolemCode),
  `@edit= 出现 ${count(rolemCode, '@edit=')} 次`,
);

check(
  '职位管理已删除 openUserEditById 函数体（注释里留个说明不算）',
  !/function openUserEditById/.test(rolemCode),
  `function openUserEditById 出现 ${count(rolemCode, 'function openUserEditById')} 次`,
);

check(
  '职位管理不再引用 permUserEditRoute（随之失效的 import 已清掉）',
  !/permUserEditRoute/.test(rolemCode),
  `代码里 ${count(rolemCode, 'permUserEditRoute')} 次`,
);

check(
  '职位管理仍挂载着详情弹窗（没顺手连弹窗一起删了）',
  count(rolem, '<UserDetailDialog') === 1,
);

check(
  '职位管理「职位下人员」行操作仍有「移出该职位 / 账号详情」',
  /@click="removeRoleFromUser\(u\)">移出该职位</.test(rolem) &&
    /@click="openUserDetail\(u\)">账号详情</.test(rolem),
);

/* ============================================================
 * 四、部门管理：目前唯一还显示「去编辑」的入口
 *    （正因如此，共享组件里的 showEdit 开关还不能当成死代码删掉）
 * ============================================================ */
const deptm = read(DEPTM);

check(
  '部门管理仍挂载详情弹窗且未传 show-edit（= 按钮照旧显示）',
  count(deptm, '<UserDetailDialog') === 1 && !/show-edit/.test(deptm),
);

check(
  '部门管理仍绑定 @edit 处理函数',
  /@edit="[A-Za-z_][\w]*"/.test(deptm),
  (deptm.match(/@edit="([A-Za-z_][\w]*)"/) || [])[1] || '未找到',
);

check(
  '共享组件的 showEdit 开关仍在（部门管理还要用，别当死代码删）',
  /showEdit\?:\s*boolean;/.test(read(DETAIL)),
);

/* ============================================================
 * 输出
 * ============================================================ */
console.log('\n===== 「账号详情 · 去编辑」开关口径回归 =====\n');
for (const line of results) console.log(line);
console.log(`\n===== 结果：${pass}/${pass + fail} 通过 =====`);
process.exit(fail === 0 ? 0 : 1);
