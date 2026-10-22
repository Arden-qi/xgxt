/**
 * 权限树重建 + 各职位初始授权（一次性迁移脚本，可重复执行）
 *
 * 用法：
 *   cd server-job && npx tsx scripts/seed-perm-tree.ts            # 只看计划（dry run）
 *   cd server-job && npx tsx scripts/seed-perm-tree.ts --apply    # 真正写库
 *
 * ============================================================
 * 【它做什么】
 *   ① 把旧的 8 板块 / 53 功能点权限树（market / teach / train / job /
 *      acad / fin / approve / perm）整棵**逻辑删除**（is_deleted=1，可回滚）；
 *      用户自建的功能点（is_custom=1）不动。
 *   ② 按 `src/perm/config/permTree.ts` 重新灌入
 *      **5 板块 / 32 页面 / 真实操作**的新树 —— 页面清单与「页面管理」同源
 *      （pageRegistry.ts），名字、路径、页数逐条对得上。
 *   ③ 为 14 个职位生成**初始勾选**：
 *        页面可见性 = 旧逻辑 `deriveDefaultPaths()` 算出来的页面（= 现在的真实可见范围）
 *        该页面下的操作 = 全勾（当前代码里，凡是能看到这个页面的人，
 *                        这些写接口都是放行的 —— consult/job 的写闸都是
 *                        `resolveActionWithOverlay(roles, code, () => true)`）
 *      → 也就是「重建当天，任何职位的实际能力一行都不变」。
 *   ④ 重写按钮级基线表 `t_perm_role_perm_baseline`，让「差异」归零：
 *      此后管理员在界面上勾/取消，才会真正变成「授权/撤销」。
 *
 * 【为什么必须重建基线】
 *   roleActionOverlay 用的是「差异存储」：
 *      最终操作码 = 静态兜底表 ∪ (现在勾了 − 基线勾过) − (基线勾过 − 现在没勾)
 *   基线里存的还是旧树的功能点名（如 `market||学生档案`），与新树
 *   （`consult||学生管理`）对不上 → 旧基线全部失效，必须按新树重拍一份，
 *   否则「管理员第一次取消勾选」会被当成「基线里有、现在没了」而误撤销，
 *   也可能出现「勾着却按基线判成撤销」的鬼故事。
 * ============================================================
 */

import { randomUUID } from 'crypto';
import { db } from '../src/perm/utils/db';
import { PERM_TREE, PERM_TREE_STATS } from '../src/perm/config/permTree';
import { deriveDefaultPaths } from '../src/utils/rolePageDefaults';

const APPLY = process.argv.includes('--apply');

/** 这些板块的页面，非系统管理员只给「查看」（权限管理是管理员的地盘） */
const VIEW_ONLY_BOARDS = new Set(['perm']);

/**
 * ★ 2026-10-22：例外名单 —— 这些职位在 VIEW_ONLY_BOARDS 里仍然**可写**
 *
 * 「权限管理」板块按设计只有管理员能改配置，但校长是业务侧最高角色，
 * 原先也能配（旧版页面所有按钮对他都是可见的）。
 * 如果这里只留 SYS_ADMIN，校长登录后 7 个页面都进得去、却一个按钮都点不了，
 * 明显的功能退化 —— 所以给校长开写权限。
 */
const BOARD_WRITE_ROLES = new Set(['SYS_ADMIN', 'RM_PRINCIPAL']);

/**
 * 旧口径推不出来的页面 → 按「模块归属」补授权
 *
 * 旧版「功能点 → menuKey」对照表里，下面 3 页没有对应的功能点
 * （`MARKET_PERM_ITEM_TO_MENU` / `FIN_PERM_ITEM_TO_MENU` 的注释里写明了：
 *   流失记录 / 冻结名单 / 费用标准 在旧权限树里没有独立功能点）。
 * 它们在系统里是「本模块的人天然能看」的页面，重建时按本模块职位补上，
 * 否则重建当天这 3 页会突然从对应职位的菜单里消失。
 */
const PAGE_FALLBACK_ROLES: Record<string, string[]> = {
  'consult/loss': ['MKT_CONSULT', 'MKT_MANAGER'],
  'finance/freeze': ['FIN_STAFF'],
  'finance/standard': ['FIN_STAFF'],
};

/** 这两个职位默认拥有全部页面的可见权（校长 = 全权角色，管理员 = 系统全开） */
const ALL_PAGES_ROLES = new Set(['SYS_ADMIN', 'RM_PRINCIPAL']);

async function main(): Promise<void> {
  const now = new Date();

  console.log('════════ 权限树重建 ════════');
  console.log(
    `新树规模：${PERM_TREE_STATS.modCount} 个板块 / ${PERM_TREE_STATS.itemCount} 个页面 / ${PERM_TREE_STATS.actionCount} 个动作`,
  );
  for (const b of PERM_TREE) {
    const acts = b.pages.reduce((n, p) => n + p.actions.length, 0);
    console.log(`  ${b.icon} ${b.name.padEnd(6, '　')} ${String(b.pages.length).padStart(2)} 页 · ${acts} 个动作`);
  }

  /* ---------- 1. 组装新树的 menu / action 行 ---------- */
  interface MenuRow {
    id: string;
    item_name: string;
    module_key: string;
    actions: { code: string; name: string; base: number }[];
  }

  const menuRows: Record<string, unknown>[] = [];
  const actionRows: Record<string, unknown>[] = [];
  const menus: MenuRow[] = [];

  PERM_TREE.forEach((board, bi) => {
    board.pages.forEach((page, pi) => {
      const menuId = `MN2_${board.moduleKey}_${String(pi + 1).padStart(2, '0')}`;
      menuRows.push({
        id: menuId,
        create_time: now,
        create_by: 'perm-tree-v2',
        is_deleted: false,
        module_key: board.moduleKey,
        module_name: board.name,
        module_icon: board.icon,
        module_sort: board.sort ?? bi + 1,
        item_name: page.name,
        parent_item_name: null,
        item_sort: pi + 1,
        remark: `${page.path}${page.remark ? ` · ${page.remark}` : ''}`,
        is_custom: false,
      });
      page.actions.forEach((act, ai) => {
        actionRows.push({
          id: `MA2_${board.moduleKey}_${String(pi + 1).padStart(2, '0')}_${String(ai + 1).padStart(2, '0')}`,
          create_time: now,
          create_by: 'perm-tree-v2',
          is_deleted: false,
          menu_id: menuId,
          action_code: act.code,
          action_name: act.name,
          base_action: act.base,
          action_sort: ai + 1,
          remark: act.ops?.length ? act.ops.join(' / ') : null,
        });
      });
      menus.push({
        id: menuId,
        item_name: page.name,
        module_key: board.moduleKey,
        actions: page.actions.map((a) => ({ code: a.code, name: a.name, base: a.base })),
      });
    });
  });

  /* ---------- 2. 职位 + 各职位的可见页面（沿用旧口径） ---------- */
  const roles = (await db('t_perm_role')
    .where('is_deleted', false)
    .orderBy('sort_no')
    .select('id', 'role_code', 'role_name')) as {
    id: string;
    role_code: string;
    role_name: string;
  }[];

  /** roleCode → 可见的 `moduleKey||path` */
  const visibleByRole = new Map<string, Set<string>>();
  for (const r of roles) {
    const set = await deriveDefaultPaths(r.role_code);
    visibleByRole.set(r.role_code, set);
  }

  /* ---------- 3. 生成每个职位的初始授权 ---------- */
  interface GrantRow {
    roleId: string;
    roleCode: string;
    roleName: string;
    menuId: string;
    moduleKey: string;
    itemName: string;
    actionCode: string;
    actionName: string;
    base: number;
  }
  const grants: GrantRow[] = [];

  for (const r of roles) {
    const visible = visibleByRole.get(r.role_code) || new Set<string>();
    for (const board of PERM_TREE) {
      for (const page of board.pages) {
        const pageKey = `${board.moduleKey}/${page.key}`;
        const hit =
          visible.has(`${board.moduleKey}||${page.path}`) ||
          ALL_PAGES_ROLES.has(r.role_code) ||
          (PAGE_FALLBACK_ROLES[pageKey] || []).includes(r.role_code);
        if (!hit) continue;
        // 权限管理板块：只有系统管理员 / 校长能写；其他职位只给「查看」
        const viewOnly =
          VIEW_ONLY_BOARDS.has(board.moduleKey) && !BOARD_WRITE_ROLES.has(r.role_code);
        const menu = menus.find(
          (m) => m.module_key === board.moduleKey && m.item_name === page.name,
        );
        if (!menu) continue;
        for (const act of page.actions) {
          if (viewOnly && act.code !== 'view') continue;
          grants.push({
            roleId: r.id,
            roleCode: r.role_code,
            roleName: r.role_name,
            menuId: menu.id,
            moduleKey: board.moduleKey,
            itemName: page.name,
            actionCode: act.code,
            actionName: act.name,
            base: act.base,
          });
        }
      }
    }
  }

  /* ---------- 4. 报告 ---------- */
  console.log('\n──────── 各职位初始授权 ────────');
  for (const r of roles) {
    const g = grants.filter((x) => x.roleId === r.id);
    const pages = new Set(g.map((x) => `${x.moduleKey}||${x.itemName}`)).size;
    console.log(`  ${r.role_name.padEnd(6, '　')} ${String(pages).padStart(2)} 页 / ${String(g.length).padStart(3)} 个动作`);
  }

  const oldMenuCount = Number(
    (await db('t_perm_menu').where({ is_deleted: false, is_custom: false }).count({ n: '*' } as any))[0]?.n || 0,
  );
  console.log(
    `\n将逻辑删除旧权限点：${oldMenuCount} 个功能点；写入新树：${menuRows.length} 个功能点 / ${actionRows.length} 个动作；职位授权：${grants.length} 行`,
  );

  if (!APPLY) {
    console.log('\n（dry run，未写库。加 --apply 真正执行）');
    await db.destroy();
    return;
  }

  /* ---------- 5. 写库（事务） ---------- */
  await db.transaction(async (trx) => {
    // 5.1 旧树：整棵逻辑删除（含它们下面所有动作），自建功能点保留
    const oldMenus = (await trx('t_perm_menu')
      .where({ is_deleted: false, is_custom: false })
      .select('id')) as { id: string }[];
    const oldIds = oldMenus.map((m) => m.id);
    if (oldIds.length) {
      await trx('t_perm_menu').whereIn('id', oldIds).update({ is_deleted: true, update_time: now });
      await trx('t_perm_menu_action')
        .whereIn('menu_id', oldIds)
        .andWhere('is_deleted', false)
        .update({ is_deleted: true, update_time: now });
    }

    // 5.2 新树：先清掉上一次 run 留下的同 id 行，再插入（幂等）
    await trx('t_perm_menu_action').whereIn('menu_id', menuRows.map((m) => m.id as string)).del();
    await trx('t_perm_menu').whereIn('id', menuRows.map((m) => m.id as string)).del();
    for (let i = 0; i < menuRows.length; i += 100) {
      await trx('t_perm_menu').insert(menuRows.slice(i, i + 100));
    }
    for (let i = 0; i < actionRows.length; i += 100) {
      await trx('t_perm_menu_action').insert(actionRows.slice(i, i + 100));
    }

    // 5.3 职位授权：全量重写
    await trx('t_perm_role_perm').del();
    const permRows = grants.map((g) => ({
      id: randomUUID(),
      create_time: now,
      create_by: 'perm-tree-v2',
      is_deleted: false,
      role_id: g.roleId,
      menu_id: g.menuId,
      module_key: g.moduleKey,
      item_name: g.itemName,
      action_code: g.actionCode,
      action_name: g.actionName,
      base_action: g.base,
    }));
    for (let i = 0; i < permRows.length; i += 200) {
      await trx('t_perm_role_perm').insert(permRows.slice(i, i + 200));
    }

    // 5.4 职位权限数回填
    for (const r of roles) {
      const n = grants.filter((g) => g.roleId === r.id).length;
      await trx('t_perm_role').where({ id: r.id }).update({ perm_count: n, update_time: now });
    }

    // 5.5 按钮级基线：按新树重拍（差异归零）
    await trx('t_perm_role_perm_baseline').del();
    const baseRows = grants.map((g) => ({
      id: `${g.roleCode}|${g.moduleKey}|${g.itemName}|${g.actionCode}`,
      role_code: g.roleCode,
      module_key: g.moduleKey,
      item_name: g.itemName,
      action_code: g.actionCode,
      create_time: now,
    }));
    for (let i = 0; i < baseRows.length; i += 200) {
      await trx('t_perm_role_perm_baseline').insert(baseRows.slice(i, i + 200));
    }
  });

  console.log('\n✔ 已完成：新权限树已写入，职位授权与基线已重建');
  console.log('⚠️ 后端进程需要重启（权限树有 60 秒内存缓存）');
  await db.destroy();
}

main().catch(async (e) => {
  console.error('✘ 失败：', e);
  try {
    await db.destroy();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
