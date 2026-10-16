/**
 * 宿舍楼栋设置接口 · /api/teaching/building/*
 * ============================================================
 *
 * 【为什么单独挂一串路由，而不是塞进 /api/teaching/dorm】
 *   `/api/teaching/dorm` 的门槛是「三个宿舍页面权限任一」。
 *   但楼栋设置的入口在**教学管理 → 系统设置**（`classjh:setting:view`），
 *   一个只有系统设置权限、没有宿舍权限的用户，如果走 dorm 那串会被 403 挡在门外。
 *   → 单独挂，并把两个入口的权限码都列进 `requireAnyPage`，两边都进得去。
 *
 * 【三个接口够用】
 *   GET    /list          楼栋列表（设置页 + 宿舍下拉共用）
 *   POST   /save          新增 / 修改
 *   DELETE /delete?id=    删除（被宿舍引用时拒绝）
 */

import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { BizCode } from 'shared-types';
import { BizError } from '../../middleware/errorHandler';
import { ok } from '../../utils/response';
import * as svc from './building.service';

export const teachingBuildingRouter = Router();

function wrap(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

function str(v: unknown): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  return String(v);
}

/** 1. 楼栋列表 */
teachingBuildingRouter.get(
  '/list',
  wrap(async (_req, res) => {
    res.json(ok(await svc.listBuildings(), '查询成功'));
  }),
);

/** 2. 新增 / 修改 */
teachingBuildingRouter.post(
  '/save',
  wrap(async (req, res) => {
    const b = req.body || {};
    const r = await svc.saveBuilding(
      {
        id: str(b.id),
        buildingName: String(b.buildingName ?? ''),
        sortNo: b.sortNo === undefined || b.sortNo === null || b.sortNo === ''
          ? undefined
          : Number(b.sortNo),
        remark: str(b.remark),
      },
      req.user?.userId || '',
    );
    res.json(ok(r, b.id ? '楼栋已更新' : '楼栋已创建'));
  }),
);

/** 3. 删除 */
teachingBuildingRouter.delete(
  '/delete',
  wrap(async (req, res) => {
    const id = str(req.query.id);
    if (!id) throw new BizError(BizCode.PARAM_ERROR, '缺少楼栋ID');
    await svc.removeBuilding(id, req.user?.userId || '');
    res.json(ok(null, '已删除'));
  }),
);
