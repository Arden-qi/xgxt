import { createApp } from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
// ★ 2026-10-04：班级模块（原 8003）并入时带入的设计令牌
//   （.kpi-* / .toolbar / .panel-* 等页面专用 class）
//   ⚠️ 已剔除其中的 html/body  reset 和 .el-* 覆盖 —— 那两条会影响
//      就业/教务模块的页面，不能让它污染别的模块。
//   顺序有讲究：必须在 element-plus 之后，否则覆盖会被冲掉。
import '@/class/styles/index.css';
// ★ 2026-10-05 深度单体合并：全系统统一设计系统
//   （门户 / 市场咨询 / 财务 / 权限 四个模块共用的 element-theme + shared-ui）
//   ⚠️ 必须在 element-plus 与 class/styles 之后引入，否则变量覆盖被冲掉。
//   ⚠️ 会让就业/教务/班级老页面的主色/字号对齐到统一口径（#2563EB / 13px）——
//      这是「统一门户版」的预期效果。
import '@/shared-ui/element-theme.css';
import '@/shared-ui/shared-ui.css';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
import { isApprovalOnly, isReadOnlyAdmin, isReadOnlyUser } from './store/permission';

const app = createApp(App);

app.use(createPinia());
app.use(router);
// ⚠️ 中文语言包，不然日期选择器等组件是英文的
app.use(ElementPlus, { locale: zhCn });

/**
 * 全局指令：v-readonly-hide
 * ============================================================
 * 用途：**只读账号**能看所有页面，但不能做写操作 ——
 *      挂了这个指令的按钮会自动隐藏。
 *
 *   只读账号有两类（★ 2026-10-06 扩充）：
 *     · 系统管理员 —— 纯只读，**连审批都不能**
 *     · 学管主任   —— 只读 + **仅审批可写**（同意/驳回/接收）
 *
 * 用法：
 *   <el-button v-readonly-hide @click="handleDelete">删除</el-button>
 *   <el-button v-readonly-hide.approver @click="handleApprove">审批</el-button>
 *
 * ★ `.approver` 修饰符（专给**审批按钮**用）：
 *     管理员视角 → 隐藏（他不能审批）
 *     学管主任视角 → **显示**（审批是他的本职）
 *   不加修饰符的写按钮（新增/修改/删除/发起…）对两类只读账号一律隐藏。
 *
 * 为什么用指令而不是 v-if：
 *   很多按钮本来就带 v-if（如 v-if="row.canApprove"），
 *   再叠一个 v-if 会互相打架；指令可以无冲突地叠加。
 *
 * ⚠️ 前端隐藏 ≠ 安全边界。真正的拦截在后端：
 *    app.ts 的只读总闸 + middleware/approvalOnly.ts（前端能改，后端改不了）。
 */
function shouldReadonlyHide(modifiers: Record<string, boolean | undefined>): boolean {
  if (!isReadOnlyUser.value) return false;
  // 审批按钮：管理员藏、学管留
  if (modifiers.approver) return isReadOnlyAdmin.value;
  // 普通写按钮：两类只读账号都藏
  return true;
}

app.directive('readonly-hide', {
  mounted(el: HTMLElement, binding) {
    if (shouldReadonlyHide(binding.modifiers)) el.style.display = 'none';
  },
  updated(el: HTMLElement, binding) {
    el.style.display = shouldReadonlyHide(binding.modifiers) ? 'none' : '';
  },
});

app.mount('#app');
