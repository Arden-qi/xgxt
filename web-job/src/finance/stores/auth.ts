/**
 * 登录态 store（财务管理模块）
 *
 * ⚠️⚠️ 2026-10-02 改造：财务模块从「无登录」升级为「接门户统一登录」
 *
 * 与咨询模块的差异（很重要）：
 *   咨询模块：自己就有登录页 + 登录接口，是「独立门户」
 *   财务模块：登录统一由门户（5175，端口 8000）负责，本模块【没有登录页】
 *
 * 由此带来两个设计：
 *   ① 本模块的 token 来自门户 —— 门户用 iframe 承载本模块时，
 *      在 URL 上带 ?token=xxx&from=portal，
 *      由 utils/portal-token.ts 在 app.mount() 前接管并落盘。
 *   ② 本模块独立打开（直接访问 5174）时没有 token →
 *      路由守卫把用户引导到【门户登录页】（5175/#/login），
 *      而不是自己做一个登录页 —— 否则又是两套登录，回到改造前的老路。
 *
 * ⚠️ 菜单机制与咨询模块保持一致（单一事实来源）：
 *   后端只下发 menuKeys，title / path 由前端 MENU_MAP 维护。
 *   路由守卫按 meta.menuKey 校验，不再硬编码 meta.roles。
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { FinanceProfile } from 'shared-types/finance';
import { fetchProfile } from '@/finance/api/auth';
import { getPortalToken, clearPortalToken } from '@/portal/token';

const PROFILE_KEY = 'finance_profile';
const MENU_KEYS_KEY = 'finance_menu_keys';

/** ⭐ 门户登录页地址（本模块没有登录页，未登录时甩到这里） */
export const PORTAL_LOGIN_URL = '/#/login';

/**
 * 菜单 key → 展示信息（⚠️ key 必须和后端 FINANCE_ROLE_MENUS 对齐）
 *
 * ★ 第 3 期 D2 修 bug（2026-10-09）
 *   原来这一组**全都漏了 `/finance/` 前缀**，而且概览那项写的是 `/finance`
 *   （与模块前缀同名的目录），路由实际是 `/finance/overview`
 *   —— **点这六个菜单全都 404**。合并遗留的老 bug，这次一并修掉。
 */
export const MENU_MAP: Record<string, { title: string; path: string }> = {
  finance: { title: '财务概览', path: '/finance/overview' },
  fee: { title: '缴费管理', path: '/finance/fee' },
  freeze: { title: '冻结名单', path: '/finance/freeze' },
  refund: { title: '退费管理', path: '/finance/refund' },
  bill: { title: '账单明细', path: '/finance/bill' },
  standard: { title: '费用标准', path: '/finance/standard' },
};

/** 侧栏菜单分组（保持原型的三段式视觉） */
export const MENU_GROUPS: Array<{ title: string; keys: string[] }> = [
  { title: '缴费管理', keys: ['fee', 'freeze'] },
  { title: '退费管理', keys: ['refund'] },
  { title: '账单明细', keys: ['bill'] },
  { title: '基础配置', keys: ['standard', 'finance'] },
];

export const useAuthStore = defineStore('finance-auth', () => {
  const token = ref<string>(getPortalToken());
  const profile = ref<FinanceProfile | null>(
    JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null'),
  );
  const menuKeys = ref<string[]>(JSON.parse(localStorage.getItem(MENU_KEYS_KEY) || '[]'));
  const loading = ref(false);

  /** 是否已登录（有 token 且已解出身份） */
  const isLogin = computed(() => !!token.value && !!profile.value);

  const isFinanceAdmin = computed(() => profile.value?.financeRole === 'finance_admin');
  const canManageStandard = computed(() => profile.value?.canManageStandard === true);
  const userName = computed(() => profile.value?.userName || '');
  const isSysAdmin = computed(() => profile.value?.kind === 'sys_admin');

  /** 侧栏菜单（分组的 key 转成 { path, title }，并过滤掉没权限的） */
  const menuGroups = computed(() =>
    MENU_GROUPS.map((g) => ({
      title: g.title,
      items: g.keys
        .filter((k) => menuKeys.value.includes(k))
        .map((k) => ({ key: k, ...MENU_MAP[k] })),
    })).filter((g) => g.items.length > 0),
  );

  /** 平铺菜单（面包屑/兜底跳转用） */
  const menus = computed(() =>
    menuKeys.value
      .map((k) => {
        const item = MENU_MAP[k];
        return item ? { key: k, ...item } : null;
      })
      .filter(Boolean) as Array<{ key: string; title: string; path: string }>,
  );

  /** 有权限的第一个页面（越权时踢回这里） */
  const landingPath = computed(() => menus.value[0]?.path || '/no-access');

  /**
   * 从门户 token 拉取身份
   *
   * ⚠️ 刷新页面后调用；token 由 portal-token.ts 从 URL 接管或缓存读取。
   */
  async function loadProfile() {
    // 每次调用都重新读一遍 localStorage ——
    // 因为 token 可能是本次挂载时刚从 URL 接管进来的
    token.value = getPortalToken();
    if (!token.value) {
      profile.value = null;
      return null;
    }

    loading.value = true;
    try {
      const res = await fetchProfile();
      profile.value = res.profile;
      menuKeys.value = res.menuKeys || [];
      localStorage.setItem(PROFILE_KEY, JSON.stringify(profile.value));
      localStorage.setItem(MENU_KEYS_KEY, JSON.stringify(menuKeys.value));
      return res.profile;
    } finally {
      loading.value = false;
    }
  }

  /** 退出登录 → 回门户（本模块没有自己的登录页） */
  function logout() {
    token.value = '';
    profile.value = null;
    menuKeys.value = [];
    clearPortalToken();
    localStorage.removeItem(PROFILE_KEY);
    localStorage.removeItem(MENU_KEYS_KEY);
  }

  /** 未登录 / 失效 → 跳门户登录页 */
  function redirectToPortalLogin() {
    logout();
    const back = encodeURIComponent(location.href);
    location.href = `${PORTAL_LOGIN_URL}?redirect=${back}`;
  }

  return {
    token,
    profile,
    menuKeys,
    loading,
    isLogin,
    isFinanceAdmin,
    isSysAdmin,
    canManageStandard,
    userName,
    menuGroups,
    menus,
    landingPath,
    loadProfile,
    logout,
    redirectToPortalLogin,
  };
});
