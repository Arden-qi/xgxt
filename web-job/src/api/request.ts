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
 *   import { http } from '@/api/request';
 *   const data = await http.get<PageData<StudentListItem>>('/api/consult/student/list', { page: 1 });
 *   // data 就是 { total, page, size, list }
 */

import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from 'axios';
import { ElMessage } from 'element-plus';
import type { ApiResponse } from 'shared-types';

/** 业务状态码 */
const CODE = {
  SUCCESS: 200,
  UNAUTHORIZED: 40101,
  TOKEN_EXPIRED: 40102,
  NO_PERMISSION: 40301,
  NO_OPERATION_PERMISSION: 40302,
};

/**
 * 当前用户是不是「只读」（系统管理员 / 学管主任）
 *
 *   · 系统管理员 —— 纯只读（连审批都不能）
 *   · 学管主任   —— 只读 + **仅审批可写**（同意/驳回/接收放行）
 *
 * ⚠️ 为什么用模块变量，而不是从 store/permission.ts import 一个 computed：
 *    store/permission.ts 会 import 本文件（用 http 拉权限）——
 *    本文件再反向 import 它就成了**循环依赖**，运行时会拿到 undefined。
 *    所以反过来：由 permission.ts 拉到权限后调 setReadOnlyState() 把结果推过来。
 *
 * ⚠️ 这里只是「提前拦 + 友好提示」，**不是安全边界**。
 *    真正的拦截在后端（app.ts 的只读总闸 + middleware/approvalOnly.ts）。
 */
let _readOnly = false;
/** 被拦下时给用户看的提示语 */
let _readOnlyReason = '';
/** 只读用户里，谁能继续执行"审批动作"（学管主任 true，管理员 false） */
let _readOnlyAllowApproval = false;

/**
 * 审批动作的路径特征 —— 与后端 `middleware/approvalOnly.ts` 保持同一口径：
 * 以 `/approve` `/reject` `/receive` `/refuse` 结尾。
 * ⚠️ 故意**不含** `withdraw`（撤回）与 `cancel`（撤销）—— 那是申请人的动作。
 */
const APPROVAL_ACTION_RE = /\/(approve|reject|receive|refuse)(\/)?$/i;

/** 由 store/permission.ts 在权限加载完成后调用 */
export function setReadOnlyState(readonly: boolean, reason = '', allowApproval = false): void {
  _readOnly = readonly;
  _readOnlyReason = reason;
  _readOnlyAllowApproval = allowApproval;
}

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

    // ⭐ 只读用户（管理员 / 学管主任）：写操作直接拦在前端，请求根本不发出去
    //    —— 这样用户看到的是「友好提示」，而不是后端返回的 403 红字
    const method = (config.method || 'get').toLowerCase();
    if (method !== 'get' && _readOnly) {
      // ★ 2026-10-06：学管主任的**审批动作**要放行（同意/驳回/接收）
      const url = (config.url || '').split('?')[0];
      if (_readOnlyAllowApproval && APPROVAL_ACTION_RE.test(url)) {
        return config;
      }
      ElMessage.warning(_readOnlyReason || '当前账号只能查看，不能执行新增 / 修改 / 删除');
      return Promise.reject(new Error('READ_ONLY'));
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

    // ---- 未登录 / token 过期 → 跳统一登录页 ----
    if (body.code === CODE.UNAUTHORIZED || body.code === CODE.TOKEN_EXPIRED) {
      ElMessage.error('登录已过期，请重新登录');
      localStorage.removeItem('sms_token');
      // ★ 2026-10-05 合并：全系统统一登录页 /#/login（原 /dev-login 已删除）
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

/**
 * ★ 2026-10-03：三个写方法都补了第 3 个参数 `config`（可选）。
 *   原因：合并进来的「教务」模块要用它传 `multipart/form-data` 头 + 更长的 timeout
 *   （上传 Excel / 缴费截图 OCR）。原有 2 参数的调用完全不受影响。
 */
export const http = {
  async get<T = any>(
    url: string,
    params?: Record<string, any>,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    const res = await instance.get<ApiResponse<T>>(url, { params, ...config });
    return res.data.data;
  },

  async post<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    const res = await instance.post<ApiResponse<T>>(url, data, config);
    return res.data.data;
  },

  async put<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    const res = await instance.put<ApiResponse<T>>(url, data, config);
    return res.data.data;
  },

  async delete<T = any>(
    url: string,
    params?: Record<string, any>,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    const res = await instance.delete<ApiResponse<T>>(url, { params, ...config });
    return res.data.data;
  },
};

/** 需要拿到完整响应（含 message）时用这个 */
export const raw = instance;

export default instance;
