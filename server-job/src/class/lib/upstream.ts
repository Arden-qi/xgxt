import { config } from '../config';

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

interface ApiResp<T> {
  code: number;
  message: string;
  data: T | null;
}

async function getJson<T>(url: string): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.crossModuleTimeout);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    const body = (await r.json()) as ApiResp<T>;
    if (body.code !== 200) {
      // eslint-disable-next-line no-console
      console.warn(`[upstream] ${url} 业务失败：${body.message}`);
      return null;
    }
    return body.data;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[upstream] ${url} 调用失败：${(e as Error).message}`);
    return null;
  } finally {
    clearTimeout(timer);
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

/** 按角色编码找用户（登录模块 8001 的 internal 接口） */
export async function usersByRole(roleCode: string): Promise<RemoteUser[]> {
  return cached(`role:${roleCode}`, async () => {
    const data = await getJson<{ list: RemoteUser[] }>(
      `${config.services.auth}/api/auth/internal/user/by-role?roleCode=${encodeURIComponent(roleCode)}`,
    );
    return data?.list ?? [];
  });
}

/** 按 userId 批量取用户信息 */
export async function usersByIds(ids: string[]): Promise<RemoteUser[]> {
  const clean = ids.filter(Boolean);
  if (!clean.length) return [];
  return getJson<{ list: RemoteUser[] }>(
    `${config.services.auth}/api/auth/internal/user/by-ids?ids=${encodeURIComponent(clean.join(','))}`,
  ).then((d) => d?.list ?? []);
}

/** 多个角色一起找人（如「学管」= 教质经理 + 学术经理） */
export async function usersByRoles(roleCodes: string[]): Promise<RemoteUser[]> {
  const groups = await Promise.all(roleCodes.map((r) => usersByRole(r)));
  const map = new Map<string, RemoteUser>();
  for (const g of groups) for (const u of g) map.set(u.userId, u);
  return [...map.values()];
}
