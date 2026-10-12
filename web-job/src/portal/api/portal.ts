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

/* ---- 账号管理（管理员） ----
 *
 * ⚠️⚠️ 2026-10-03 用户指令：
 *   「账号管理和权限管理内的用户管理是同一个功能，权限管理内的用户管理是唯一的，
 *     账号管理删除，功能一致。」
 *
 *   门户侧的账号管理页（AccountManage.vue）已删除，
 *   因此上面那一组账号增删改查接口在本前端不再有调用方。
 *   t_sys_account 两张表仍在后端保留（登录鉴权仍需读它），
 *   但「维护账号」这件事统一收敛到【权限管理 → 用户管理】。
 *
 *   ⚠️ 后端 /api/portal/account/{list,stats,add,update,remove,toggle}
 *      暂未删除 —— 留作后端联调/数据修复的兜底通道。
 *      若后续确认无任何调用方，可连同 portal.ts 的这几个函数一并清理。
 */
