/**
 * 「职位权限分配」的**可分配范围**（页面上限）
 *
 * ============================================================
 * 【要解决的问题】
 *   用户在「职位权限分配」里给某个职位勾动作，能**顺带把一整页开出来**：
 *   权限树里勾了「审批中心」的 action，页面级可见性就跟着出现，
 *   于是「页面管理」里这个职位也有了审批中心。
 *   实测：咨询老师（MKT_CONSULT）本来没有审批中心（咨询经理专属），
 *   但在分配树里勾得动 → 页面管理里就多出一页 → 登录后能进。
 *
 * 【规则（唯一一句话）】
 *   一个职位**只能在自己已经获得授权的页面里**分配动作。
 *   页面上限由「页面管理 → 职位」决定，不由这里决定。
 *
 *   于是两个页面的分工变成单向的：
 *     页面管理（职位模式）  决定「能进哪些页面」   ← 加法/减法都在这里
 *     职位权限分配          决定「页面里能点哪些按钮」 ← 只能在已授权的页面里配
 *   想给职位开一个新页面 → 先在「页面管理 → 职位」里勾上，
 *   分配树里那一页才会解锁（否则永远勾不动）。
 *
 * 【上限从哪来】
 *   `effectiveKeysOfRole(roleCode)` —— 与登录后菜单/守卫用的是**同一份**算法：
 *      默认（该职位在权限库里勾到动作的页面） ∪ 台账打勾 − 台账去勾
 *   所以「分配树里灰着」和「登录后进不去」永远是一回事，不会出现
 *   「界面上能配、配了却进不去」或者反过来的错位。
 *
 * 【为什么不设限的情形】
 *   · 该职位在权限库里**一个功能点都没有**（新建职位 / 刚被一键清空）
 *     → 没有默认，也就没有上限，此时放开（否则新职位连第一页都配不了）。
 *   · 自建职位（roleCode 不在任何默认表里）同理。
 *   ⚠️ 这两种情况都是「还没开始配」的状态，放开不会造成越权：
 *     一旦配过一次，上限就由那次的结果固定下来。
 *
 * 【降级原则】
 *   任何一步查不到（角色不存在 / 台账读失败）→ restricted=false（不设限），
 *   宁可放宽也不能因为权限表抖一下就让所有人都配不了权限。
 * ============================================================
 */

import { db } from '../utils/db';
import { effectiveKeysOfRole } from '../../utils/rolePageEffective';
import { loadRoleModuleItems } from '../../utils/roleModuleItems';
import { PERM_TREE } from '../config/permTree';
import type { RolePermMap } from 'shared-types/perm';

/** `板块key||页面path` → `板块key||页面名`（权限库的 item_name 就是页面名） */
const ITEM_OF_KEY = new Map<string, string>();
/** 全部合法页面（`板块key||页面名`），用于挡脏数据 */
const ALLOWED_UNIVERSE = new Set<string>();

for (const board of PERM_TREE) {
  for (const page of board.pages) {
    const item = `${board.moduleKey}||${page.name}`;
    ITEM_OF_KEY.set(`${board.moduleKey}||${page.path}`, item);
    ALLOWED_UNIVERSE.add(item);
  }
}

export interface AssignScope {
  /** true = 有上限（分配树里未授权的页面要禁用）；false = 不设限 */
  restricted: boolean;
  /** 允许分配动作的页面（`板块key||页面名`） */
  allowedItems: Set<string>;
  /** 允许的页面数（界面提示用） */
  allowedCount: number;
  /** 总页面数 */
  totalCount: number;
}

/* ============================================================
 * 0. 短缓存（★ 2026-10-23）
 *
 * 【为什么要缓存】
 *   同一份「可分配范围」在一次请求里会被问很多次：
 *   账号列表 18 行 × 每人 1~2 个职位；账号详情还要再算一遍。
 *   不缓存就是每次都读权限树 + 台账（4 条 SQL），列表页会明显变慢。
 *
 * 【为什么 TTL 只有 8 秒而不是分钟级】
 *   范围是**权限变更后的即时事实**：管理员改完页面管理，回到分配页必须立刻变。
 *   8 秒足够吃掉同一批请求的重复计算，又不至于让人看到过期结果；
 *   写入口（分配保存 / 页面保存 / 职位编辑）还会显式 clear，不依赖 TTL。
 * ============================================================ */

const SCOPE_TTL_MS = 8_000;
const scopeCache = new Map<string, { at: number; scope: AssignScope }>();

/** 清缓存（任何权限 / 页面变更后必须调用） */
export function clearAssignScopeCache(): void {
  scopeCache.clear();
}

/** 不设限的 scope（降级 / 空白职位） */
function unrestricted(): AssignScope {
  return {
    restricted: false,
    allowedItems: new Set(ALLOWED_UNIVERSE),
    allowedCount: ALLOWED_UNIVERSE.size,
    totalCount: ALLOWED_UNIVERSE.size,
  };
}

/**
 * 算某个职位的可分配范围（带 8 秒缓存）
 *
 * @param roleId 职位 id（t_perm_role.id，如 R01）
 */
export async function assignScopeOfRole(roleId: string): Promise<AssignScope> {
  const hit = scopeCache.get(roleId);
  if (hit && Date.now() - hit.at < SCOPE_TTL_MS) return hit.scope;

  const scope = await computeAssignScope(roleId);
  scopeCache.set(roleId, { at: Date.now(), scope });
  return scope;
}

async function computeAssignScope(roleId: string): Promise<AssignScope> {
  try {
    const role = await db('t_perm_role').where({ id: roleId, is_deleted: false }).first();
    if (!role) return unrestricted();

    const roleCode = String(role.role_code || '');

    // 该职位在权限库里有没有配过功能点？没有 → 视为「还没开始配」，不设上限
    const moduleItems = await loadRoleModuleItems();
    const owned = moduleItems.get(roleCode);
    const ownCount = owned
      ? Object.values(owned).reduce((n, list) => n + (list?.length || 0), 0)
      : 0;
    if (ownCount === 0) return unrestricted();

    const keys = await effectiveKeysOfRole(roleCode);
    const allowedItems = new Set<string>();
    keys.forEach((k) => {
      const item = ITEM_OF_KEY.get(k);
      if (item) allowedItems.add(item);
    });

    // 一个页面都没算出来（注册表与台账对不上之类）→ 同样不设限，避免把人锁死
    if (allowedItems.size === 0) return unrestricted();

    return {
      restricted: true,
      allowedItems,
      allowedCount: allowedItems.size,
      totalCount: ALLOWED_UNIVERSE.size,
    };
  } catch {
    return unrestricted();
  }
}

/**
 * 按范围过滤一份权限点（`板块key||页面名` → 动作编码数组）
 *
 * @returns `perms` 过滤后的权限点；`dropped` 被丢弃的功能点数；
 *          `droppedItems` 被丢弃的页面名单（写日志 / 提示用）
 */
export function filterPermsByScope(
  perms: RolePermMap,
  scope: AssignScope,
): { perms: RolePermMap; dropped: number; droppedItems: string[] } {
  if (!scope.restricted) return { perms, dropped: 0, droppedItems: [] };

  const out: RolePermMap = {};
  const droppedItems: string[] = [];

  Object.keys(perms || {}).forEach((key) => {
    const codes = (perms[key] || []).filter(Boolean);
    if (!codes.length) return;
    if (!scope.allowedItems.has(key)) {
      droppedItems.push(key);
      return;
    }
    out[key] = [...codes];
  });

  return { perms: out, dropped: droppedItems.length, droppedItems };
}

/** `板块key||页面名` → 页面标题（提示文案用） */
export function itemTitleOf(key: string): string {
  const i = key.indexOf('||');
  return i < 0 ? key : key.slice(i + 2);
}

/* ============================================================
 * 5. 单一事实来源：一个职位的【有效动作】(★ 2026-10-23 新增)
 *
 * 【为什么必须只留这一个函数】
 *   用户报的 bug：同一个「咨询经理」，四个界面四种答案 ——
 *     · 页面管理      → 财务管理 0/6（已关闭）
 *     · 职位权限分配  → 没有财务（已按范围过滤）
 *     · 账号详情      → 财务管理 2/6  ← 读的是**原始** t_perm_role_perm
 *     · 登录后侧栏    → 冒出权限管理      ← 读的是**账号级** modules
 *   根因不是某一处算错，而是**同一条规则被抄了四份**。
 *   所以这里只回答一个问题：这个职位到底有哪些有效动作？
 *   其它任何界面都不许再自己去读 t_perm_role_perm。
 *
 *   定义：有效动作 = 库里的动作 ∩ 该职位已获授权的页面（assignScope）
 *
 * ⚠️ 注意「不设限」的场合（新职位 / 还没配过页面）：
 *   此时 scope.restricted=false，过滤是空操作 —— 有效动作 = 库里的动作。
 *   这正是期望行为：还没开始配的职位不该被凭空收窄。
 * ============================================================ */

/**
 * 某职位的有效权限点（已按页面上限过滤）
 *
 * @param roleId 职位 id
 * @param raw    已经读好的原始权限点（可选，避免重复查库）
 */
export async function effectivePermMapOfRole(
  roleId: string,
  raw?: RolePermMap,
): Promise<RolePermMap> {
  const [perms, scope] = await Promise.all([
    raw ? Promise.resolve(raw) : loadRolePermMap(roleId),
    assignScopeOfRole(roleId),
  ]);
  return filterPermsByScope(perms, scope).perms;
}

/** 延迟引入，避免 assignScope ↔ perm.service 的循环依赖 */
async function loadRolePermMap(roleId: string): Promise<RolePermMap> {
  const { getRolePermMap } = await import('./perm.service');
  return getRolePermMap(roleId);
}

/**
 * 按范围过滤「`板块||页面||动作`」三段式键（账号列表 / 详情用）
 *
 * @param keys     权限键集合
 * @param roleId   这些键属于哪个职位（范围按职位算）
 */
export async function filterPermKeysByRole(
  keys: Iterable<string>,
  roleId: string,
): Promise<Set<string>> {
  const scope = await assignScopeOfRole(roleId);
  const out = new Set<string>();
  for (const k of keys) {
    const parts = String(k).split('||');
    if (parts.length < 3) continue;
    const itemKey = `${parts[0]}||${parts[1]}`;
    if (!scope.restricted || scope.allowedItems.has(itemKey)) out.add(String(k));
  }
  return out;
}

/**
 * 某个职位编码允许分配的页面（`板块||页面名`）
 *
 * @returns `null` = 不设限（新职位 / 查不到），调用方不要过滤
 */
export async function allowedItemsOfRoleCode(
  roleCode: string,
): Promise<Set<string> | null> {
  try {
    const role = await db('t_perm_role')
      .where({ role_code: roleCode, is_deleted: false })
      .first();
    if (!role) return null;
    const scope = await assignScopeOfRole(String(role.id));
    return scope.restricted ? scope.allowedItems : null;
  } catch {
    return null;
  }
}
