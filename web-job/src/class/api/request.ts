import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import { ElMessage } from 'element-plus';
import type { ApiResponse, PageData } from 'shared-types/class';

/**
 * 统一请求封装
 *
 * 关键约定（《02-接口契约规范》2.1 / 4.3）：
 *  1. **HTTP 状态码恒为 200**，业务结果看 body 里的 `code`。所以这里只解析 body，
 *     不去判断 HTTP 状态；HTTP 非 200 说明服务真的挂了，统一报「网络异常」。
 *  2. `code === 40101 | 40102` → 清 token、跳登录页（"没带门禁卡"）。
 *  3. 其它非 200 的 code → 直接弹 `message`（后端保证 message 是可直接给用户看的中文），
 *     并把错误抛给调用方决定是否额外处理；403xx **不跳**登录页，只弹提示。
 *  4. 每个微服务路径前缀不同，但都经网关（本地是 Vite proxy）转发，前端只用一个 baseURL。
 */

const TOKEN_KEY = 'sms_token';

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) || '';
}
export function setToken(t: string): void {
  localStorage.setItem(TOKEN_KEY, t);
}
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/** 业务错误：把 code 也带上，便于调用方区分「权限不足 / 数据不存在」等情况 */
export class BizError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.name = 'BizError';
    this.code = code;
  }
}

const http = axios.create({
  baseURL: '',
  timeout: 20000,
  headers: { 'Content-Type': 'application/json' },
});

http.interceptors.request.use((cfg) => {
  const t = getToken();
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

/** 登录失效时的统一出口（由 main.ts 注入路由跳转，避免这里直接依赖 router 造成循环引用） */
let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

/** 是否已经弹过「登录失效」，避免并发请求弹一屏提示 */
let unauthorizedNotified = false;

http.interceptors.response.use(
  (resp) => {
    const body = resp.data as ApiResponse<unknown>;
    if (body && typeof body.code === 'number') {
      if (body.code === 200) return body.data as never;
      if (body.code === 40101 || body.code === 40102) {
        clearToken();
        if (!unauthorizedNotified) {
          unauthorizedNotified = true;
          ElMessage.error(body.message || '登录已失效，请重新登录');
          setTimeout(() => (unauthorizedNotified = false), 2000);
        }
        onUnauthorized();
        return Promise.reject(new BizError(body.code, body.message));
      }
      // 其它业务错误：403xx 只弹提示，不跳登录页
      ElMessage.error(body.message || '操作失败');
      return Promise.reject(new BizError(body.code, body.message));
    }
    return resp.data as never;
  },
  (err: AxiosError) => {
    const status = err.response?.status;
    const msg =
      err.code === 'ECONNABORTED'
        ? '请求超时，请稍后重试'
        : status
          ? `服务异常（HTTP ${status}），请稍后重试`
          : '网络连接失败，请检查服务是否已启动';
    ElMessage.error(msg);
    return Promise.reject(new BizError(status ?? 0, msg));
  },
);

/** GET：第二个参数就是 query */
export function get<T>(url: string, params?: Record<string, unknown>, cfg?: AxiosRequestConfig): Promise<T> {
  return http.get(url, { params, ...cfg }) as unknown as Promise<T>;
}
/** POST：body */
export function post<T>(url: string, data?: unknown, cfg?: AxiosRequestConfig): Promise<T> {
  return http.post(url, data, cfg) as unknown as Promise<T>;
}
/** PUT */
export function put<T>(url: string, data?: unknown): Promise<T> {
  return http.put(url, data) as unknown as Promise<T>;
}
/** DELETE */
export function del<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  return http.delete(url, { params }) as unknown as Promise<T>;
}

/** 分页查询的统一参数 */
export interface PageQuery {
  page?: number;
  size?: number;
  [k: string]: unknown;
}

/** 分页返回 */
export type { PageData };

export default http;
