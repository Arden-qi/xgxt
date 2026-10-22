/**
 * 退费管理 · 路由
 * 接口前缀：/api/finance/refund
 *
 * 接口清单：
 *   GET    /list          退费列表（分页 + 筛选）
 *   GET    /detail        退费详情（含审批链）
 *   POST   /apply         提交退费申请
 *   POST   /pay           财务确认出款（生成退费账单）
 *   POST   /reject        驳回退费单
 *   POST   /advance       推进审批链（联调用，正式环境由各审批人操作）
 */

import { Router } from 'express';
import { z } from 'zod';
import { BizCode, RefundStatus } from 'shared-types/finance';
import { ok, page } from '../utils/response';
import { db } from '../utils/db';
import { wrap } from '../utils/wrap';
import { validate } from '../middleware/validate';
import { checkPermission } from '../middleware/auth';
import { BizError } from '../middleware/errorHandler';
import {
  REFUND_TABLE,
  toRefundListItem,
  toRefundDetail,
  buildRefundQuery,
  applyRefund,
  payRefund,
  rejectRefund,
  advanceRefund,
  loadRefundItems,
  itemsOfRefund,
} from '../services/refund.service';

export const refundRouter = Router();

function operatorOf(req: any): { userId: string; userName: string } {
  return {
    userId: req.user?.userId || 'system',
    userName: req.user?.userName || '系统',
  };
}

/* ============================================================
 * 1. 退费列表
 *    GET /api/finance/refund/list?page=1&size=20&refundStatus=4
 * ============================================================ */

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(100).default(20),
  studentNo: z.string().optional(),
  studentName: z.string().optional(),
  classId: z.string().optional(),
  deptCode: z.coerce.number().int().optional(),
  refundStatus: z.coerce.number().int().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  keyword: z.string().optional(),
});

refundRouter.get(
  '/list',
  validate(listSchema),
  wrap(async (req, res) => {
    const q = (req as any).validated as z.infer<typeof listSchema>;
    const query = buildRefundQuery(q);

    const [{ total }] = await query.clone().count({ total: '*' });

    /**
     * ⭐ 排序（2026-10-15 用户指令）：「待出退费的状态优先在上面」
     *
     * 为什么：
     *   这一页是财务的【出款工作台】，财务进来第一眼要看的是
     *   「还有哪些退费等着我打款」，而不是最新的申请。
     *   只按 create_time 排的话，刚处理完的单会把待办淹下去。
     *
     * 怎么排（两级）：
     *   ① 待财务出款(PENDING_FINANCE=4) → 0，排最前；其余 → 1
     *   ② 同组内仍按 create_time desc（新单在前，保留原来的体感）
     */
    const rows = await query
      .clone()
      .select('*')
      .orderByRaw('CASE WHEN refund_status = ? THEN 0 ELSE 1 END ASC', [
        RefundStatus.PENDING_FINANCE,
      ])
      .orderBy('create_time', 'desc')
      .limit(q.size)
      .offset((q.page - 1) * q.size);

    /**
     * ★ 2026-10-22：补费用项明细
     *
     * 一笔退费可含多个项目（学费 + 住宿费），财务侧**每个项目一行**。
     * 列表一次批量查一页的明细，不在循环里逐条查（N+1）。
     */
    const itemMap = await loadRefundItems(rows.map((r: any) => r.id));

    res.json(
      page(
        rows.map((r: any) => ({ ...toRefundListItem(r), items: itemMap.get(r.id) || [] })),
        Number(total),
        q,
      ),
    );
  }),
);

/* ============================================================
 * 2. 退费详情（含完整审批链时间轴）
 *    GET /api/finance/refund/detail?id=xxx
 * ============================================================ */

refundRouter.get(
  '/detail',
  validate(z.object({ id: z.string().min(1, '必须传 id') })),
  wrap(async (req, res) => {
    const { id } = (req as any).validated as { id: string };
    const row = await db(REFUND_TABLE).where({ id, is_deleted: false }).first();
    if (!row) {
      throw new BizError(BizCode.PARAM_ERROR, '退费单不存在');
    }
    // ★ 2026-10-22：带上费用项明细（前端详情里逐项列出，出款仍是一次）
    const items = await itemsOfRefund(id);
    res.json(ok({ ...toRefundDetail(row), items }));
  }),
);

/* ============================================================
 * 3. 提交退费申请
 *    POST /api/finance/refund/apply
 * ============================================================ */

const applySchema = z.object({
  studentId: z.string().min(1, '学生ID必填'),
  studentNo: z.string().min(1, '学号必填'),
  studentName: z.string().min(1, '姓名必填'),
  classId: z.string().optional(),
  className: z.string().optional(),
  deptCode: z.coerce.number().int().optional(),
  /** 退费项目，可多选 */
  refundItems: z.array(z.coerce.number().int().min(1).max(5)).min(1, '请至少选择一个退费项目'),
  /**
   * ★ 2026-10-22：费用项明细（含各自金额，单位「分」）
   *
   * 上游（教学域）推送时必带 —— 每个费用项在财务侧对应一行。
   * 不传则按「refundItems + refundAmount」落一行，向后兼容老调用方。
   */
  refundItemDetails: z
    .array(
      z.object({
        feeType: z.coerce.number().int().min(1).max(5),
        amount: z.coerce.number().int().min(0),
      }),
    )
    .optional(),
  /** 上游模块（teaching / consult），配合 sourceRefundId 做幂等 */
  sourceModule: z.string().max(32).optional(),
  /** 上游学段（jh / class / job） */
  sourceStage: z.string().max(16).optional(),
  /** 上游退费单 id */
  sourceRefundId: z.string().max(64).optional(),
  /** 上游校长审批通过时间（点亮财务时间轴） */
  upstreamApproveTime: z.string().max(32).optional(),
  /** 上游校长审批人姓名 */
  upstreamApproverName: z.string().max(64).optional(),
  /** ⚠️ 金额单位「分」 */
  refundAmount: z.coerce.number().int().positive('退费金额必须大于 0（单位：分）'),
  refundReason: z.string().min(1, '退费原因必填').max(255),
  attachmentUrl: z.string().max(255).optional(),
  sourceType: z.coerce.number().int().min(1).max(2).optional(),
  remark: z.string().max(500).optional(),
});

refundRouter.post(
  '/apply',
  checkPermission('finance:refund:apply'),
  validate(applySchema),
  wrap(async (req, res) => {
    const body = (req as any).validated as z.infer<typeof applySchema>;
    const r = await applyRefund(body, operatorOf(req));
    // 幂等命中 → 不重复建单，提示也用「已存在」口径，避免调用方以为推了两张
    const msg = r.duplicated
      ? `该退费单已推送过（单号 ${r.orderNo}），本次仅同步费用项明细`
      : `退费申请已提交，单号 ${r.orderNo}`;
    res.json(ok(r, msg));
  }),
);

/* ============================================================
 * 4. 财务确认出款
 *    POST /api/finance/refund/pay
 *
 * ⚠️ 财务模块最关键的写操作：真金白银出去的那一刻
 * ============================================================ */

const paySchema = z.object({
  id: z.string().min(1, '必须传 id'),
  payMethod: z.coerce.number().int().min(1).max(4).optional(),
  remark: z.string().max(500).optional(),
});

refundRouter.post(
  '/pay',
  checkPermission('finance:refund:pay'),
  validate(paySchema),
  wrap(async (req, res) => {
    const body = (req as any).validated as z.infer<typeof paySchema>;
    const billNo = await payRefund(body.id, operatorOf(req), body.payMethod, body.remark);
    res.json(ok({ billNo }, `出款成功，已生成退费账单 ${billNo}`));
  }),
);

/* ============================================================
 * 5. 驳回退费单
 *    POST /api/finance/refund/reject
 * ============================================================ */

const rejectSchema = z.object({
  id: z.string().min(1, '必须传 id'),
  rejectReason: z.string().min(1, '驳回原因必填').max(255),
});

refundRouter.post(
  '/reject',
  checkPermission('finance:refund:pay'),
  validate(rejectSchema),
  wrap(async (req, res) => {
    const body = (req as any).validated as z.infer<typeof rejectSchema>;
    await rejectRefund(body.id, body.rejectReason, operatorOf(req));
    res.json(ok(null, '已驳回该退费单'));
  }),
);

/* ============================================================
 * 6. 推进审批链（联调辅助接口）
 *    POST /api/finance/refund/advance
 * ============================================================ */

const advanceSchema = z.object({
  id: z.string().min(1, '必须传 id'),
  needPrincipal: z.coerce.boolean().optional(),
});

refundRouter.post(
  '/advance',
  checkPermission('finance:refund:pay'),
  validate(advanceSchema),
  wrap(async (req, res) => {
    const body = (req as any).validated as z.infer<typeof advanceSchema>;
    const nextStatus = await advanceRefund(body.id, operatorOf(req), body.needPrincipal);
    res.json(ok({ refundStatus: nextStatus }, '审批链已推进'));
  }),
);

export default refundRouter;
