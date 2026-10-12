/**
 * 统一出勤接口 · /api/teaching/attendance/*
 * ============================================================
 *
 * 【这一组接口取代了原来的 15 个】
 *   合并前：初高 5 + 大学 4 + 实训 5 = 14 个接口，同一件事三个名字
 *           （/list vs /page、/add vs /save vs /import）
 *   合并后：5 个接口，学段由 `stage` 参数决定。
 *
 * 【老接口一个都没删】
 *   /api/class-jh/attendance/*、/api/class/attendance/*、/api/job/attendance/*
 *   仍原样可用，作为**观察期的回退通道**，一个迭代后再下线。
 */

import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { BizCode } from 'shared-types';
import { BizError } from '../../middleware/errorHandler';
import { ok, page as pageResp } from '../../utils/response';
import * as svc from './service';
import type { TeachingStage } from '../shared/dto';
import { isTeachingStage } from '../shared/dto';

export const teachingAttendanceRouter = Router();

/** 异步处理器包装（Express 4 不会自动捕获 async 抛错） */
function wrap(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

/* ---------------- 入参小工具 ---------------- */

function str(v: unknown): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  return String(v);
}

function int(v: unknown, def: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : def;
}

function reqStage(v: unknown): TeachingStage {
  if (!isTeachingStage(v)) {
    throw new BizError(BizCode.PARAM_ERROR, 'stage 必填，且只能是 jh / class / job');
  }
  return v;
}

function optStage(v: unknown): TeachingStage | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (!isTeachingStage(v)) {
    throw new BizError(BizCode.PARAM_ERROR, 'stage 只能是 jh / class / job');
  }
  return v;
}

function dateStr(v: unknown, field: string): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new BizError(BizCode.PARAM_ERROR, `${field} 格式应为 YYYY-MM-DD`);
  }
  return s;
}

/* ============================================================
 * 1. 列表  GET /api/teaching/attendance/list
 *    ?stage=jh&classId=&startDate=&endDate=&page=1&size=20
 *    stage 不传 = 全部可见学段（前端「全部」筛选项）
 * ============================================================ */
teachingAttendanceRouter.get(
  '/list',
  wrap(async (req, res) => {
    const q = {
      stage: optStage(req.query.stage),
      classId: str(req.query.classId),
      startDate: dateStr(req.query.startDate, 'startDate'),
      endDate: dateStr(req.query.endDate, 'endDate'),
      page: int(req.query.page, 1),
      size: Math.min(int(req.query.size, 20), 200),
    };
    const r = await svc.listAttendance(q, req.user);
    res.json(pageResp(r.list, r.total, { page: r.page, size: r.size }));
  }),
);

/* ============================================================
 * 2. 详情  GET /api/teaching/attendance/detail?stage=&id=
 * ============================================================ */
teachingAttendanceRouter.get(
  '/detail',
  wrap(async (req, res) => {
    const stage = reqStage(req.query.stage);
    const id = str(req.query.id);
    if (!id) throw new BizError(BizCode.PARAM_ERROR, '缺少出勤记录ID');
    res.json(ok(await svc.getDetail(stage, id, req.user)));
  }),
);

/* ============================================================
 * 3. 录入登记板  GET /api/teaching/attendance/board?stage=&classId=&attendanceDate=
 *    返回某班某天的在班名单 + 已登记状态（录入弹窗用）
 * ============================================================ */
teachingAttendanceRouter.get(
  '/board',
  wrap(async (req, res) => {
    const stage = reqStage(req.query.stage);
    const classId = str(req.query.classId);
    if (!classId) throw new BizError(BizCode.PARAM_ERROR, '缺少班级ID');
    const date = dateStr(req.query.attendanceDate, 'attendanceDate');
    if (!date) throw new BizError(BizCode.PARAM_ERROR, '缺少考勤日期');
    res.json(ok(await svc.getBoard(stage, classId, date, req.user)));
  }),
);

/* ============================================================
 * 4. 保存  POST /api/teaching/attendance/save
 *    body: { stage, classId, attendanceDate, ... }
 *      · 初高 / 实训：传 rows[{studentId,status,reason}]（状态用统一码 1~7）
 *      · 大学：传 shouldCount / actualCount（老师手工填人数）
 * ============================================================ */
teachingAttendanceRouter.post(
  '/save',
  wrap(async (req, res) => {
    const b = req.body || {};
    const stage = reqStage(b.stage);
    const classId = str(b.classId);
    if (!classId) throw new BizError(BizCode.PARAM_ERROR, '缺少班级ID');
    const attendanceDate = dateStr(b.attendanceDate, 'attendanceDate');
    if (!attendanceDate) throw new BizError(BizCode.PARAM_ERROR, '缺少考勤日期');

    const rows = Array.isArray(b.rows)
      ? b.rows.map((r: any) => ({
          studentId: String(r.studentId),
          status: Number(r.status),
          reason: r.reason ?? null,
        }))
      : undefined;

    const r = await svc.saveAttendance(
      {
        stage,
        classId,
        attendanceDate,
        shouldCount: b.shouldCount === undefined ? undefined : Number(b.shouldCount),
        actualCount: b.actualCount === undefined ? undefined : Number(b.actualCount),
        rows,
        fileUrl: b.fileUrl ?? null,
        remark: b.remark ?? null,
      },
      req.user,
    );
    res.json(
      ok(r, `${attendanceDate} 考勤已保存（应到 ${r.shouldCount} / 实到 ${r.actualCount}）`),
    );
  }),
);

/* ============================================================
 * 5. 汇总  GET /api/teaching/attendance/summary?stage=
 * ============================================================ */
teachingAttendanceRouter.get(
  '/summary',
  wrap(async (req, res) => {
    const list = await svc.attendanceSummary(
      {
        stage: optStage(req.query.stage),
        classId: str(req.query.classId),
        startDate: dateStr(req.query.startDate, 'startDate'),
        endDate: dateStr(req.query.endDate, 'endDate'),
      },
      req.user,
    );
    res.json(ok(list, '统计成功'));
  }),
);

/* ============================================================
 * 6. 导出（不分页全量）  GET /api/teaching/attendance/export
 * ============================================================ */
teachingAttendanceRouter.get(
  '/export',
  wrap(async (req, res) => {
    const rows = await svc.exportAttendance(
      {
        stage: optStage(req.query.stage),
        classId: str(req.query.classId),
        startDate: dateStr(req.query.startDate, 'startDate'),
        endDate: dateStr(req.query.endDate, 'endDate'),
        page: 1,
        size: 20,
      },
      req.user,
    );
    res.json(ok(rows, `导出 ${rows.length} 条`));
  }),
);

/* ============================================================
 * 7. 班级下拉  GET /api/teaching/attendance/classes
 *    三个学段的班级表不同（t_class_info / t_job_class），这里统一成 {id,name}
 *    ⚠️ 只返回**当前账号有权限的学段**的班级，避免越权看到别的学段的班
 * ============================================================ */
teachingAttendanceRouter.get(
  '/classes',
  wrap(async (req, res) => {
    res.json(ok(await svc.listClassOptions(req.user), '查询成功'));
  }),
);
