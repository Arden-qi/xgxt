/**
 * 统一宿舍接口 · /api/teaching/dorm/*
 * ============================================================
 *
 * 取代合并前的 10 + 11 + 19 = 44 个宿舍接口（三学段各一套，
 * 名字还都不一样：/building/list vs /room/page vs /page）。
 *
 * 【三个学段的入口是同一个，靠 stage 区分】
 *   jh 初高 / class 大学 / job 实训
 *
 * 【★★ 本域两个特殊约束（与前 7 个域不同）】
 *
 * ① **大学只读**（斌哥 2026-10-09 拍板）
 *    大学的房间/床位是从教务同步进 sms_common 两张表的，不是自己维护的。
 *    → /meta 下发 hasCreate=false，前端隐藏新建/编辑/删除按钮；
 *    → service.saveDorm / removeDorm / assignBed / checkoutBed 再抛一次，
 *      **双保险**（前端漏改也不会写脏数据）。
 *    → 但 /change/create（换宿/退宿申请）允许写。
 *
 * ② **审批链统一用实训那套**（同上拍板，行为变更）
 *    新单据的审批状态口径统一成 ApprovalStatus（1待提交/2待审批/4已通过/5已驳回/6已撤销）。
 *    初高/大学旧的 apply_status 三态只用于**读历史单据**，不再产生新数据。
 *
 * 老接口（/api/job/dorm、/api/class/dorm、/api/class-jh/dorm）
 * 一个都没删，随时可回退。
 */

import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { BizCode } from 'shared-types';
import { BizError } from '../../middleware/errorHandler';
import { ok, page as pageResp } from '../../utils/response';
import * as svc from './service';
import type { DormListQuery, TeachingStage } from '../shared/dto';
import { DORM_STATUS_NAME } from '../shared/dto';

export const teachingDormRouter = Router();

function wrap(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

function str(v: unknown): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  return String(v);
}
function strOrNull(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  return String(v);
}
function int(v: unknown, def: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : def;
}
/** null 与 undefined 都降级成 undefined（= 不修改），保护 NOT NULL 列 */
function numOrUndef(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
function reqStage(v: unknown): TeachingStage {
  return svc.assertStage(v);
}
function optStage(v: unknown): TeachingStage | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  return svc.assertStage(v);
}
function bool(v: unknown): boolean | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  return v === true || v === 'true' || v === '1' || v === 1;
}
function dateStr(v: unknown): string {
  const s = str(v);
  if (!s) throw new BizError(BizCode.PARAM_ERROR, '日期必填');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new BizError(BizCode.PARAM_ERROR, '日期格式应为 YYYY-MM-DD');
  }
  return s;
}
function requireId(v: unknown, label = '宿舍ID'): string {
  const s = str(v);
  if (!s) throw new BizError(BizCode.PARAM_ERROR, `缺少${label}`);
  return s;
}

/** 从 query 组装列表查询 */
function queryOf(req: Request): DormListQuery {
  return {
    stage: optStage(req.query.stage) as TeachingStage,
    building: str(req.query.building),
    dormType: numOrUndef(req.query.dormType),
    roomStatus: numOrUndef(req.query.roomStatus),
    keyword: str(req.query.keyword),
    onlyVacant: bool(req.query.onlyVacant),
    page: int(req.query.page, 1),
    size: Math.min(int(req.query.size, 20), 200),
  };
}

/** 1. 房间列表 */
teachingDormRouter.get(
  '/list',
  wrap(async (req, res) => {
    const r = await svc.listDorms(queryOf(req), req.user);
    res.json(pageResp(r.list, r.total, { page: r.page, size: r.size }));
  }),
);

/** 2. 房间详情 */
teachingDormRouter.get(
  '/detail',
  wrap(async (req, res) => {
    const stage = reqStage(req.query.stage);
    const id = requireId(req.query.id);
    const d = await svc.getDormDetail(stage, id, req.user);
    if (!d) throw new BizError(BizCode.PARAM_ERROR, '宿舍不存在或无权访问');
    res.json(ok(d));
  }),
);

/** 3. 床位列表（含在住学生） */
teachingDormRouter.get(
  '/beds',
  wrap(async (req, res) => {
    const stage = reqStage(req.query.stage);
    const dormId = requireId(req.query.dormId, '宿舍ID');
    res.json(ok(await svc.listBeds(stage, dormId, req.user), '查询成功'));
  }),
);

/** 4. 在住学生名单 */
teachingDormRouter.get(
  '/residents',
  wrap(async (req, res) => {
    res.json(ok(await svc.listResidents(queryOf(req), req.user), '查询成功'));
  }),
);

/** 5. 楼栋下拉 */
teachingDormRouter.get(
  '/buildings',
  wrap(async (req, res) => {
    res.json(ok(await svc.listBuildings(optStage(req.query.stage), req.user), '查询成功'));
  }),
);

/** 6. 元信息（前端据此隐藏不适用按钮 —— 大学 hasCreate=false） */
teachingDormRouter.get(
  '/meta',
  wrap(async (req, res) => {
    res.json(ok(await svc.listDormMeta(optStage(req.query.stage), req.user), '查询成功'));
  }),
);

/** 7. 统计卡片 */
teachingDormRouter.get(
  '/summary',
  wrap(async (req, res) => {
    res.json(ok(await svc.summaryDorms(queryOf(req), req.user), '查询成功'));
  }),
);

/** 8. 保存（新增 / 修改）—— 大学会被 service 拦掉 */
teachingDormRouter.post(
  '/save',
  wrap(async (req, res) => {
    const b = req.body || {};
    const stage = reqStage(b.stage);
    if (!String(b.buildingName ?? '').trim()) {
      throw new BizError(BizCode.PARAM_ERROR, '楼栋必填');
    }
    if (!String(b.roomNo ?? '').trim()) {
      throw new BizError(BizCode.PARAM_ERROR, '房间号必填');
    }
    if (b.roomStatus !== undefined && b.roomStatus !== null && b.roomStatus !== '') {
      const st = Number(b.roomStatus);
      if (!DORM_STATUS_NAME[st]) {
        throw new BizError(BizCode.PARAM_ERROR, '房间状态取值非法');
      }
    }
    const r = await svc.saveDorm(
      {
        stage,
        id: str(b.id),
        buildingName: String(b.buildingName).trim(),
        roomNo: String(b.roomNo).trim(),
        // ★ NOT NULL 列（floorNo / dormType / bedCount / roomStatus）一律 numOrUndef，
        //   传 null 会被降级成 undefined（= 不修改），避免 ER_BAD_NULL_ERROR
        floorNo: numOrUndef(b.floorNo),
        dormType: numOrUndef(b.dormType),
        bedCount: numOrUndef(b.bedCount),
        ownerName: strOrNull(b.ownerName),
        classId: strOrNull(b.classId),
        className: strOrNull(b.className),
        roomStatus: numOrUndef(b.roomStatus),
        remark: strOrNull(b.remark),
      },
      req.user,
    );
    res.json(ok(r, b.id ? '宿舍已更新' : '宿舍已创建'));
  }),
);

/** 9. 删除（逻辑删除）—— 大学会被 service 拦掉 */
teachingDormRouter.delete(
  '/delete',
  wrap(async (req, res) => {
    const stage = reqStage(req.query.stage);
    const id = requireId(req.query.id);
    await svc.removeDorm(stage, id, req.user);
    res.json(ok(null, '已删除'));
  }),
);

/** 10. 分派床位（学生入住）—— 大学会被 service 拦掉 */
teachingDormRouter.post(
  '/assign',
  wrap(async (req, res) => {
    const b = req.body || {};
    const stage = reqStage(b.stage);
    await svc.assignBed(
      {
        stage,
        dormId: requireId(b.dormId, '宿舍ID'),
        bedId: requireId(b.bedId, '床位ID'),
        studentId: requireId(b.studentId, '学生ID'),
        checkInDate: str(b.checkInDate),
      },
      req.user,
    );
    res.json(ok(null, '入住成功'));
  }),
);

/** 11. 退宿（直接生效，管理员纠错用；正式退宿走 /change/create 审批） */
teachingDormRouter.post(
  '/checkout',
  wrap(async (req, res) => {
    const b = req.body || {};
    const stage = reqStage(b.stage);
    await svc.checkoutBed(
      stage,
      requireId(b.dormId, '宿舍ID'),
      requireId(b.bedId, '床位ID'),
      req.user,
    );
    res.json(ok(null, '已退宿'));
  }),
);

/** 12. 调宿/退宿申请列表 */
teachingDormRouter.get(
  '/change/list',
  wrap(async (req, res) => {
    res.json(ok(await svc.listDormChanges(queryOf(req), req.user), '查询成功'));
  }),
);

/** 13. 发起调宿/退宿申请（三学段都允许，包括大学） */
teachingDormRouter.post(
  '/change/create',
  wrap(async (req, res) => {
    const b = req.body || {};
    const stage = reqStage(b.stage);
    const bizType = Number(b.bizType);
    if (bizType !== 1 && bizType !== 2) {
      throw new BizError(BizCode.PARAM_ERROR, '业务类型只能是 1 调换宿舍 / 2 退宿');
    }
    const r = await svc.createDormChange(
      {
        stage,
        bizType,
        studentId: requireId(b.studentId, '学生ID'),
        oldDormId: strOrNull(b.oldDormId),
        oldBedId: strOrNull(b.oldBedId),
        newDormId: strOrNull(b.newDormId),
        newBedId: strOrNull(b.newBedId),
        changeDate: dateStr(b.changeDate),
        changeReason: String(b.changeReason ?? '').trim(),
      },
      req.user,
    );
    res.json(ok(r, '申请已提交，等待审批'));
  }),
);
