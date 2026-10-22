/**
 * 角色的「权限库功能点」读取（**最底层**，无反向依赖）
 *
 * ============================================================
 * 【为什么单独一个文件】
 *   `rolePageDefaults.ts` 与 `pagePermissionSource.ts` **都要**用这份数据：
 *     · rolePageDefaults   → 推导「默认可见页面」（配置界面初始勾选）
 *     · pagePermissionSource → 运行时真闸 getUserPagePermissions
 *   而 rolePageDefaults **已经** import 了 pagePermissionSource
 *   （要拿 getRolePagePermissions）—— 若反过来在 pagePermissionSource 里
 *   import rolePageDefaults，就会形成**循环依赖**，运行时 `getRoleModuleItems`
 *   会是 undefined（ESM/CJS 循环引用的经典坑）。
 *
 *   所以把这份「只读权限库、不依赖任何别的东西」的能力下沉到本文件，
 *   两个上层文件都从这里取 → 依赖变成单向，彻底消除环。
 *
 * 【数据来源】
 *   `sms_perm.t_perm_role` JOIN `t_perm_role_perm`，按 role_code 聚合出
 *   `{ module_key: [item_name, ...] }`。这正是管理员在「职位权限分配」
 *   界面上勾选的原始记录 —— 也是自建角色唯一的授权来源。
 *
 * ⚠️ 降级原则：查库失败 → 返回空 Map（当作「没有任何功能点」），
 *    绝不能让权限表抖一下就把所有人的页面清空。
 * ============================================================
 */

import { db } from '../perm/utils/db';
// ★ 2026-10-22 旧版权限树功能点名 → 新树页面名 的兼容翻译（纯配置，不引 db，不产生环）
import { canonicalItemKeys } from '../perm/config/permTreeLegacy';

/** 角色编码 → 权限库 module_key → 功能点名数组 */
export type ModuleItemsByRole = Map<string, Record<string, string[]>>;

const CACHE_TTL_MS = 15_000;

let cache: { at: number; map: ModuleItemsByRole } | null = null;

/** 清缓存（角色权限变更后调用） */
export function clearRoleModuleItemsCache(): void {
  cache = null;
}

/**
 * 读全部角色的功能点清单（带 15 秒内存缓存）。
 *
 * @param force 强制刷新（忽略缓存）
 */
export async function loadRoleModuleItems(force = false): Promise<ModuleItemsByRole> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.map;
  }

  const map: ModuleItemsByRole = new Map();
  try {
    const rows = await db('t_perm_role as r')
      .join('t_perm_role_perm as rp', 'rp.role_id', 'r.id')
      .where('r.is_deleted', false)
      .andWhere('rp.is_deleted', false)
      .select('r.role_code as roleCode', 'rp.module_key as moduleKey', 'rp.item_name as itemName');

    for (const row of rows as any[]) {
      const code = String(row.roleCode || '');
      const mod = String(row.moduleKey || '');
      const item = String(row.itemName || '');
      if (!code || !mod || !item) continue;

      let items = map.get(code);
      if (!items) {
        items = {};
        map.set(code, items);
      }

      /**
       * ★★ 2026-10-22 兼容旧版权限树的功能点名
       *
       * 库里的授权记录还是旧名字（`学生基础数据` / `催费管理` / `实训-出勤管理`…），
       * 而 `permTree.ts` 已经改成了新页面名（`学生档案` / `催费` / `出勤管理`）。
       * 不翻译的话，下游三处会同时失效：
       *   · removeCodesOfRevokedPages → 认定「该页没勾任何动作」→ 收回页面码
       *     → my-pages 少一大截 → **左侧菜单整片消失**（校长只剩 4 个菜单）；
       *   · deriveDefaultPaths → 页面管理里勾选框全空；
       *   · roleGrantedOps → 按钮基线漂移。
       *
       * 翻译放在**读库唯一入口**，三处自动对齐；不改库、也不用人手重勾。
       * 映射表见 `perm/config/permTreeLegacy.ts`。
       */
      for (const key of canonicalItemKeys(mod, item)) {
        const i = key.indexOf('||');
        const kmod = key.slice(0, i);
        const kitem = key.slice(i + 2);
        if (!kmod || !kitem) continue;
        const list = (items[kmod] ||= []);
        if (!list.includes(kitem)) list.push(kitem);
      }
    }
  } catch {
    // 查库失败 → 空 Map（退化成「没有功能点」），绝不抛错
    cache = { at: Date.now(), map: new Map() };
    return cache.map;
  }

  cache = { at: Date.now(), map };
  return map;
}

/** 取单个角色的功能点清单 */
export async function getRoleModuleItems(
  roleCode: string,
): Promise<Record<string, string[]> | undefined> {
  const map = await loadRoleModuleItems();
  return map.get(roleCode);
}
