/**
 * 财务管理模块 · 登录与账号契约
 *
 * ⚠️⚠️ 2026-10-02 新增：财务模块补齐登录体系
 *
 * 背景（用户指令）：
 *   「给财务也补录账号，然后系统管理员也能看到财务的模块，
 *    全部糅合到一个系统中……各模块的负责人只能查看自己的模块内容。」
 *
 * 设计要点：
 *   ① 账号主数据放在【统一门户】的 t_sys_account（跨模块）
 *   ② 财务模块本地不再存账号，登录时向门户校验，或直接验门户签发的 JWT
 *   ③ 财务模块内的角色（决定你看得到哪些财务页面）由角色编码决定
 *
 * ⚠️ 角色编码沿用全局 RoleCode（见 enums.ts），不自造。
 */

import { RoleCode } from './enums.js';

/* ============================================================
 * 1. 财务模块内的角色
 * ============================================================ */

/**
 * 财务模块角色编码
 *
 * ⚠️ 这些是「模块内角色」，和统一门户的 kind（sys_admin / module_owner）
 *    是两个层次：
 *      kind        → 能不能进这个模块（门户管）
 *      财务角色    → 进模块后能看哪些财务页面（财务模块管）
 */
export enum FinanceRole {
  /** 财务负责人：全部财务页面 */
  FINANCE_ADMIN = 'finance_admin',
  /** 会计：缴费/退费/账单，不看费用标准配置 */
  FINANCE_ACCOUNTANT = 'finance_accountant',
  /** 出纳：只管退费打款
   *  （保留位：本期未启用账号，先定义好契约） */
  FINANCE_CASHIER = 'finance_cashier',
}

export const FINANCE_ROLE_NAME: Record<string, string> = {
  [FinanceRole.FINANCE_ADMIN]: '财务负责人',
  [FinanceRole.FINANCE_ACCOUNTANT]: '会计',
  [FinanceRole.FINANCE_CASHIER]: '出纳',
};

/**
 * 财务角色 → 可见页面（menuKey 列表）
 *
 * ⚠️⚠️ 这是【单一事实来源】：
 *    - 后端下发 menuKeys 时按它算
 *    - 前端路由守卫按 meta.menuKey 校验
 *    两处都读这一份，就不会出现「菜单有但点进去被踢回」的老问题。
 */
export const FINANCE_ROLE_MENUS: Record<string, string[]> = {
  /** 财务负责人：全开 */
  [FinanceRole.FINANCE_ADMIN]: ['finance', 'fee', 'freeze', 'refund', 'bill', 'standard'],
  /** 会计：不带费用标准配置 */
  [FinanceRole.FINANCE_ACCOUNTANT]: ['finance', 'fee', 'freeze', 'refund', 'bill'],
  /** 出纳：只做出款相关 */
  [FinanceRole.FINANCE_CASHIER]: ['refund'],
};

/**
 * 模块内角色 → 全局 RoleCode（写进 JWT 用）
 *
 * ⚠️ 三方清单第三节要求 token 里的 roles 是全局角色编码，
 *    所以要把财务角色映射过去，不能直接把 'finance_admin' 塞进去。
 */
export const FINANCE_ROLE_TO_ROLE_CODE: Record<string, string> = {
  [FinanceRole.FINANCE_ADMIN]: RoleCode.FINANCE,
  [FinanceRole.FINANCE_ACCOUNTANT]: RoleCode.FINANCE,
  [FinanceRole.FINANCE_CASHIER]: RoleCode.FINANCE,
};

/* ============================================================
 * 2. 财务模块页面 menuKey
 * ============================================================ */

/** 财务模块页面 key（必须与门户 MODULES 里 finance 的 menus 一致） */
export const FINANCE_MENU_MAP: Record<string, { title: string; path: string }> = {
  finance: { title: '财务概览', path: '/finance' },
  fee: { title: '缴费管理', path: '/fee' },
  freeze: { title: '冻结名单', path: '/freeze' },
  refund: { title: '退费管理', path: '/refund' },
  bill: { title: '账单明细', path: '/bill' },
  standard: { title: '费用标准', path: '/standard' },
};

/* ============================================================
 * 3. 登录相关的返回结构
 * ============================================================ */

/** 财务模块的当前登录人（由门户 token 解出 + 财务角色补充） */
export interface FinanceProfile {
  /** 统一账号表主键 */
  accountId: string;
  /** 登录账号 */
  account: string;
  /** 姓名 */
  userName: string;
  /** 统一门户身份（sys_admin / module_owner） */
  kind: string;
  /** 财务模块内角色 */
  financeRole: FinanceRole;
  /** 财务角色中文名 */
  financeRoleName: string;
  /** 可访问的页面 menuKey */
  menuKeys: string[];
  /** 是否有权维护费用标准 */
  canManageStandard: boolean;
}

/** 财务登录结果（走门户校验时，前端直接拿门户结果即可；
 *  保留此结构用于「财务模块独立调试」场景） */
export interface FinanceLoginResult {
  token: string;
  profile: FinanceProfile;
  menuKeys: string[];
}
