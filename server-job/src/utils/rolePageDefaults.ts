/**
 * 角色 → 页面 的【默认可见集合】推导（单一事实来源）
 *
 * ============================================================
 * 【这个文件回答一个问题】
 *   「在管理员还没在『页面管理 → 角色模式』里动过手之前，
 *     某个角色本来能看到哪些页面？」
 *
 * 【★★ 2026-10-22 重写：改为**直接读权限树**】
 *   权限树已经改成「板块 → 页面 → 操作」三层（见 perm/config/permTree.ts）：
 *   一个功能点就是**一个页面**。所以「这个角色能看哪些页」这件事，
 *   不再需要「功能点 → menuKey / 页面码」的换算了 —— 直接看它在
 *   该页面下有没有勾到动作即可（任一动作就算是可见）。
 *
 *   旧实现的三段式换算（consultMenusFromPerm / financeMenusFromPerm /
 *   ROLE_PAGE_PERMISSIONS 静态表）全部下线：
 *     · 静态表是「代码里写死 14 个角色」，自建角色永远是 0 页；
 *     · 两套 menuKey 换算表在页面改名/合并后必然与菜单对不上
 *       （2026-10-20 合并板块后就出现过「界面打着勾、实际进不去」）。
 *
 * 【口径：可见 = 该页面下**至少勾了一个动作**】
 *   · 勾了「查看」→ 能看（这是最常见的情形）
 *   · 勾了「新建」但没勾「查看」→ 也算可见（否则勾了却看不到，更奇怪）
 *   · 一个动作都没勾 → 不可见（= 收回这个页面的访问权）
 *
 * 【工作台例外】`/` 是全站首页，任何角色都默认可见（页面管理里也 locked）。
 * ============================================================
 */

import { PERM_TREE } from '../perm/config/permTree';
import {
  loadRoleModuleItems,
  clearRoleModuleItemsCache,
  type ModuleItemsByRole,
} from './roleModuleItems';

export type { ModuleItemsByRole };

/** `moduleKey||pagePath` 形式的可见集合 */
export type RolePagePathSet = Set<string>;

const CACHE_TTL_MS = 15_000;

let defaultCache: { at: number; map: Map<string, RolePagePathSet> } | null = null;

/** 清缓存（角色权限或角色页面改完后调用） */
export function clearRoleDefaultCache(): void {
  clearRoleModuleItemsCache();
  defaultCache = null;
}

/**
 * 某个角色的默认可见页面（`moduleKey||pagePath`）
 *
 * @param roleCode    角色编码（如 TEACH_HEAD）
 * @param _legacyCodes 旧的页面权限码（**已不参与计算**，保留参数只为兼容调用方）
 * @param moduleItems  该角色的功能点清单（权限库 module_key → 功能点名）
 */
export function deriveDefaultPathsFor(
  roleCode: string,
  _legacyCodes: string[],
  moduleItems: Record<string, string[]> | undefined,
): RolePagePathSet {
  const out: RolePagePathSet = new Set();

  for (const board of PERM_TREE) {
    const granted = new Set(moduleItems?.[board.moduleKey] || []);
    for (const page of board.pages) {
      // 工作台恒可见（全站首页，页面管理里也 locked）
      if (board.moduleKey === 'workbench') {
        out.add(`${board.moduleKey}||${page.path}`);
        continue;
      }
      if (granted.has(page.name)) out.add(`${board.moduleKey}||${page.path}`);
    }
  }

  return out;
}

/** 单个角色的默认可见集合（带缓存） */
export async function deriveDefaultPaths(roleCode: string): Promise<RolePagePathSet> {
  if (defaultCache && Date.now() - defaultCache.at < CACHE_TTL_MS) {
    const hit = defaultCache.map.get(roleCode);
    if (hit) return hit;
  }

  const items = await loadRoleModuleItems();
  const set = deriveDefaultPathsFor(roleCode, [], items.get(roleCode));

  const map = defaultCache?.map || new Map<string, RolePagePathSet>();
  map.set(roleCode, set);
  defaultCache = { at: Date.now(), map };
  return set;
}

/** 批量：一次性把多个角色的默认集合都算出来（配置界面用，避免 N 次查询） */
export async function deriveDefaultPathsBatch(
  roleCodes: string[],
): Promise<Map<string, RolePagePathSet>> {
  const items = await loadRoleModuleItems();
  const out = new Map<string, RolePagePathSet>();
  for (const code of roleCodes) {
    out.set(code, deriveDefaultPathsFor(code, [], items.get(code)));
  }
  return out;
}

/** 取某个角色的「权限库功能点」清单（供运行时判定复用） */
export { getRoleModuleItems } from './roleModuleItems';
