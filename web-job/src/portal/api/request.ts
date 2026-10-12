/**
 * 统一请求封装（axios）
 */

import axios, { AxiosError, AxiosInstance } from 'axios';
import { ElMessage } from 'element-plus';
import type { ApiResponse } from 'shared-types/portal';

const CODE = {
  SUCCESS: 200,
  UNAUTHORIZED: 40101,
  TOKEN_EXPIRED: 40102,
  LOGIN_FAILED: 40103,
  ACCOUNT_DISABLED: 40104,
  NO_PERMISSION: 40301,
  NO_OPERATION_PERMISSION: 40302,
};

const instance: AxiosInstance = axios.create({
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

instance.interceptors.request.use((cfg) => {
  const token = localStorage.getItem('sms_token');
  if (token && cfg.headers) {
    cfg.headers.Authorization = `Bearer ${token}`;
  }
  return cfg;
});

instance.interceptors.response.use(
  (res) => {
    const body = res.data as ApiResponse<any>;
    if (body && typeof body.code === 'number' && body.code !== CODE.SUCCESS) {
      ElMessage.error(body.message || '操作失败');
      return Promise.reject(body);
    }
    return body?.data;
  },
  (err: AxiosError<any>) => {
    const status = err.response?.status;
    const body = err.response?.data;

    if (status === 401) {
      ElMessage.error(body?.message || '登录已过期，请重新登录');
      localStorage.removeItem('sms_token');
      setTimeout(() => {
        location.hash = '#/login';
      }, 600);
      return Promise.reject(body || err);
    }
    if (status === 403) {
      ElMessage.error(body?.message || '您没有该操作的权限');
      return Promise.reject(body || err);
    }
    ElMessage.error(body?.message || err.message || '网络异常');
    return Promise.reject(body || err);
  },
);

export const http = {
  get<T>(url: string, params?: any): Promise<T> {
    return instance.get(url, { params }) as unknown as Promise<T>;
  },
  post<T>(url: string, data?: any): Promise<T> {
    return instance.post(url, data) as unknown as Promise<T>;
  },
};

export default instance;
