/**
 * 静态回归守卫：「账号详情」弹窗的「所属职位」表格**不该再有「操作」列**
 *
 * 背景（2026-10-23 用户要求）：
 *   「账号管理 → 查看 → 账号详情」里的「操作」列（原为「查看权限 / 编辑权限」
 *   两个就地弹权限树的入口）全部删除；连「操作」这个字段（整列）都不要。
 *   用户明确补充：「整个系统中所有的账号详情里边的这个操作删除」，
 *   并点名「职位管理 → 查看职位下人员 → 账号详情」这条路径也一样去掉。
 *
 *   该弹窗是共享组件 UserDetailDialog.vue，三处入口共用：
 *     · 账号管理（UserManage）  · 列表 → 查看 / 点姓名
 *     · 部门管理（DeptManage）  · 部门下账号弹窗 → 详情
 *     · 职位管理（RoleManage）  · 职位下人员 → 账号详情
 *   所以删一处即三处生效，但**三处挂载必须仍在**（别顺手连弹窗一起删了）。
 *
 *   以后谁把「操作」列或这两个入口加回来，本脚本立刻报红。
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

/** 剥掉 HTML 注释 / 块注释 / 行注释 —— 注释里会举例提到这些字样，直接数会误判 */
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
  results.push({ ok: true, label, extra });
}
function no(label, extra = '') {
  fail++;
  results.push({ ok: false, label, extra });
}
function check(cond, label, extra = '') {
  cond ? ok(label, extra) : no(label, extra);
}

const rawDetail = read(DETAIL);
const codeDetail = stripComments(rawDetail);

console.log('\n===== 「账号详情」弹窗「操作」列已删除 · 回归 =====\n');

/* ---------- 一、所属职位表格不再有「操作」列 ---------- */
console.log('--- 一、职位表格列 ---');
check(
  count(codeDetail, '<th>操作</th>') === 0,
  '账号详情：职位表格无「操作」表头',
  `<th>操作</th> 出现 ${count(codeDetail, '<th>操作</th>')} 次`,
);
check(
  !/查看权限/.test(codeDetail),
  '账号详情：无「查看权限」入口',
  `代码层出现 ${count(codeDetail, '查看权限')} 次`,
);
check(
  !/编辑权限/.test(codeDetail),
  '账号详情：无「编辑权限」入口',
  `代码层出现 ${count(codeDetail, '编辑权限')} 次`,
);

/* ---------- 二、就地权限树弹窗与相关状态已清干净 ---------- */
console.log('\n--- 二、就地权限树（PermTreeDialog）残留 ---');
check(
  count(codeDetail, 'PermTreeDialog') === 0,
  '账号详情：不再 import / 使用 PermTreeDialog',
  `出现 ${count(codeDetail, 'PermTreeDialog')} 次`,
);
check(
  count(codeDetail, 'openRolePerm') === 0,
  '账号详情：openRolePerm 已删除（无死代码）',
  `出现 ${count(codeDetail, 'openRolePerm')} 次`,
);
check(
  !/treeOpen|treeReadonly|treeRole|treePerms|onTreeConfirm/.test(codeDetail),
  '账号详情：tree* / onTreeConfirm 状态与回调已删除',
);
check(
  !/\bassignApi\b/.test(codeDetail),
  '账号详情：不再引入 assignApi（本组件不再改权限）',
  `出现 ${count(codeDetail, 'assignApi')} 次`,
);
check(
  !/\btoast\b/.test(codeDetail),
  '账号详情：toast 已随之移除（保存提示唯一调用方已删）',
  `出现 ${count(codeDetail, 'toast')} 次`,
);

/* ---------- 三、不该误删的东西还在 ---------- */
console.log('\n--- 三、弹窗内容没被误删 ---');
check(/<th>职位<\/th>/.test(codeDetail), '职位表格仍有「职位」列');
check(/<th>权限数<\/th>/.test(codeDetail), '职位表格仍有「权限数」列');
check(/<th>状态<\/th>/.test(codeDetail), '职位表格仍有「状态」列');
check(/所属职位/.test(codeDetail), '「所属职位」区块仍在');
check(/有效权限明细/.test(codeDetail), '「有效权限明细（合并结果）」区块仍在');
check(/基本信息/.test(codeDetail), '「基本信息」区块仍在');
check(/>\s*关闭\s*</.test(codeDetail), '底部「关闭」按钮仍在');
check(!/去编辑/.test(codeDetail), '底部仍无「去编辑」按钮（2026-10-19 口径不回退）');

/* ---------- 四、部门管理「部门下职位」弹窗：也没有「操作」列 ---------- */
console.log('\n--- 四、部门下职位弹窗（看权限 / 编辑权限） ---');
const deptCode = stripComments(read(DEPTM));

/** 截取某个 v-model 的 ProtoDialog 模板片段（同名文件里有多个弹窗，不能整文件数） */
function dialogBlock(src, vmodel) {
  const i = src.indexOf(`v-model="${vmodel}"`);
  if (i < 0) return '';
  const s = src.lastIndexOf('<ProtoDialog', i);
  const e = src.indexOf('</ProtoDialog>', i);
  return s >= 0 && e > s ? src.slice(s, e) : '';
}
const rolesBlock = dialogBlock(deptCode, 'rolesOpen');
check(rolesBlock.length > 0, '部门下职位弹窗仍存在（rolesOpen）', `片段 ${rolesBlock.length} 字符`);
check(!/<th>操作<\/th>/.test(rolesBlock), '部门下职位弹窗无「操作」表头');
check(
  !/看权限/.test(rolesBlock) && !/编辑权限/.test(rolesBlock),
  '部门下职位弹窗无「看权限 / 编辑权限」入口',
);
check(
  /<th>职位名称<\/th>/.test(rolesBlock) && /<th>账号数<\/th>/.test(rolesBlock),
  '部门下职位弹窗仍保留「职位名称 / 账号数」两列',
);
check(
  !/openRolePerm/.test(deptCode) && !/onRolePermConfirm/.test(deptCode),
  '部门管理：openRolePerm / onRolePermConfirm 已删除（无死代码）',
);
check(
  count(deptCode, 'PermTreeDialog') === 0,
  '部门管理：不再 import / 使用 PermTreeDialog',
  `出现 ${count(deptCode, 'PermTreeDialog')} 次`,
);
check(
  !/\bassignApi\b/.test(deptCode),
  '部门管理：不再引入 assignApi（本页不再改权限）',
  `出现 ${count(deptCode, 'assignApi')} 次`,
);
check(
  count(deptCode, '<th>操作</th>') === 1,
  '部门管理：仅「部门下账号」弹窗保留「操作」列（详情|编辑），职位弹窗那列已删',
  `<th>操作</th> 共 ${count(deptCode, '<th>操作</th>')} 处`,
);

/* ---------- 五、三处入口仍挂载同一份组件 ---------- */
console.log('\n--- 五、三处入口仍共用本组件 ---');
for (const [label, file] of [
  ['账号管理', USERM],
  ['职位管理', ROLEM],
  ['部门管理', DEPTM],
]) {
  const raw = read(file);
  check(
    count(raw, '<UserDetailDialog') === 1,
    `${label}：仍挂载账号详情弹窗`,
    `<UserDetailDialog 出现 ${count(raw, '<UserDetailDialog')} 次`,
  );
  check(
    count(raw, 'UserDetailDialog') >= 2,
    `${label}：仍 import 了 UserDetailDialog`,
  );
}

/* ---------- 汇总 ---------- */
console.log('\n===== 明细 =====');
for (const r of results) {
  console.log(`  ${r.ok ? '✅' : '❌'} ${r.label}${r.extra ? '  —— ' + r.extra : ''}`);
}
console.log(`\n===== 结果：${pass}/${pass + fail} 通过 =====`);
process.exit(fail ? 1 : 0);
