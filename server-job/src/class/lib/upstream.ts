import { config } from '../config';
/**
 * ★ 2026-10-14：底层 HTTP 从原生 fetch 换成公共 axios 封装（src/shared/http.ts）。
 *   《技术选型表》约定「跨服务调用 = axios」。本文件的改造还顺带删掉了手写的
 *   AbortController 超时、以及「自己判 code≠200」这两段样板 —— 统一封装里已经有了。
 */
import { remoteGet } from '../../shared/http';

/**
 * 跨模块调用（本模块 → 其他模块）
 *
 * 铁律（接口契约规范 6.3）：不许直接读别人的数据库表，必须走 HTTP 接口。
 *  - 所有地址走环境变量（config.services.*），不硬编码
 *  - 超时统一 config.crossModuleTimeout，失败不抛出（通知类调用失败不该拖垮主流程）
 *  - 带简易内存缓存，避免每次审批都打一遍上游
 */

export interface RemoteUser {
  userId: string;
  userName: string;
  roles: string[];
  deptCode: number;
  phone?: string;
}

const CACHE_TTL = 60_000;
const cache = new Map<string, { at: number; value: RemoteUser[] }>();

/**
 * 调登录模块的 internal 接口，拿对象里的 data
 *
 * 语义与改造前逐条一致：
 *   · 失败一律 **不抛出**，只 warn + 返回 null（通知类调用不该拖垮主流程）
 *   · 对方返回 code≠200 → 走「业务失败」这条日志，提示文案用对方给的 message
 *   · 超时/连不上 → 走「调用失败」日志
 *   （axios 版的业务码判断与解包都在统一封装里做了，此处不必再手写）
 */
async function getJson<T>(path: string): Promise<T | null> {
  try {
    return await remoteGet<T>('auth', path, { timeout: config.crossModuleTimeout });
  } catch (e: any) {
    if (e?.payload && typeof e.payload === 'object' && 'code' in e.payload) {
      // eslint-disable-next-line no-console
      console.warn(`[upstream] ${path} 业务失败：${e.payload.message}`);
    } else {
      // eslint-disable-next-line no-console
      console.warn(`[upstream] ${path} 调用失败：${e?.message}`);
    }
    return null;
  }
}

function cached(key: string, loader: () => Promise<RemoteUser[]>): Promise<RemoteUser[]> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return Promise.resolve(hit.value);
  return loader().then((value) => {
    // ⚠️ 只缓存非空结果：上游临时不可用时返回空数组，若把空数组缓存 60s，
    //    这段时间内所有「按角色发通知」都会静默丢失，排查起来非常隐蔽。
    if (value.length) cache.set(key, { at: Date.now(), value });
    else cache.delete(key);
    return value;
  });
}

/** 按角色编码找用户（登录模块的 internal 接口） */
export async function usersByRole(roleCode: string): Promise<RemoteUser[]> {
  return cached(`role:${roleCode}`, async () => {
    const data = await getJson<{ list: RemoteUser[] }>(
      `/api/auth/internal/user/by-role?roleCode=${encodeURIComponent(roleCode)}`,
    );
    return data?.list ?? [];
  });
}

/** 按 userId 批量取用户信息 */
export async function usersByIds(ids: string[]): Promise<RemoteUser[]> {
  const clean = ids.filter(Boolean);
  if (!clean.length) return [];
  return getJson<{ list: RemoteUser[] }>(
    `/api/auth/internal/user/by-ids?ids=${encodeURIComponent(clean.join(','))}`,
  ).then((d) => d?.list ?? []);
}

/** 多个角色一起找人（如「学管」= 教质经理 + 学术经理） */
export async function usersByRoles(roleCodes: string[]): Promise<RemoteUser[]> {
  const groups = await Promise.all(roleCodes.map((r) => usersByRole(r)));
  const map = new Map<string, RemoteUser>();
  for (const g of groups) for (const u of g) map.set(u.userId, u);
  return [...map.values()];
}
