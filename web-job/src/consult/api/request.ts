/**
 * 统一请求封装（axios）
 *
 * ⚠️ 这是前端最关键的一个文件！所有接口调用都走这里。
 *
 * 它做四件事：
 *   1. 自动带 token
 *   2. 自动弹出错误提示（不用每个页面都写 try-catch）
 *   3. 401 自动跳登录页，403 只弹提示
 *   4. 自动解包 data，页面里直接拿业务数据
 *
 * 用法：
 *   import { http } from '@/consult/api/request';
 *   const data = await http.get<PageData<StudentListItem>>('/api/consult/student/list', { page: 1 });
 *   // data 就是 { total, page, size, list }
 */

import axios, { AxiosError, AxiosInstance } from 'axios';
import { ElMessage } from 'element-plus';
import type { ApiResponse } from 'shared-types/consult';

/** 业务状态码 */
const CODE = {
  SUCCESS: 200,
  UNAUTHORIZED: 40101,
  TOKEN_EXPIRED: 40102,
  NO_PERMISSION: 40301,
  NO_OPERATION_PERMISSION: 40302,
};

const instance: AxiosInstance = axios.create({
  timeout: 30000,     // ★ 2026-10-09：15s → 30s，单体自调用链慢时 15s 容易误报超时
  headers: { 'Content-Type': 'application/json' },
});

/* ============================================================
 * 请求拦截器：自动带 token
 * ============================================================ */

instance.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('sms_token');
    if (token) {
      // ⚠️ 统一的 Header 名：Authorization: Bearer xxx
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

/* ============================================================
 * 响应拦截器：统一处理错误
 *
 * ⚠️ 注意：拦截器里只做「错误拦截」，不做「结果替换」。
 *    解包 data 的工作交给下面的 http.get/post 做。
 *    这样类型更清晰，也不容易出错。
 * ============================================================ */

instance.interceptors.response.use(
  (response) => {
    const body = response.data as ApiResponse<any>;

    // ---- 业务成功：原样返回，让 http.xxx 去解包 ----
    if (body.code === CODE.SUCCESS) {
      return response;
    }

    // ---- 未登录 / token 过期 → 跳登录页 ----
    if (body.code === CODE.UNAUTHORIZED || body.code === CODE.TOKEN_EXPIRED) {
      ElMessage.error('登录已过期，请重新登录');
      localStorage.removeItem('sms_token');
      if (!location.hash.includes('/login')) {
        location.href = '/#/login';
      }
      return Promise.reject(body);
    }

    // ---- 无权限 → 只弹提示，不跳登录页！ ----
    if (body.code === CODE.NO_PERMISSION || body.code === CODE.NO_OPERATION_PERMISSION) {
      ElMessage.warning(body.message || '您没有该操作的权限');
      return Promise.reject(body);
    }

    // ---- 其他业务错误 → 红色提示 ----
    ElMessage.error(body.message || '操作失败');
    return Promise.reject(body);
  },

  (error: AxiosError) => {
    // ---- HTTP 层错误（网络问题、服务没启动）----
    let msg = '请求失败，请稍后重试';

    if (error.code === 'ECONNABORTED') {
      msg = '请求超时，请检查网络或服务是否正常';
    } else if (error.response) {
      const status = error.response.status;
      if (status === 401) msg = '请先登录';
      else if (status === 403) msg = '您没有该操作的权限';
      else if (status === 404) msg = '接口不存在，请检查路径';
      else if (status === 500) msg = '服务器出错了，请联系后端同学';
      else if (status === 502 || status === 504) {
        msg = '后端服务未启动或无法连接（请检查服务是否已启动）';
      }
    } else if (error.request) {
      msg = '无法连接到服务器，请检查后端服务是否启动';
    }

    ElMessage.error(msg);
    console.error('[请求失败]', error.config?.method?.toUpperCase(), error.config?.url, error.message);
    return Promise.reject(error);
  },
);

/* ============================================================
 * 对外的请求方法（自动解包 data）
 *
 * ⚠️ 泛型 T 写的是「data 里的类型」，不是整个响应
 *    例：http.get<PageData<StudentListItem>>(...) → 返回 PageData<StudentListItem>
 * ============================================================ */

export const http = {
  async get<T = any>(url: string, params?: Record<string, any>): Promise<T> {
    const res = await instance.get<ApiResponse<T>>(url, { params });
    return res.data.data;
  },

  async post<T = any>(url: string, data?: any): Promise<T> {
    const res = await instance.post<ApiResponse<T>>(url, data);
    return res.data.data;
  },

  async put<T = any>(url: string, data?: any): Promise<T> {
    const res = await instance.put<ApiResponse<T>>(url, data);
    return res.data.data;
  },

  async delete<T = any>(url: string, params?: Record<string, any>): Promise<T> {
    const res = await instance.delete<ApiResponse<T>>(url, { params });
    return res.data.data;
  },
};

/** 需要拿到完整响应（含 message）时用这个 */
export const raw = instance;

export default instance;
