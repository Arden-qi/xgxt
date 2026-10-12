/**
 * 财务模块接口（登录人信息）
 *
 * ⚠️ 财务模块【没有登录接口】—— 登录统一走门户（5175）。
 *    这里只问后端「我是谁、我在财务模块里什么角色、能看哪些页」。
 */

import { http } from './request';
import type { FinanceProfile } from 'shared-types/finance';

/** 当前登录人 + 财务角色 + 可访问页面 */
export function fetchProfile(): Promise<{ profile: FinanceProfile; menuKeys: string[] }> {
  return http.get('/api/finance/auth/profile');
}

/** 仅菜单（侧栏用，轻量） */
export function fetchMenus(): Promise<{ menuKeys: string[] }> {
  return http.get('/api/finance/auth/menus');
}
