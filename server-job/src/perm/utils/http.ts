/**
 * 跨模块 HTTP 客户端（axios 统一封装）
 * ════════════════════════════════════════════════════════════
 *
 * 【为什么要有这个文件】
 *   7 个模块（8001~8007）是各自独立进程，权限模块在有些场景下需要
 *   「调别的模块拿数据」，例如：
 *     · 拿登录模块的账号档案（角色 / 权限 / 数据范围）
 *     · 排查「谁的模块没起来」时探活
 *   如果每个调用点都自己 axios.get(...)，会出现：
 *     ✗ 超时时间各写各的（有的 3 秒有的 30 秒）
 *     ✗ 有的解包了 data、有的没解包，调用方写法不统一
 *     ✗ 别人的模块挂了，报出来的是 "ECONNREFUSED" 这种天书
 *   所以这里统一封装一个客户端 + 统一拦截错误，把这个坑一次性堵掉。
 *
 * 【与前端 axios 封装的关系】
 *   《技术选型表》里「跨服务调用 axios」注明「同上」，
 *   即与 web-perm/src/api/request.ts 是同一套思路：
 *     · 统一 baseURL 来源（config.services，从 .env 读，不硬编码）
 *     · 请求拦截：注入链路 ID（X-Trace-Id）+ 透传 token
 *     · 响应拦截：解包 {code,message,data}，非 200 直接抛业务错
 *
 * 【错误怎么走】
 *   抛出的 RemoteError 继承自全局的 BizError，
 *   所以会被 middleware/errorHandler.ts 接住，自动变成 {code,message,data}，
 *   调用方不用写 try/catch 去拼错误响应。
 * ════════════════════════════════════════════════════════════
 */

import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';
import { randomUUID } from 'crypto';
import { BizCode } from 'shared-types/perm';
import { config } from '../config';
import { BizError } from '../middleware/errorHandler';

/** 七个兄弟模块的简称，与 config.services 的 key 一一对应 */
export type ModuleName = keyof typeof config.services;

/** 模块中文名（写日志、报错文案用，让提示能直接看懂） */
export const MODULE_LABEL: Record<string, string> = {
  auth: '登录与市场咨询(8001)',
  edu: '教务管理(8002)',
  class: '班级管理(8003)',
  job: '就业管理(8004)',
  finance: '财务管理(8005)',
  perm: '权限管理(8006)',
  stat: '统计报表(8007)',
};

/** 单个模块的基础地址 */
export function moduleUrl(module: ModuleName): string {
  return config.services[module] || '';
}

export interface RemoteOptions {
  /** 超时毫秒数，默认 5000。探活用 2000，正常业务调用 5000 足够 */
  timeout?: number;
  /** 失败重试次数（仅对「超时 / 连不上」这类可恢复错误生效），默认 0 */
  retries?: number;
  /** 透传的 Authorization 头（形如 'Bearer xxx'） */
  forwardAuth?: string;
  /** 链路 ID，不传自动生成；同一条链路建议传同一个 */
  traceId?: string;
  /** 额外请求头 */
  headers?: Record<string, string>;
  /** 查询串参数 */
  params?: Record<string, unknown>;
  /** 请求体（POST/PUT 用） */
  body?: unknown;
}

/**
 * 跨模块调用失败
 *
 * ⚠️ 继承 BizError → 走到全局错误中间件即可输出统一响应，
 *    调用方无需自己拼 {code,message,data}。
 */
export class RemoteError extends BizError {
  module: ModuleName;
  /** 底层原始错误码（ECONNREFUSED / ETIMEDOUT / HTTP 500 ...），排查用 */
  detail: string;

  constructor(
    module: ModuleName,
    message: string,
    detail = '',
    code: BizCode = BizCode.INTERNAL_ERROR,
  ) {
    super(code, message);
    this.name = 'RemoteError';
    this.module = module;
    this.detail = detail;
  }
}

/**
 * 把 axios 的各种失败形态，翻译成一句能直接看懂的中文
 *
 * 这是「统一拦截错误」的核心 —— 不翻译的话，
 * 调用方拿到的是 "connect ECONNREFUSED 127.0.0.1:8002" 这种东西。
 */
function mapAxiosError(module: ModuleName, err: AxiosError): RemoteError {
  const label = MODULE_LABEL[module] || module;
  const raw = err.code || '';

  // ---- 1. 超时 ----
  if (raw === 'ECONNABORTED' || raw === 'ETIMEDOUT') {
    return new RemoteError(module, `${label} 响应超时，请确认该模块是否卡住`, raw);
  }

  // ---- 2. 连不上（对方没启动 / 地址填错）----
  if (raw === 'ECONNREFUSED' || raw === 'ENOTFOUND' || raw === 'EAI_AGAIN' || raw === 'EHOSTUNREACH') {
    return new RemoteError(module, `无法连接 ${label}，请确认该模块已启动`, raw);
  }

  // ---- 3. 对方返回了非 2xx ----
  const status = err.response?.status;
  const payload: any = err.response?.data;

  // 对方也是本系统的模块 → 响应体里有我们的统一结构，直接把 message 带出来
  if (payload && typeof payload === 'object' && payload.message) {
    return new RemoteError(
      module,
      `${label} 返回错误：${payload.message}`,
      `HTTP ${status}`,
      (payload.code as BizCode) || BizCode.INTERNAL_ERROR,
    );
  }

  if (status === 401) {
    return new RemoteError(module, `${label} 拒绝了本次调用（未登录）`, 'HTTP 401', BizCode.UNAUTHORIZED);
  }
  if (status === 403) {
    return new RemoteError(
      module,
      `${label} 拒绝了本次调用（无权限）`,
      'HTTP 403',
      BizCode.NO_OPERATION_PERMISSION,
    );
  }
  if (status) {
    return new RemoteError(module, `${label} 返回 HTTP ${status}`, `HTTP ${status}`);
  }

  // ---- 4. 其他（DNS / 证书 / 被中断……）----
  return new RemoteError(module, `调用 ${label} 失败：${err.message}`, raw);
}

/** 已创建的客户端缓存（每个模块一个实例，复用连接池） */
const clients = new Map<ModuleName, AxiosInstance>();

/** 取（或惰性创建）某模块的 axios 实例 */
function clientOf(module: ModuleName): AxiosInstance {
  const cached = clients.get(module);
  if (cached) return cached;

  const instance = axios.create({
    baseURL: moduleUrl(module),
    timeout: 5000,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    /**
     * ⚠️⚠️ 必须显式关掉代理！（2026-09-30 实测踩坑）
     *
     * Node 版的 axios 会**自动读取环境变量** HTTP_PROXY / HTTPS_PROXY / NO_PROXY，
     * 把请求转发给代理。开发机上只要装了 Clash / 公司网络代理 / 各种加速工具，
     * 这些变量基本都会存在。
     *
     * 后果非常隐蔽：调本机 8002 端口，请求被送进代理，
     * 代理连不上内网地址 → 一直等到超时，报出来的是「响应超时」，
     * 让人以为是对方模块卡死了，查半天查不到原因。
     * （实测：默认配置报 ECONNABORTED timeout；
     *   加 proxy:false 后立刻正确报 ECONNREFUSED，一眼看出是「对方没启动」。）
     *
     * 模块之间的调用是内网直连，永远不该走 HTTP 代理，所以无条件关掉。
     */
    proxy: false,
  });

  /* ---------- 请求拦截：注入链路 ID + 透传 token ---------- */
  instance.interceptors.request.use((cfg: InternalAxiosRequestConfig) => {
    const traceId = (cfg as any).__traceId || randomUUID();
    cfg.headers.set('X-Trace-Id', traceId);
    // 跨模块调用也带上调用方身份，方便对方模块做鉴权
    if (!cfg.headers.get('Authorization')) {
      const inherited = (cfg as any).__auth;
      if (inherited) cfg.headers.set('Authorization', inherited);
    }
    return cfg;
  });

  /* ---------- 响应拦截：解包 + 抛业务错 ---------- */
  instance.interceptors.response.use(
    (resp) => {
      const body: any = resp.data;
      // 假如对方是本系统模块，响应体一定是 {code,message,data}
      if (body && typeof body === 'object' && 'code' in body) {
        if (Number(body.code) !== Number(BizCode.SUCCESS)) {
          throw new RemoteError(
            module,
            `${MODULE_LABEL[module] || module} 返回业务错误：${body.message}`,
            `code=${body.code}`,
            (body.code as BizCode) || BizCode.INTERNAL_ERROR,
          );
        }
        // 解包：调用方直接拿到 data，不用自己 .data.data
        resp.data = body.data;
      }
      return resp;
    },
    (err: AxiosError) => Promise.reject(mapAxiosError(module, err)),
  );

  clients.set(module, instance);
  return instance;
}

/** 是否值得重试（只重试「超时 / 连不上」这类瞬时故障） */
function isRetriable(err: unknown): boolean {
  if (!(err instanceof RemoteError)) return false;
  return /超时|无法连接|失败/.test(err.message);
}

/**
 * 发起一次跨模块请求（底层入口）
 *
 * @param module 目标模块简称
 * @param method HTTP 方法
 * @param url    目标路径，如 '/health'、'/api/auth/profile'
 * @param opts   超时 / 重试 / 透传 token 等
 * @returns 已解包的 data（对方的 {code,message,data} 里那个 data）
 * @throws RemoteError
 */
export async function remoteRequest<T = any>(
  module: ModuleName,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
  url: string,
  opts: RemoteOptions = {},
): Promise<T> {
  const {
    timeout = 5000,
    retries = 0,
    forwardAuth,
    traceId = randomUUID(),
    headers = {},
    params,
    body,
  } = opts;

  const client = clientOf(module);
  const cfg: any = {
    method,
    url,
    timeout,
    params,
    headers: { ...headers, 'X-Trace-Id': traceId },
    __traceId: traceId,
    __auth: forwardAuth,
  };
  if (forwardAuth) cfg.headers.Authorization = forwardAuth;
  if (body !== undefined) cfg.data = body;

  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const started = Date.now();
    try {
      const resp = await client.request<T>(cfg);
      console.log(
        `[remote] ${module} ${method} ${url} → 成功 ${Date.now() - started}ms (trace=${traceId.slice(0, 8)})`,
      );
      return resp.data as T;
    } catch (e: any) {
      lastErr = e;
      const cost = Date.now() - started;
      if (attempt < retries && isRetriable(e)) {
        const wait = 200 * Math.pow(2, attempt); // 200ms → 400ms → 800ms
        console.warn(
          `[remote] ${module} ${method} ${url} → 第 ${attempt + 1} 次失败(${cost}ms)，${wait}ms 后重试：${e.message}`,
        );
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      console.warn(`[remote] ${module} ${method} ${url} → 失败 ${cost}ms：${e.message}`);
      break;
    }
  }

  throw lastErr;
}

/** 便捷方法：GET */
export function remoteGet<T = any>(
  module: ModuleName,
  url: string,
  opts?: RemoteOptions,
): Promise<T> {
  return remoteRequest<T>(module, 'GET', url, opts);
}

/** 便捷方法：POST */
export function remotePost<T = any>(
  module: ModuleName,
  url: string,
  body?: unknown,
  opts?: RemoteOptions,
): Promise<T> {
  return remoteRequest<T>(module, 'POST', url, { ...(opts || {}), body });
}
