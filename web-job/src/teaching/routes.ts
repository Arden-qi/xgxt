/**
 * 「教学管理」合并入口的路由（/teaching/<域>）
 *
 * 【为什么路由不带 pageCode / module】
 *   meta 里只有 title + domainKey —— **故意不挂 pageCode/module**：
 *   · 合并入口本身不是"一个页面权限"，它是**多个学段页面的聚合入口**；
 *   · 权限判定在「页签层」做（access.ts，按各学段原 pageCode 判），
 *     守卫层再挂一次 pageCode 只会双重判定、容易打架。
 *   · 真正的数据拦截在后端接口（requirePage），前端这里只是不碍眼。
 *
 *   ⚠️ 于是路由守卫 step 5 (`if (!pageCode) return true`) 会放行 /teaching/*，
 *      这正是我们要的：能不能进去由页签决定，进去后没权限则显示空状态。
 *
 * 【原路由一个都没删】
 *   /exam、/class/exam、/class-jh/exam … 仍然可以直连（老代码、老书签不受影响）。
 *   这里只是**多了一个统一入口**，不是替换。
 */

import type { RouteRecordRaw } from 'vue-router';
import { TEACHING_DOMAINS } from './domainConfig';

export const teachingRoutes: RouteRecordRaw[] = TEACHING_DOMAINS.map((d) => ({
  path: `/teaching/${d.key}`,
  name: `Teaching_${d.key}`,
  component: () => import('@/teaching/TeachingDomain.vue'),
  meta: { title: d.title, domainKey: d.key },
}));
