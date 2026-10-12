import { DataScope, RoleCode } from 'shared-types/class';

/**
 * ★ 2026-10-04 并入主包：`AuthUser` 类型**统一用主包那份**
 *
 *   原来本模块自己定义了一份（`classIds` / `token` 必填），和主包的
 *   （`permissions` / `classIds`）对不上 —— 而 `req.user` 是同一个对象，
 *   两套类型会让编译报「不能互相赋值」。
 *
 *   所以这里改成 re-export 主包的类型，本文件只保留**角色判定工具函数**。
 */
export type { AuthUser } from '../../middleware/auth';
import type { AuthUser } from '../../middleware/auth';

/**
 * 拥有全部权限的角色
 * 依据需求：「学管和校长拥有全部权限」
 * 学管 = 教质/学术经理（用户已确认沿用数据字典的角色定义）
 *
 * ★ SUPER_TEST = 万能测试号（2026-10-04 斌哥要，验证业务连通性用）。
 *   本模块所有 requirePerm('class', xxx) 的白名单都是从 FULL_ACCESS_ROLES 拼出来的，
 *   所以加这一条 = 万能测试号在本模块的 10+ 个权限码上全通过。
 *   ⚠️ 它不是真实角色，上线前随 DEV_MODE 一起删。
 */
export const FULL_ACCESS_ROLES: string[] = [
  'SUPER_TEST',
  RoleCode.ADMIN,
  RoleCode.PRINCIPAL,
  RoleCode.QUALITY_MGR,
  RoleCode.ACADEMIC_MGR,
];

/**
 * ★ 2026-10-06：**能写**的全权角色 —— 即 FULL_ACCESS_ROLES 去掉【学管主任】
 *
 * 【为什么要拆开】
 *   学管主任（`RoleCode.QUALITY_MGR`，值就是主系统的 `'TEACH_DEAN'`）
 *   是**审批角色**：业务口径是「退费/休学/退学 → 班主任发起、**学管审批**」，
 *   他除了审批什么都不该动手（建班、交接、录出勤、录成绩、改花名册…）。
 *
 *   但 `permGuard.WRITE_ROLES` 里每个资源都是 `[...FULL_ACCESS_ROLES, ...]`，
 *   学管就被顺带放进了**所有**资源的写白名单 —— 表现是他能建班、能录成绩。
 *
 *   所以：写白名单改用本常量；`FULL_ACCESS_ROLES` 继续服务
 *     · `resolveDataScope()` —— 学管要能看全校数据（数据范围 = ALL）
 *     · `requireApprover()`   —— 审批守卫（学管必须能批）
 *
 *   ⚠️ 后端还有一道更外层的「只读 + 仅审批可写」总闸
 *      （`src/middleware/approvalOnly.ts`，按路径生效、覆盖全部模块）。
 *      两处一起才稳：这里保证"就算总闸被绕过也写不进去"，
 *      总闸保证"没显式登记写白名单的接口也拦得住"。
 */
export const WRITE_FULL_ACCESS_ROLES: string[] = [
  'SUPER_TEST',
  RoleCode.ADMIN,
  RoleCode.PRINCIPAL,
];

/**
 * 只能看自己负责班级的角色
 * 依据需求：「老师只能查看和管理自己负责班级的信息」
 * 用户确认：班主任 / 教员 / 助教 三者都按「本班级」；招生 / 咨询老师按「本人」
 */
export const CLASS_SCOPE_ROLES: string[] = [
  RoleCode.HEAD_TEACHER,
  RoleCode.TEACHER,
  RoleCode.ASSISTANT,
];

/** 只看得到自己数据的角色 */
export const SELF_SCOPE_ROLES: string[] = [RoleCode.RECRUIT, RoleCode.CONSULT];

export function hasAnyRole(user: AuthUser | undefined, roles: string[]): boolean {
  if (!user) return false;
  return user.roles.some((r) => roles.includes(r));
}

/** 是否拥有全部数据权限（学管 / 校长 / 管理员） */
export function isFullAccess(user: AuthUser | undefined): boolean {
  return hasAnyRole(user, FULL_ACCESS_ROLES);
}

/** 是否是学管（教质经理 / 学术经理） */
export function isStudyManager(user: AuthUser | undefined): boolean {
  return hasAnyRole(user, [RoleCode.QUALITY_MGR, RoleCode.ACADEMIC_MGR]);
}

/** 是否是校长 */
export function isPrincipal(user: AuthUser | undefined): boolean {
  return hasAnyRole(user, [RoleCode.PRINCIPAL]);
}

/** 是否是班主任 */
export function isHeadTeacher(user: AuthUser | undefined): boolean {
  return hasAnyRole(user, [RoleCode.HEAD_TEACHER]);
}

/** 根据角色推导数据范围（token 里没给 dataScope 时的兜底） */
export function resolveDataScope(roles: string[], given?: number): DataScope {
  if (given !== undefined && given !== null && given >= 1 && given <= 4) return given as DataScope;
  if (roles.some((r) => FULL_ACCESS_ROLES.includes(r))) return DataScope.ALL;
  if (roles.some((r) => CLASS_SCOPE_ROLES.includes(r))) return DataScope.CLASS;
  if (roles.some((r) => SELF_SCOPE_ROLES.includes(r))) return DataScope.SELF;
  // 默认最保守：只看本人
  return DataScope.SELF;
}
