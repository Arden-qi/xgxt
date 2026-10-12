/**
 * 门户登录态 store
 *
 * ⚠️ 门户是全系统唯一登录入口：登录一次，签发含 modules 的 JWT，
 *    各子模块（5173/5174）共用同一个 token。
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { SysAccount, ModuleDef } from 'shared-types/portal';
import { login as apiLogin, fetchProfile } from '@/portal/api/portal';

const TOKEN_KEY = 'sms_token';
const MODULES_KEY = 'portal_modules';

export const useAuthStore = defineStore('portal-auth', () => {
  const token = ref<string>(localStorage.getItem(TOKEN_KEY) || '');
  const account = ref<SysAccount | null>(null);
  /** ⭐ 可见模块（含各自页面），侧栏目录树据此渲染 */
  const visibleModules = ref<ModuleDef[]>(
    JSON.parse(localStorage.getItem(MODULES_KEY) || '[]'),
  );
  const loading = ref(false);

  const isLogin = computed(() => !!token.value && !!account.value);
  const isSysAdmin = computed(() => account.value?.kind === 'sys_admin');

  /** 第一个可见模块（登录后落地） */
  const firstModule = computed(() => visibleModules.value[0] || null);

  /**
   * 建议落地 hash：如 '#/consult/student'
   *
   * ★ 2026-10-05 合并：legacy 模块（就业/教务/班级）的路由不带模块前缀、
   *   页面清单由角色权限算，这里拼不出正确路径 —— 跳过它们，只在新模块里找。
   *   找不到就返回 '/'，交给路由守卫按「角色 → 页面权限」决定落地页。
   */
  const landingHash = computed(() => {
    const m = visibleModules.value.find((x) => !x.legacy);
    if (!m) return '/';
    const firstMenu = m.menus[0];
    if (!firstMenu) return '/';
    return `/${m.key}${firstMenu.path}`;
  });

  async function login(accountName: string, password: string) {
    loading.value = true;
    try {
      const res = await apiLogin({ account: accountName, password });
      token.value = res.token;
      account.value = res.account;
      visibleModules.value = res.visibleModules;
      localStorage.setItem(TOKEN_KEY, res.token);
      localStorage.setItem(MODULES_KEY, JSON.stringify(res.visibleModules));
      return res;
    } finally {
      loading.value = false;
    }
  }

  /** 刷新页面后恢复身份 */
  async function loadProfile() {
    if (!token.value) return null;
    const res = await fetchProfile();
    account.value = res.account;
    visibleModules.value = res.visibleModules;
    localStorage.setItem(MODULES_KEY, JSON.stringify(res.visibleModules));
    return res;
  }

  function logout() {
    token.value = '';
    account.value = null;
    visibleModules.value = [];
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(MODULES_KEY);
  }

  return {
    token,
    account,
    visibleModules,
    loading,
    isLogin,
    isSysAdmin,
    firstModule,
    landingHash,
    login,
    loadProfile,
    logout,
  };
});
