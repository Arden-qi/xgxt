/**
 * 角色「已授权操作码」读取（按权限树逐条换算）
 *
 * ============================================================
 * 【解决什么问题】
 *   前端要判断「这个按钮该不该给我看」，需要一个**操作码**，比如
 *   `perm:职位管理:add`。已有的两份数据都不够用：
 *
 *     · `roleModuleItems.ts` → 只有「功能点名」，没有动作
 *       （知道他有「职位管理」，不知道他能不能「新建」）
 *     · `pagePermissionSource.ts` 的 ROLE_OPERATION_PERMISSIONS → 静态写死的表，
 *       只覆盖 job/edu/class 那几套老编码，没有 perm / consult / finance
 *
 *   所以这里直接从 `t_perm_role_perm` 把 (模块, 功能点, 动作) 三元组读出来，
 *   再用权限树的 `PERM_TREE_ACTION_OPS` 换算成操作码。
 *   —— 权限树是单一事实来源，管理员在界面上勾什么，这里就吐什么。
 *
 * 【与 roleActionOverlay 的分工】
 *   roleActionOverlay 算的是「相对基线的**差异**」（只关心管理员改过什么），
 *   用于在旧的角色默认之上做增量收窄；
 *   本文件算的是「**全量**已授权操作码」，用于新建的判权点（如权限模块自己的按钮）。
 *   两者不冲突：差异层管"收窄"，本文件管"白名单"。
 *
 * ⚠️ 降级：查库失败 → 返回空 Map（等于"没授权任何操作"），
 *    由调用方决定是否要放行（页面级菜单不受影响，仍有自己的白名单）。
 * ============================================================
 */

import { db } from '../perm/utils/db';
import { PERM_TREE_ACTION_OPS } from '../perm/config/permTree';

const CACHE_TTL_MS = 15_000;

let cache: { at: number; map: Map<string, Set<string>> } | null = null;

/** 清缓存（角色权限被保存后调用，保证即时生效） */
export function clearRoleGrantedOpsCache(): void {
  cache = null;
}

/**
 * 读全部角色的已授权操作码（带 15 秒内存缓存）
 *
 * @param force 强制刷新（忽略缓存）
 */
export async function loadRoleGrantedOps(force = false): Promise<Map<string, Set<string>>> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.map;
  }

  const map = new Map<string, Set<string>>();
  try {
    const rows = await db('t_perm_role as r')
      .join('t_perm_role_perm as rp', 'rp.role_id', 'r.id')
      .where('r.is_deleted', false)
      .andWhere('rp.is_deleted', false)
      .select(
        'r.role_code as roleCode',
        'rp.module_key as moduleKey',
        'rp.item_name as itemName',
        'rp.action_code as actionCode',
      );

    for (const row of rows as any[]) {
      const roleCode = String(row.roleCode || '');
      const moduleKey = String(row.moduleKey || '');
      const itemName = String(row.itemName || '');
      const actionCode = String(row.actionCode || '');
      if (!roleCode || !moduleKey || !itemName || !actionCode) continue;

      // `模块||功能点` → { 动作 → 操作码[] }
      const itemOps = PERM_TREE_ACTION_OPS[`${moduleKey}||${itemName}`];
      if (!itemOps) continue;
      const codes = itemOps[actionCode];
      if (!codes || !codes.length) continue;

      let set = map.get(roleCode);
      if (!set) {
        set = new Set<string>();
        map.set(roleCode, set);
      }
      codes.forEach((c) => set!.add(c));
    }
  } catch {
    cache = { at: Date.now(), map: new Map() };
    return cache.map;
  }

  cache = { at: Date.now(), map };
  return map;
}

/**
 * 取「这些角色合并后」的已授权操作码
 *
 * @param roles 角色编码数组（如 ['SYS_ADMIN'] / ['MKT_CONSULT']）
 * @param prefix 只保留某个前缀的码（如 'perm:'），不传则全给
 */
export async function grantedOpsOfRoles(roles: string[], prefix?: string): Promise<string[]> {
  const map = await loadRoleGrantedOps();
  const out = new Set<string>();
  for (const role of roles || []) {
    const set = map.get(String(role));
    if (!set) continue;
    set.forEach((c) => {
      if (!prefix || c.startsWith(prefix)) out.add(c);
    });
  }
  return Array.from(out);
}
