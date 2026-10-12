/**
 * 退费统一接口 · `/api/teaching/refund/*`
 * ============================================================
 * 取代原三套（共 20+ 个）接口：
 *   · 实训 `/api/job/refund/{page,detail,create,submit,approve,reject,cancel,finance-confirm,student-options,summary}`
 *   · 大学 `/api/class/refund/{list,detail,add,withdraw,approve,...}`
 *   · 初高 `/api/class-jh/refund/{page,detail,save,update,submit,approve,...}`
 *
 * 学段由 `stage` 参数区分（jh / class / job）。
 * 老接口**一个都没删**，随时可回退。
 */

import { Router } from 'express';
import { BizCode } from 'shared-types';
import { ok, page } from '../../utils/response';
import { wrap } from '../../utils/wrap';
import { BizError } from '../../middleware/errorHandler';
import { REFUND_CHAIN_NODES, TEACHING_STAGES, type TeachingStage } from '../shared/dto';
import * as svc from './service';

export const teachingRefundRouter = Router();

/* ---------------- 入参小工具 ---------------- */

function str(v: unknown): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  return String(v);
}

function optNum(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function optStage(v: unknown): TeachingStage | undefined {
  const s = str(v);
  if (!s) return undefined;
  if (!TEACHING_STAGES.includes(s as TeachingStage)) {
    throw new BizError(BizCode.PARAM_ERROR, `学段参数非法：${s}`);
  }
  return s as TeachingStage;
}

function mustStage(v: unknown): TeachingStage {
  const s = optStage(v);
  if (!s) throw new BizError(BizCode.PARAM_ERROR, '缺少学段参数 stage');
  return s;
}

function optIntIn(v: unknown, min: number, max: number): number | undefined {
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  const i = Math.round(n);
  if (i < min || i > max) return undefined;
  return i;
}

/* ============================================================
 * 1. 列表  GET /api/teaching/refund/list
 * ============================================================ */

teachingRefundRouter.get(
  '/list',
  wrap(async (req, res) => {
    const q = {
      stage: optStage(req.query.stage),
      page: Math.max(1, Number(req.query.page) || 1),
      size: Math.min(200, Math.max(1, Number(req.query.size) || 20)),
      keyword: str(req.query.keyword),
      classId: str(req.query.classId),
      status: optIntIn(req.query.status, 1, 6),
      onlyMine: req.query.onlyMine === 'true' || req.query.onlyMine === '1',
      startDate: str(req.query.startDate),
      endDate: str(req.query.endDate),
    };
    const { rows, total } = await svc.list(q, req.user);
    res.json(page(rows, total, q));
  }),
);

/* ============================================================
 * 2. 详情（含审批轨迹）  GET /api/teaching/refund/detail?id=
 * ============================================================ */

teachingRefundRouter.get(
  '/detail',
  wrap(async (req, res) => {
    const id = str(req.query.id);
    if (!id) throw new BizError(BizCode.PARAM_ERROR, '缺少 id');
    const d = await svc.detail(id, req.user);
    res.json(ok(d));
  }),
);

/* ============================================================
 * 3. 学生下拉  GET /api/teaching/refund/student-options?stage=&keyword=
 * ============================================================ */

teachingRefundRouter.get(
  '/student-options',
  wrap(async (req, res) => {
    const stage = mustStage(req.query.stage);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const rows = await svc.studentOptions(stage, str(req.query.keyword) || '', limit, req.user);
    res.json(ok(rows));
  }),
);

/* ============================================================
 * 4. 班级下拉（跨学段统一）  GET /api/teaching/refund/classes
 * ============================================================ */

teachingRefundRouter.get(
  '/classes',
  wrap(async (req, res) => {
    const rows = await svc.classOptions(req.user);
    res.json(ok(rows));
  }),
);

/* ============================================================
 * 5. 汇总  GET /api/teaching/refund/summary
 * ============================================================ */

teachingRefundRouter.get(
  '/summary',
  wrap(async (req, res) => {
    const rows = await svc.summary(req.user);
    res.json(ok(rows));
  }),
);

/* ============================================================
 * 6. 审批链说明（前端展示"本模块走哪几步"）
 *    GET /api/teaching/refund/chain
 * ============================================================ */

teachingRefundRouter.get(
  '/chain',
  wrap(async (_req, res) => {
    res.json(
      ok({
        nodes: REFUND_CHAIN_NODES,
        remark: '★ 三学段统一采用实训审批链（2026-10-09 拍板）：学管 → 校长；通过后通知财务出款。',
      }),
    );
  }),
);

/* ============================================================
 * 7. 新建  POST /api/teaching/refund/create
 *    body: { stage, studentId, items:[{feeType,amount}], refundAmount, refundReason, ... }
 * ============================================================ */

teachingRefundRouter.post(
  '/create',
  wrap(async (req, res) => {
    const b = req.body || {};
    const stage = mustStage(b.stage);
    if (!str(b.studentId)) throw new BizError(BizCode.PARAM_ERROR, '学生必选');
    if (!str(b.refundReason)) throw new BizError(BizCode.PARAM_ERROR, '退费原因必填');

    const items = Array.isArray(b.items)
      ? b.items.map((x: any) => ({
          feeType: Number(x?.feeType ?? 0),
          amount: Math.round(Number(x?.amount ?? 0)),
        }))
      : [];
    if (!items.length) throw new BizError(BizCode.PARAM_ERROR, '请至少填一项退费费用');

    const refundAmount = Math.round(Number(b.refundAmount ?? 0));

    const r = await svc.create(
      {
        stage,
        studentId: String(b.studentId),
        items,
        refundAmount,
        applyDate: str(b.applyDate),
        refundReason: String(b.refundReason),
        remark: str(b.remark) ?? null,
        submit: b.submit === true || b.submit === 'true',
      },
      req.user,
    );
    res.json(ok(r, '退费申请已创建'));
  }),
);

/* ============================================================
 * 8. 提交  POST /api/teaching/refund/submit
 * ============================================================ */

teachingRefundRouter.post(
  '/submit',
  wrap(async (req, res) => {
    const b = req.body || {};
    const stage = mustStage(b.stage);
    if (!str(b.id)) throw new BizError(BizCode.PARAM_ERROR, '缺少 id');
    const r = await svc.submit(stage, String(b.id), req.user);
    res.json(ok(r, '已提交'));
  }),
);

/* ============================================================
 * 9. 审批  POST /api/teaching/refund/approve
 *    body: { stage, id, comment? }
 * ============================================================ */

teachingRefundRouter.post(
  '/approve',
  wrap(async (req, res) => {
    const b = req.body || {};
    const stage = mustStage(b.stage);
    if (!str(b.id)) throw new BizError(BizCode.PARAM_ERROR, '缺少 id');
    const r = await svc.approve(stage, String(b.id), str(b.comment), req.user);
    res.json(ok(r, r.finished ? '审批通过（已通知财务）' : '已通过本环节'));
  }),
);

/* ============================================================
 * 10. 驳回  POST /api/teaching/refund/reject
 * ============================================================ */

teachingRefundRouter.post(
  '/reject',
  wrap(async (req, res) => {
    const b = req.body || {};
    const stage = mustStage(b.stage);
    if (!str(b.id)) throw new BizError(BizCode.PARAM_ERROR, '缺少 id');
    if (!str(b.reason)) throw new BizError(BizCode.PARAM_ERROR, '驳回原因必填');
    const r = await svc.reject(stage, String(b.id), String(b.reason), req.user);
    res.json(ok(r, '已驳回'));
  }),
);

/* ============================================================
 * 11. 撤回  POST /api/teaching/refund/cancel
 * ============================================================ */

teachingRefundRouter.post(
  '/cancel',
  wrap(async (req, res) => {
    const b = req.body || {};
    const stage = mustStage(b.stage);
    if (!str(b.id)) throw new BizError(BizCode.PARAM_ERROR, '缺少 id');
    const r = await svc.cancel(stage, String(b.id), str(b.reason), req.user);
    res.json(ok(r, '已撤回'));
  }),
);

/* ============================================================
 * 12. 财务确认出款  POST /api/teaching/refund/finance-confirm
 * ============================================================ */

teachingRefundRouter.post(
  '/finance-confirm',
  wrap(async (req, res) => {
    const b = req.body || {};
    const stage = mustStage(b.stage);
    if (!str(b.id)) throw new BizError(BizCode.PARAM_ERROR, '缺少 id');
    await svc.financeConfirm(
      stage,
      String(b.id),
      { financeRemark: str(b.financeRemark), refundTime: str(b.refundTime) },
      req.user,
    );
    res.json(ok(null, '出款已登记'));
  }),
);
