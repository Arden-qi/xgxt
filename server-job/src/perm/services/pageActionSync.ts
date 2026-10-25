/**
 * 页面管理 ↔ 职位权限分配 的【动作行联动】（★ 2026-10-24）
 *
 * ============================================================
 * 【修的是什么】
 *   用户报：在「页面管理」给咨询老师 / 咨询经理勾上财务管理的
 *   「财务概览 / 缴费管理」（t_perm_role_page enabled=1，保存成功），
 *   但「职位权限分配」里财务管理仍然显示 0/6「未授权」——
 *   而账号登录后左侧却出现财务管理板块、页面也能打开。
 *   三个界面各说各话。
 *
 * 【根因】
 *   「页面管理」写的是职位 → 页面台账（t_perm_role_page），
 *   「职位权限分配」读的是动作行（t_perm_role_perm）。
 *   给页面 ≠ 给动作：台账勾了页面，但该页面在权限树里的动作行一条都没有，
 *   于是分配页显示「未授权」（动作行空）、perm_count 也不含它。
 *   （2026-10-23 的越权清理把这两个页面的动作行删掉了，之后管理员又把页面
 *   勾了回来，缺口就暴露了 —— 但即使不清理，这个缺口也是设计上就存在的。）
 *
 * 【口径（用户拍板）】
 *   **页面管理勾上 = 授权该页面**，职位权限分配必须显示出来。
 *   落地规则（双向联动，页面级 ⇄ 动作级）：
 *     · 某职位最终可见的页面（默认 ∪ 台账打勾 − 台账去勾）没有**任何**动作行
 *       → 自动补一条该页面的「查看」基础动作行（管理员之后可在职位权限分配
 *         里再加更多动作，此时页面已授权，不再灰掉）；
 *     · 某页面有动作行但已不可见 → 删光该页面的动作行（动作行 ⊆ 可见页面，
 *       2026-10-23 那条不变量的自动维护）。
 *   这样「有没有权限」在任何界面都只有一个答案：
 *     页面管理 勾/取消 ⇄ 职位权限分配 显示已授权/未授权 ⇄ 登录后菜单与接口。
 *
 * 【调用时机】
 *   · `rolePage.service.ts` 的 saveRolePages / resetRolePages 保存后调用；
 *   · 修复脚本 `scripts/sync-role-page-actions.ts`（--apply 全量补齐存量）。
 * ============================================================
 */

import { randomUUID } from 'crypto';
import { db } from '../utils/db';
import { PERM_TREE_PAGES } from '../config/permTree';
import { effectiveKeysOfRole } from '../../utils/rolePageEffective';
import { clearRoleDefaultCache } from '../../utils/rolePageDefaults';
import { clearRoleActionCache } from '../../utils/roleActionOverlay';
import { clearAssignScopeCache } from './assignScope';

export interface RolePageActionSyncResult {
  /** 自动补「查看」的页面（moduleKey||页面名） */
  added: string[];
  /** 因页面不可见而删掉的动作行数 */
  removed: number;
  /** 同步后的 perm_count */
  permCount: number;
}

/** `moduleKey||页面名` 键（与 t_perm_role_perm.module_key + item_name 对齐） */
const itemKeyOf = (moduleKey: string, itemName: string) => `${moduleKey}||${itemName}`;

/**
 * 把某职位的「动作行」与「最终可见页面」对齐（幂等，可反复跑）。
 *
 * @param roleId     职位 id
 * @param operatorId 操作人（写 create_by / update_by）
 */
export async function syncRolePageActions(
  roleId: string,
  operatorId: string = 'system',
): Promise<RolePageActionSyncResult> {
  const role = await db('t_perm_role').where({ id: roleId, is_deleted: false }).first();
  if (!role) return { added: [], removed: 0, permCount: 0 };
  const roleCode = String(role.role_code || '');

  /* ---- ① 该职位最终可见页面（默认 ∪ 台账打勾 − 台账去勾；工作台恒可见） ---- */
  const visible = await effectiveKeysOfRole(roleCode); // `moduleKey||path` 集合
  /** 可见页面的 `moduleKey||页面名` → 页面定义 */
  const visibleItems = new Map<string, { moduleKey: string; itemName: string }>();
  for (const p of PERM_TREE_PAGES) {
    if (visible.has(`${p.moduleKey}||${p.path}`)) {
      visibleItems.set(itemKeyOf(p.moduleKey, p.name), {
        moduleKey: p.moduleKey,
        itemName: p.name,
      });
    }
  }

  /* ---- ② 权限树（DB）里每个功能点的动作定义（拿 menu_id 和「查看」的编码） ---- */
  const { loadModules } = await import('./perm.service');
  const mods = await loadModules();
  /** `moduleKey||页面名` → { menuId, view: {code,name,base} } */
  const menuOf = new Map<string, { menuId: string; view?: { code: string; name: string; base: number } }>();
  mods.forEach((m) =>
    m.items.forEach((it) => {
      const view = it.actions.find((a) => Number(a.baseAction) === 1);
      menuOf.set(itemKeyOf(m.moduleKey, it.itemName), {
        menuId: it.id,
        view: view ? { code: view.actionCode, name: view.actionName, base: Number(view.baseAction) } : undefined,
      });
    }),
  );

  /* ---- ③ 现有动作行按功能点分组 ---- */
  const rows = (await db('t_perm_role_perm').where({ role_id: roleId, is_deleted: false })) as any[];
  const rowsByItem = new Map<string, any[]>();
  rows.forEach((r) => {
    const k = itemKeyOf(String(r.module_key), String(r.item_name));
    (rowsByItem.get(k) || rowsByItem.set(k, []).get(k)!).push(r);
  });

  /* ---- ④ 补缺：可见但一条动作都没有的页面 → 补「查看」 ---- */
  const added: string[] = [];
  const toInsert: Record<string, unknown>[] = [];
  for (const [k, info] of visibleItems) {
    if (rowsByItem.has(k)) continue;
    const menu = menuOf.get(k);
    if (!menu?.view) continue; // 树里没有该功能点或没有查看动作 → 跳过（不该发生）
    toInsert.push({
      id: randomUUID(),
      role_id: roleId,
      menu_id: menu.menuId,
      module_key: info.moduleKey,
      item_name: info.itemName,
      action_code: menu.view.code,
      action_name: menu.view.name,
      base_action: menu.view.base,
      is_deleted: false,
      create_time: new Date(),
      create_by: operatorId,
    });
    added.push(k);
  }

  /* ---- ⑤ 删多余：有动作行但页面已不可见 → 删光该页面的动作行 ---- */
  const staleIds: string[] = [];
  rowsByItem.forEach((list, k) => {
    if (!visibleItems.has(k)) staleIds.push(...list.map((r) => String(r.id)));
  });

  const now = new Date();
  await db.transaction(async (trx) => {
    if (toInsert.length) {
      for (let i = 0; i < toInsert.length; i += 200) {
        await trx('t_perm_role_perm').insert(toInsert.slice(i, i + 200));
      }
    }
    if (staleIds.length) {
      for (let i = 0; i < staleIds.length; i += 200) {
        await trx('t_perm_role_perm').whereIn('id', staleIds.slice(i, i + 200)).del();
      }
    }
    const permCount = rows.length - staleIds.length + toInsert.length;
    await trx('t_perm_role').where({ id: roleId }).update({
      perm_count: permCount,
      update_time: now,
      update_by: operatorId,
    });
  });

  /* ---- ⑥ 动作行变了 → 相关缓存全部失效（与 assign 保存同一套） ---- */
  if (added.length || staleIds.length) {
    clearRoleDefaultCache();
    clearRoleActionCache();
    clearAssignScopeCache();
  }

  return { added, removed: staleIds.length, permCount: rows.length - staleIds.length + toInsert.length };
}

/** 全部职位跑一遍（修复脚本 / 保存后兜底用） */
export async function syncAllRolesPageActions(
  operatorId: string = 'system',
): Promise<Map<string, RolePageActionSyncResult>> {
  const roles = (await db('t_perm_role').where('is_deleted', false).select('id')) as any[];
  const out = new Map<string, RolePageActionSyncResult>();
  for (const r of roles) {
    out.set(String(r.id), await syncRolePageActions(String(r.id), operatorId));
  }
  return out;
}
