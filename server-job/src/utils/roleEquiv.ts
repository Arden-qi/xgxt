/**
 * ⭐ 自建角色的「等价内置角色」加载器
 *
 * ============================================================
 * 【解决什么问题】
 * ============================================================
 *   全系统的角色判定（审批链谁能发起/审批、按钮能不能点）写的是
 *   **主包内置角色码**（`PROJECT_MANAGER`、`TEACH_HEAD` …）。
 *   而用户在**权限管理里自建**的角色（如 `XMJL_000`「项目经理2」）
 *   不在主包枚举里 —— 于是：
 *
 *     · 页面看得见（页面可见性已由「功能点推导」打通）
 *     · 但一提交业务单据就 **40302 无权限**（`canInitiate` 恒 false）
 *
 *   本轮实测复现：实训项目经理（`XMJL_000`）发不起退费申请。
 *
 * ============================================================
 * 【怎么解决】
 * ============================================================
 *   权限库 `sms_perm.t_perm_role` 有一列 `equiv_role_code`：
 *   建角色时声明「我等价于哪个内置角色」。
 *
 *   本模块负责把这张表读出来，灌进 `shared-types` 的
 *   `registerEquivalentRoles()` —— 之后所有 `hasRole()` /
 *   `normalizeRoles()` 都会自动把自建角色并入对应内置角色，
 *   **业务代码一行都不用改**。
 *
 * ============================================================
 * 【为什么单独一个文件】
 * ============================================================
 *   `roleAlias.ts` 在 `shared-types`（纯类型包，不能查数据库），
 *   而「查权限库」是 server-job 的职责。所以桥接点放在这里，
 *   依赖方向：shared-types（纯逻辑）← server-job（查库 + 注入）。
 *
 * ⚠️ 缓存策略：15 秒 TTL，与 `roleModuleItems.ts` 保持一致。
 *    管理员在权限管理里改了「等价角色」，最慢 15 秒生效。
 *    要立即生效可调 `clearRoleEquivCache()`。
 *
 * ⚠️ 失败策略：查库失败**不抛错**，而是注册**空表**。
 *    理由：宁可让自建角色暂时不生效（安全侧失败），
 *    也不能让「权限判定」因为一次数据库抖动而整站 500。
 *    ⚠️ 注意这里是「注册空表」而不是「跳过」—— 必须清掉上一轮数据，
 *       否则管理员撤销了等价声明，缓存的旧数据仍会放行（越权）。
 */

import { registerEquivalentRoles } from 'shared-types';
import { db } from './db';

/** 缓存 TTL（毫秒） */
const TTL_MS = 15_000;

let cache: { data: Record<string, string>; at: number } | null = null;
/** 并发去重：多个请求同时发现缓存过期时，只发一次查询 */
let inflight: Promise<Record<string, string>> | null = null;

/**
 * 真正去权限库查「自建角色 → 内置角色」映射
 *
 * 只取满足这些条件的行：
 *   · 未逻辑删除
 *   · 有声明 `equiv_role_code`
 *   · 角色是启用的（停用角色的声明不该生效）
 */
async function fetchEquivMap(): Promise<Record<string, string>> {
  try {
    const rows = await db('sms_perm.t_perm_role')
      .where('is_deleted', false)
      .where('role_status', '启用')
      .whereNotNull('equiv_role_code')
      .whereNot('equiv_role_code', '')
      .select('role_code', 'equiv_role_code');

    const map: Record<string, string> = {};
    for (const r of rows as Array<{ role_code: string; equiv_role_code: string }>) {
      const custom = String(r.role_code || '').trim();
      const builtin = String(r.equiv_role_code || '').trim();
      if (custom && builtin) map[custom] = builtin;
    }
    return map;
  } catch {
    /**
     * ⚠️ 查库失败 → 返回空表（而不是抛出）。
     *    上层会把空表注册进去，等于「暂无任何等价声明」。
     *    这是**安全侧失败**：自建角色暂时不生效，但绝不会误放行。
     */
    return {};
  }
}

/**
 * 确保动态等价表已加载并注册进 `shared-types`
 *
 * ⚠️ 这个函数**必须在任何角色判定之前**调用。
 *    典型接入点：鉴权中间件（解析出 roles 之后）、审批链判定入口。
 *    它是一个 no-op（命中缓存时），可以放心高频调用。
 */
export async function ensureRoleEquivLoaded(): Promise<void> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) {
    // 命中缓存：重新注册一次（幂等，成本极低）
    registerEquivalentRoles(cache.data);
    return;
  }

  if (!inflight) {
    inflight = fetchEquivMap().finally(() => {
      inflight = null;
    });
  }
  const data = await inflight;
  cache = { data, at: Date.now() };
  registerEquivalentRoles(data);
}

/**
 * 清缓存（管理员改完角色配置后可调，让下次请求立即重查）
 */
export function clearRoleEquivCache(): void {
  cache = null;
  // 同时清掉已注册的，避免「缓存清了但内存里还留着旧映射」
  registerEquivalentRoles({});
}

/**
 * 供自检/调试：直接取当前映射（会触发一次加载）
 */
export async function getEquivalentRoleMap(): Promise<Record<string, string>> {
  await ensureRoleEquivLoaded();
  return cache?.data || {};
}
