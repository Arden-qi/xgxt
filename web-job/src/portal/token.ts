/**
 * 门户 token 工具（合并版 · shim）
 *
 * ⚠️ 2026-10-05 深度单体合并后：
 *   合并前各模块是独立前端（5173/5174/5176），门户（5175）用 iframe 承载，
 *   通过 URL 上的 ?token=xxx&from=portal 把 token 传进来，由各模块的
 *   utils/portal-token.ts 接管并落盘。
 *
 *   合并后【只剩一个前端（5173）、同一个 origin、同一个 localStorage】，
 *   门户登录页是同一个 SPA 里的 /#/login，不再需要 URL 接管。
 *   所以 adoptPortalToken() 变成空操作，只保留 get/clear 供各模块 store 复用。
 *
 * ⚠️ token 键按用户决策【沿用 sms_token】：
 *   与 web-job 原有的 api/request.ts、store/permission.ts 完全一致。
 */

/** 与 web-job 既有代码保持一致的 token 键 */
export const TOKEN_KEY = 'sms_token';
/** 门户下发的「可见模块」缓存键 */
export const MODULES_KEY = 'portal_modules';

/** 读取当前 token（axios 拦截器 / store 用） */
export function getPortalToken(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(TOKEN_KEY) || '';
}

/** 写入 token（门户登录成功后调用） */
export function setPortalToken(token: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(TOKEN_KEY, token);
}

/** 清除登录态（token + 模块缓存一起清，避免残留） */
export function clearPortalToken(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(MODULES_KEY);
}

/**
 * 合并后不再从 URL 接管 token —— 恒返回 false。
 * 保留此函数是为了兼容各模块 stores/auth.ts 的既有调用点，
 * 避免为「删一个已无用的函数」去改多个模块的业务代码。
 */
export function adoptPortalToken(): boolean {
  return false;
}
