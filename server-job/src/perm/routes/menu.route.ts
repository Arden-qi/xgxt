/**
 * 权限树路由（模块 → 功能点 → 动作）
 *
 * 提供方：权限管理（林晓）
 * 前缀：  /api/perm/menu
 *
 *  GET /tree     完整权限树（8 模块 / 53 个顶级功能点 / 185 个动作）
 *  GET /stats    权限树统计（模块数 / 顶级功能点数 / 动作数）
 *
 * ⚠️ 权限树是「系统能力清单」，与职位无关 —— 职位勾选态走 /api/perm/assign/tree。
 *    t_perm_menu 与 t_perm_menu_action 是这两张表的数据来源。
 * ⚠️ 「教质/学术审批」是父功能点，下挂 休学/退学审批 + 退费审批 两个二级功能点，
 *    父项自身不挂动作。功能点数只算顶级项，动作数按全部项求和 ——
 *    口径与原型 treeStats() 一致，详见 perm.service.ts 的 getTreeStats()。
 */

import { Router } from 'express';
import { ok } from '../utils/response';
import { wrap } from '../utils/wrap';
import { getTreeStats, loadModules } from '../services/perm.service';

export const menuRouter = Router();

/* ============================================================
 * 1. 完整权限树
 *    GET /api/perm/menu/tree?refresh=1
 *
 * ⚠️ refresh=1 强制清缓存（改完种子数据后不用重启服务）
 * ============================================================ */

menuRouter.get(
  '/tree',
  wrap(async (req, res) => {
    const force = String(req.query.refresh || '') === '1';
    const mods = await loadModules(force);
    res.json(ok(mods));
  }),
);

/* ============================================================
 * 2. 权限树统计
 *    GET /api/perm/menu/stats
 *    → { modCount: 8, itemCount: 53, actionCount: 185 }
 * ⚠️ 2026-10-02：实训-教学由 3 个功能点补到 10 个，故 46→53、157→185。
 * ============================================================ */

menuRouter.get(
  '/stats',
  wrap(async (_req, res) => {
    res.json(ok(await getTreeStats()));
  }),
);

export default menuRouter;
