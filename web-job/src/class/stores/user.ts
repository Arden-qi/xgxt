import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import type { MenuItem } from 'shared-types/class';
import { me as apiMe, type MeResult } from '@/class/api/auth';
import { getToken } from '@/class/api/request';
import { myPermissions, myRoles } from '@/store/permission';
// ⚠️ RoleCode 要用【主包】的（无前缀编码），不是 shared-types/class 那个（枚举名不同）
import { RoleCode } from 'shared-types';

/**
 * 登录态 / 权限 / 数据范围（★ 2026-10-04 班级模块并入时改造）
 *
 * ============================================================
 * 【原版依赖两个桩服务，合并后已不存在】
 *   原版 loadContext() 会同时调两个接口：
 *     · userPerm() → 8006 权限服务（拿菜单树 + 权限码）
 *     · apiMe()    → 8003 自己（拿 classIds）
 *   合并后 8001/8006 不再独立部署，所以改成：
 *     · 权限码 / 角色 → 读【我们自己的】@/store/permission
 *       （数据来自后端 /api/job/auth/my-pages，是同一个程序的接口）
 *     · classIds / dataScope / deptCode → 仍调 /api/class/me
 *       （这个接口已随班级后端并入，实测可用）
 *
 * 【为什么不重写 11 个页面】
 *   页面里用了 26 处 user.xxx（can / isAllScope / isSuper / roles …），
 *   保留同名同义的 store，页面代码就一行都不用改。
 * ============================================================
 */

/** 数据范围中文 —— 顶栏要显示当前登录人看得到多少数据 */
const SCOPE_NAME: Record<number, string> = {
  1: '仅本人',
  2: '本班级',
  3: '本部门',
  4: '全部',
};

/**
 * 角色中文
 *
 * ⚠️ 键是【主系统统一后的无前缀角色码】（2026-10-02 起），
 *    不是班级原来的 ROLE_ 前缀写法 —— 后端 auth 解析出来的就是无前缀的。
 */
export const ROLE_NAME: Record<string, string> = {
  [RoleCode.SYS_ADMIN]: '系统管理员',
  [RoleCode.RM_PRINCIPAL]: '校长',
  [RoleCode.MKT_CONSULT]: '招生/咨询老师',
  [RoleCode.TEACH_HEAD]: '班主任',
  [RoleCode.TEACH_TUTOR]: '教员',
  [RoleCode.TEACH_ASSIST]: '助教',
  [RoleCode.TEACH_QTY]: '教质经理（已停用）',
  [RoleCode.ACAD_MANAGER]: '学术经理（已停用）',
  [RoleCode.TEACH_DEAN]: '学管主任',
  [RoleCode.ACAD_STAFF]: '教务老师',
  [RoleCode.JOB_STAFF]: '就业老师',
};

/** 学管 = 学管主任（主系统把教质/学术两个经理合并成了一个角色） */
export const STUDY_MGR_ROLES: string[] = [RoleCode.TEACH_DEAN];

/**
 * 「全局角色」—— 能看到全部数据 / 能审批
 *
 * 与后端 src/class/lib/authUser.ts 的判定保持一致；
 * 后端仍会独立再判一次，这里只是控制前端按钮显隐。
 *
 * ★ 2026-10-04 加入 SUPER_TEST（万能测试号）：
 *   权限管理模块（8006）未接前，斌哥要一个号能看能改所有页面来验证业务连通性。
 *   它在这里进 SUPER_ROLES → isSuper / canApprove 自动为真 → 班级页所有按钮放行。
 *   （后端也已把 SUPER_TEST 加进 FULL_ACCESS_ROLES，两边对齐。）
 */
const SUPER_ROLES: string[] = [RoleCode.SYS_ADMIN, RoleCode.RM_PRINCIPAL, 'SUPER_TEST'];
const APPROVER_ROLES: string[] = [...SUPER_ROLES, ...STUDY_MGR_ROLES];

export interface MenuGroup {
  id: string;
  name: string;
  children: MenuItem[];
}

export const useUserStore = defineStore('user', () => {
  const token = ref(getToken());
  const meInfo = ref<MeResult | null>(null);
  /**
   * 角色码：直接引用我们权限 store 里的那份（同一个 ref，天然同步）
   * 不再自己存一份 —— 免得两处不同步导致「菜单能看到但按钮全灰」
   */
  const roles = myRoles;
  const dataScope = ref(4);
  const deptCode = ref(2);
  /** 权限码：同样直接引用我们权限 store 的那份 */
  const permCodes = myPermissions;
  /** 菜单树：合并后菜单由 @/config/menu.ts 统一管，这里只留空数组占位 */
  const rawMenus = ref<MenuItem[]>([]);
  /** 是否已拉过上下文（页面 onMounted 据此决定要不要补拉） */
  const loaded = ref(false);

  const isLogin = computed(() => !!token.value);
  const userName = computed(() => meInfo.value?.userName || '');
  const userId = computed(() => meInfo.value?.userId || '');
  const roleNames = computed(() => roles.value.map((r) => ROLE_NAME[r] || r));
  const scopeName = computed(() => SCOPE_NAME[dataScope.value] || '—');

  const isStudyManager = computed(() => roles.value.some((r) => STUDY_MGR_ROLES.includes(r)));
  const isPrincipal = computed(() => roles.value.includes(RoleCode.RM_PRINCIPAL));
  const isSuper = computed(() => roles.value.some((r) => SUPER_ROLES.includes(r)));
  /** 能审批休学/退学的人（学管、校长、管理员） */
  const canApprove = computed(() => roles.value.some((r) => APPROVER_ROLES.includes(r)));
  /** 全部数据范围 */
  const isAllScope = computed(() => dataScope.value === 4);

  /** 权限码判断：class:student:add 这类 */
  function can(code: string | undefined): boolean {
    if (!code) return true;
    if (permCodes.value.includes('*')) return true;
    return permCodes.value.includes(code);
  }
  function canAny(codes: string[]): boolean {
    return codes.some((c) => can(c));
  }

  /** 侧边栏菜单树（合并后由 @/config/menu.ts 管，这里保留占位以防页面引用） */
  const menuGroups = computed<MenuGroup[]>(() => {
    const roots = rawMenus.value
      .filter((m) => m.parentId === '0')
      .sort((a, b) => a.sortNo - b.sortNo);
    return roots
      .map((root) => ({
        id: root.id,
        name: root.menuName,
        children: rawMenus.value
          .filter((m) => m.parentId === root.id && m.path)
          .filter((m) => can(m.permCode))
          .sort((a, b) => a.sortNo - b.sortNo),
      }))
      .filter((g) => g.children.length > 0);
  });

  /**
   * 拉上下文（刷新页面后重建）
   *
   * 只调一个接口：/api/class/me —— 拿 classIds / dataScope / deptCode。
   * 角色和权限码由 @/store/permission 在 App 启动时拉好，这里不重复拉。
   *
   * 拉不到不抛错：降级成「空上下文」让页面仍能显示（后端会独立拦权限）。
   */
  async function loadContext(): Promise<void> {
    token.value = getToken();
    if (!token.value) {
      loaded.value = true;
      return;
    }
    try {
      const meRes = await apiMe();
      meInfo.value = meRes;
      if (meRes.roles?.length) roles.value = meRes.roles;
      dataScope.value = meRes.dataScope ?? 4;
      deptCode.value = meRes.deptCode ?? 2;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[班级] 拉取当前登录人失败，已降级', e);
    } finally {
      loaded.value = true;
    }
  }

  function reset(): void {
    token.value = '';
    meInfo.value = null;
    rawMenus.value = [];
    dataScope.value = 4;
    deptCode.value = 2;
    loaded.value = false;
  }

  /**
   * 首个有权限的路由 path
   *
   * ⚠️ 合并后菜单不在本 store 里了（走 @/config/menu.ts），
   *    所以这里返回空串 —— 由我们自己的路由守卫负责首页跳转。
   */
  function firstPath(): string {
    return '';
  }

  return {
    token,
    meInfo,
    roles,
    dataScope,
    deptCode,
    permCodes,
    loaded,
    isLogin,
    userName,
    userId,
    roleNames,
    scopeName,
    isStudyManager,
    isPrincipal,
    isSuper,
    canApprove,
    isAllScope,
    menuGroups,
    can,
    canAny,
    loadContext,
    reset,
    firstPath,
  };
});
