/**
 * 门户接口
 */

import { http } from './request';
import type {
  SysAccount,
  PortalLoginResult,
  ModuleDef,
} from 'shared-types/portal';

/** 登录 */
export function login(data: { account: string; password: string }): Promise<PortalLoginResult> {
  return http.post<PortalLoginResult>('/api/portal/account/login', data);
}

/** 当前登录人 + 可见模块 */
export function fetchProfile(): Promise<{
  account: SysAccount;
  visibleModules: ModuleDef[];
  landingPath: string;
}> {
  return http.get('/api/portal/account/profile');
}

/** 全部模块注册表 */
export function fetchModules(): Promise<Array<{ key: string; title: string; desc: string }>> {
  return http.get('/api/portal/account/modules');
}

/* ============================================================
 * ⭐ 2026-10-15 新增：登录人【自助修改密码】
 *
 * 走的是门户账号自己的接口（后端按 token 里的 accountId 定位到「我」），
 * 所以【任何角色】登录后都能改自己的密码，不需要额外权限点。
 * ============================================================ */

/** 第一步：校验原密码（错了后端返回「原密码不正确」，不会把登录态踢掉） */
export function verifyMyPassword(password: string): Promise<{ verified: boolean }> {
  return http.post<{ verified: boolean }>('/api/portal/account/verify-password', { password });
}

/** 第二步：确认修改（后端会再复核一次原密码） */
export function changeMyPassword(data: {
  oldPassword: string;
  newPassword: string;
}): Promise<{ synced: boolean }> {
  return http.post<{ synced: boolean }>('/api/portal/account/change-password', data);
}

/* ---- 账号管理（管理员） ----
 *
 * ⚠️⚠️ 2026-10-03 用户指令：
 *   「账号管理和权限管理内的账号管理是同一个功能，权限管理内的账号管理是唯一的，
 *     账号管理删除，功能一致。」
 *
 *   门户侧的账号管理页（AccountManage.vue）已删除，
 *   因此上面那一组账号增删改查接口在本前端不再有调用方。
 *   t_sys_account 两张表仍在后端保留（登录鉴权仍需读它），
 *   但「维护账号」这件事统一收敛到【权限管理 → 账号管理】。
 *
 *   ⚠️ 后端 /api/portal/account/{list,stats,add,update,remove,toggle}
 *      暂未删除 —— 留作后端联调/数据修复的兜底通道。
 *      若后续确认无任何调用方，可连同 portal.ts 的这几个函数一并清理。
 */
