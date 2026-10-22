import { defineStore } from 'pinia';
import { PayStatus } from 'shared-types/class-jh';
import { http } from '@/api/request';
import { moduleAllowed } from '@/store/modules';

/**
 * 催费/缴费 菜单红点（2026-10-19 用户要求：有催费信息时菜单项右上角亮红点）
 * ============================================================
 * 【口径】待催办事项数 = 三部门之和：
 *   · 初高：缴费台账「待缴」（PayStatus.UNPAID，含到期阈值内的紧急件——待缴即该催）；
 *   · 大学：催缴记录「逾期未缴」（onlyOverdue）；
 *   · 就业：催费单「待催缴」（callStatus=1；「催缴中」视为已在处理，不亮点）。
 *
 * 【形态】一次性拉三个接口的 size=1 只为读 total，轻量；
 *   60 秒节流；进入催费/缴费页时强刷（处理完回来红点会随之消失）。
 *
 * ⚠️⚠️ 2026-10-22 修「一登录就弹没有权限」（用户报障）
 *   原来这里三个接口无条件全打，登录后**任何账号**都会去请求初高/大学/就业的催费接口。
 *   账号没有对应板块时后端返 403 / 40302，axios 拦截器就各弹一条
 *   「您没有访问「班级管理」模块的权限」/「您没有该操作的权限」——
 *   用户明明能正常用系统，一进门先吃三条红字。
 *
 *   现在的口径（两道闸）：
 *     ① **按门户模块先过滤**：class-jh / class / job 三个板块，账号没哪个就不请求哪个
 *        （与后端模块级鉴权同一粒度，从源头不发无权请求）；
 *     ② 请求带 `silent: true`：万一还有边角情况（比如以后新加的板块组合、
 *        模块有了但页面未授权），失败也只写控制台，不弹窗。
 *   任何一道闸都能单独保证「不打扰」，两道一起上是为了以后新增账号不再复发。
 */
export const useFeeUrgeBadge = defineStore('feeUrgeBadge', {
  state: () => ({
    jhPending: 0,
    classOverdue: 0,
    employPending: 0,
    lastFetched: 0,
  }),
  getters: {
    count: (s) => s.jhPending + s.classOverdue + s.employPending,
    tooltip: (s) =>
      `待催办：初高待缴 ${s.jhPending} · 大学逾期 ${s.classOverdue} · 就业待催缴 ${s.employPending}（点击进入处理）`,
  },
  actions: {
    async refresh(force = false) {
      if (!force && Date.now() - this.lastFetched < 60_000) return; // 60 秒节流

      /* ① 模块闸：没有哪个板块就别去请求哪个板块（没权限的接口一个都不打） */
      const canJh = moduleAllowed('class-jh');
      const canCls = moduleAllowed('class');
      const canEmp = moduleAllowed('job');
      if (!canJh && !canCls && !canEmp) {
        // 三个板块都没有 → 这个账号看不到「催费」菜单，红点无意义，也不用再试
        this.lastFetched = Date.now();
        return;
      }

      /* ② 静默请求：拉不到就保持现状，绝不弹「没有权限」 */
      const silent = { silent: true };
      const total = (p: Promise<any>): Promise<number | null> =>
        p.then((r) => Number(r?.total || 0)).catch(() => null);

      const [jh, cls, emp] = await Promise.all([
        canJh
          ? total(http.get<any>('/api/class-jh/fee/list', { page: 1, size: 1, payStatus: PayStatus.UNPAID }, silent))
          : Promise.resolve(null),
        canCls
          ? total(http.get<any>('/api/class/urge/list', { page: 1, size: 1, onlyOverdue: true }, silent))
          : Promise.resolve(null),
        canEmp
          ? total(http.get<any>('/api/job/fee-call/page', { page: 1, size: 1, callStatus: 1 }, silent))
          : Promise.resolve(null),
      ]);

      // 只覆盖「拉到了」的那几项；失败（null）保持上次的值，不显示假 0
      if (jh !== null) this.jhPending = jh;
      if (cls !== null) this.classOverdue = cls;
      if (emp !== null) this.employPending = emp;
      this.lastFetched = Date.now();
    },
  },
});
