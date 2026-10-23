import { Router } from 'express';
import { z } from 'zod';
import { Knex } from 'knex';
import { ApplyType, PermAction, RefundStatus, RoleCode } from 'shared-types/class';
import { db } from '../../db';
import { Errors, ok, pageData } from '../../http/response';
import { pageQuerySchema, q, validate } from '../../lib/validate';
import { baseInsert, baseUpdate, maxApplyNo, notDeleted, paginate } from '../../lib/repo';
import { requirePerm } from '../../lib/permGuard';
import { rowsToCamel } from '../../lib/case';
import { buildApplyNo, now, seqOfApplyNo, uuid } from '../../lib/ids';
import { FeeTypeName, RefundStatusHandlerRole, RefundStatusName } from '../../lib/dict';
import { hasAnyRole, isPrincipal } from '../../lib/authUser';
import { assertClassAccess } from '../../middleware/dataScope';
import { applySyncScope } from '../shared/syncScope';
import {
  logApproval,
  PRINCIPAL_ROLES,
  sendNotify,
  sendNotifyByRole,
  STUDY_MANAGER_ROLES,
} from '../shared/flow';
import { config } from '../../config';
import { wrap } from '../../middleware/error';
import { tbl, tblTrx, tblInsTrx } from '../../../teaching/shared/uniTable';
import { actorId, actorIds, isActor } from '../../../utils/actor';

/** 本模块只服务大学学段 */
const SRC = 'sms_class';
const STAGE = 'class' as const;

/**
 * 退费审批（字典 4.8 五级链，用户确认「退费仍按字典 5 级走」）
 *
 * 待提交(1) → 待经理审批(2，学管) → 待教务核算(3) → 待财务出款(4)
 *           → 待校长审批(5，超阈值时) → 已退费(6) / 已驳回(7)
 *
 * 是否走校长环节由 `REFUND_PRINCIPAL_THRESHOLD`（单位：分）决定：
 *   阈值 0 = 所有退费都需校长审批（当前需求）。
 */
export const refundRouter = Router();

const NODE_ROLE: Record<number, string[]> = {
  [RefundStatus.PENDING_MANAGER]: STUDY_MANAGER_ROLES,
  [RefundStatus.PENDING_ACADEMIC]: [RoleCode.EDU_ADMIN, ...STUDY_MANAGER_ROLES, RoleCode.ADMIN],
  [RefundStatus.PENDING_FINANCE]: [RoleCode.FINANCE],
  [RefundStatus.PENDING_PRINCIPAL]: PRINCIPAL_ROLES,
};

function canApproveAt(user: NonNullable<import('express').Request['user']>, status: number): boolean {
  if (hasAnyRole(user, [RoleCode.ADMIN])) return true;
  const roles = NODE_ROLE[status];
  if (!roles) return false;
  // ⚠️ 这里只能判断「登录人」是否具备节点角色，不能判断「节点允许的角色里是否含 ADMIN」——
  //    后者恒为真，会导致任何角色都能审批该节点（曾出现的越权漏洞）。
  if (roles.some((r) => user.roles.includes(r))) return true;

  /**
   * ★ 2026-10-23 已**删除**旧的「学管代为推进」口子。
   *
   * 原代码：
   *   `if (isStudyManager(user) && status !== RefundStatus.PENDING_FINANCE) return true;`
   * 注释写的理由是「学管在本链上是经理，允许其在后续节点代为推进，避免流程卡死」。
   *
   * 问题（用户 2026-10-23 口径：「退费中学管审批后是校长审批，学管不能代替校长审批」）：
   *   · 这条是 `status !== 待财务` 的全放行 —— 学管不只能批「待校长」，
   *     连「待教务核算」也一并吃掉，等于把中间两个节点都架空；
   *   · 「避免卡死」是伪需求：真卡住是没人有该角色，应当补人/补角色，
   *     不是让一个角色通吃 —— 审批轨迹上看不出是谁在哪个节点签的字。
   *
   * 现在：各节点只认 `NODE_ROLE` 里配置的角色（待校长 = PRINCIPAL_ROLES），
   *      学管在「待校长」节点调用会走 route 里 `!canApproveAt` 分支 → 40302。
   *
   * ⚠️ 统一链（`/api/teaching/refund/*`）走 shared-types 的 `canApprove()`，
   *    那边同日也删掉了同一口子，两套链路口径一致。
   */
  return false;
}

/** 当前状态的下一状态 */
function nextStatus(current: number, isNeedPrincipal: boolean): number {
  switch (current) {
    case RefundStatus.PENDING_MANAGER:
      return RefundStatus.PENDING_ACADEMIC;
    case RefundStatus.PENDING_ACADEMIC:
      return RefundStatus.PENDING_FINANCE;
    case RefundStatus.PENDING_FINANCE:
      return isNeedPrincipal ? RefundStatus.PENDING_PRINCIPAL : RefundStatus.REFUNDED;
    case RefundStatus.PENDING_PRINCIPAL:
      return RefundStatus.REFUNDED;
    default:
      return current;
  }
}

/* ============================== 发起申请 ============================== */

const addSchema = z.object({
  studentId: z.string().min(1, '缺少学生ID'),
  refundItems: z
    .array(
      z.object({
        feeType: z.coerce.number().int('退费项目不能为空'),
        amount: z.coerce.number().int('该项退费金额（分）不能为空'),
      }),
    )
    .min(1, '请至少选择一个退费项目'),
  refundAmount: z.coerce.number().int('退费总金额不能为空'),
  refundReason: z.string().min(1, '退费原因不能为空'),
  /** 申请时间（可选，YYYY-MM-DD）；不传则取系统当前时间 */
  applyTime: z.string().optional().nullable(),
});

/**
 * @openapi
 * /api/class/refund/add:
 *   post:
 *     tags: [审批流程]
 *     summary: 5.6 提交退费申请（班主任）
 *     description: |
 *       退费金额单位一律「分」。提交后进入「待经理审批」（学管），
 *       并按字典 4.8 依次流转：教务核算 → 财务出款 → （超阈值）校长审批 → 已退费。
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [studentId, refundItems, refundAmount, refundReason]
 *             properties:
 *               studentId: { type: string }
 *               refundItems:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     feeType: { type: integer, example: 1 }
 *                     amount: { type: integer, example: 500000 }
 *               refundAmount: { type: integer, example: 500000 }
 *               refundReason: { type: string }
 *     responses:
 *       200: { description: 提交成功，返回申请单号 }
 */
refundRouter.post(
  '/add',
  requirePerm('refund', PermAction.ADD),
  validate({ body: addSchema }),
  wrap(async (req, res) => {
    const user = req.user!;
    const b = req.body as z.infer<typeof addSchema>;

    const stu = (await notDeleted(tbl(db, SRC, 't_class_student', STAGE)).where('id', b.studentId).first()) as
      | Record<string, unknown>
      | undefined;
    if (!stu) throw Errors.studentNotFound();
    assertClassAccess(user, stu.class_id as string | null, '该学生');

    const sum = b.refundItems.reduce((acc, x) => acc + Number(x.amount || 0), 0);
    if (sum !== Number(b.refundAmount)) {
      throw Errors.param(`退费总额（${(b.refundAmount / 100).toFixed(2)} 元）与各项目之和（${(sum / 100).toFixed(2)} 元）不一致，请核对`);
    }
    if (sum <= 0) throw Errors.param('退费总金额必须大于 0');

    const pending = await notDeleted(tbl(db, SRC, 't_class_refund_apply', STAGE))
      .where('student_id', b.studentId)
      .whereIn('refund_status', [
        RefundStatus.PENDING_MANAGER,
        RefundStatus.PENDING_ACADEMIC,
        RefundStatus.PENDING_FINANCE,
        RefundStatus.PENDING_PRINCIPAL,
      ])
      .first();
    if (pending) {
      throw Errors.param(`该学生已有一条进行中的退费申请（${String(pending.apply_no)}），请勿重复提交`);
    }

    const ymd = now().slice(0, 10).replace(/-/g, '');
    const maxNo = await maxApplyNo(tbl(db, SRC, 't_class_refund_apply', STAGE), 't_class_refund_apply', 'TF', ymd);
    const applyNo = buildApplyNo('REFUND', seqOfApplyNo(maxNo) + 1);

    const isNeedPrincipal = b.refundAmount >= config.business.refundPrincipalThreshold;
    const id = uuid();
    const t = now();
    /** 申请时间：前端可指定日期，时间部分仍取当前时刻；不传则整条取当前时间 */
    const applyTimeStr = b.applyTime ? `${String(b.applyTime).slice(0, 10)} ${t.slice(11, 19)}` : t;

    await db.transaction(async (trx) => {
      await tblInsTrx(trx, SRC, 't_class_refund_apply', STAGE, {
        ...baseInsert(user, id),
        apply_no: applyNo,
        student_id: b.studentId,
        student_no: stu.student_no as string,
        student_name: stu.student_name as string,
        class_id: (stu.class_id as string) ?? null,
        class_name: (stu.class_name as string) ?? null,
        dept_code: (stu.dept_code as number) ?? null,
        refund_amount: b.refundAmount,
        refund_reason: b.refundReason,
        refund_status: RefundStatus.PENDING_MANAGER,
        is_need_principal: isNeedPrincipal ? 1 : 0,
        applicant_id: actorId(user),
        applicant_name: user.userName,
        apply_time: applyTimeStr,
        current_handler_role: RefundStatusHandlerRole[RefundStatus.PENDING_MANAGER] ?? null,
      } as never);

      for (const item of b.refundItems) {
        await tblInsTrx(trx, SRC, 't_class_refund_item', STAGE, {
          ...baseInsert(user),
          refund_id: id,
          fee_type: item.feeType,
          amount: item.amount,
        } as never);
      }

      await logApproval(trx, {
        applyType: ApplyType.REFUND,
        applyNo,
        bizId: id,
        action: 'submit',
        fromStatus: RefundStatus.DRAFT,
        toStatus: RefundStatus.PENDING_MANAGER,
        user,
        opinion: b.refundReason,
      });

      await sendNotifyByRole(
        trx,
        {
          notifyType: 3,
          applyType: ApplyType.REFUND,
          bizId: id,
          applyNo,
          title: `新的退费申请待审批：${String(stu.student_name)}`,
          content: `班主任 ${user.userName} 提交了 ${String(stu.student_name)}（${String(stu.student_no)}）的退费申请，金额 ${(b.refundAmount / 100).toFixed(2)} 元，请审批。`,
          linkPath: `/refund/detail?id=${id}`,
        },
        STUDY_MANAGER_ROLES,
      );
    });

    return ok(
      res,
      { applyId: id, applyNo, refundStatus: RefundStatus.PENDING_MANAGER },
      '退费申请已提交，等待学管审批',
    );
  }),
);

/* ============================== 撤回（申请人） ============================== */

const withdrawSchema = z.object({
  bizId: z.string().min(1, '缺少申请单ID'),
  reason: z.string().optional().nullable(),
});

/**
 * @openapi
 * /api/class/refund/withdraw:
 *   post:
 *     tags: [审批流程]
 *     summary: 撤回退费申请（申请人本人，进入审批前）
 *     description: |
 *       班主任发起的退费申请，在「待经理审批」之前（尚未被任何人处理）可主动撤回。
 *       撤回后状态置为「已撤回」，不再进入审批链。已流转到后续节点的申请不能撤回，
 *       只能由当前节点驳回。
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [bizId]
 *             properties:
 *               bizId: { type: string }
 *               reason: { type: string, description: 撤回原因（可选） }
 *     responses:
 *       200: { description: 撤回结果 }
 */
refundRouter.post(
  '/withdraw',
  requirePerm('refund', PermAction.ADD),
  validate({ body: withdrawSchema }),
  wrap(async (req, res) => {
    const user = req.user!;
    const b = req.body as z.infer<typeof withdrawSchema>;

    const apply = (await notDeleted(tbl(db, SRC, 't_class_refund_apply', STAGE)).where('id', b.bizId).first()) as
      | Record<string, unknown>
      | undefined;
    if (!apply) throw Errors.applyNotFound('退费申请单不存在');

    // **只有申请人本人**可以撤回：撤回是「发起人」的动作，不是「审批人」的动作。
    // 这里刻意不给全量权限角色开后门——否则「学管能否撤掉班主任的申请」就变得含糊。
    if (!isActor(user, apply.applicant_id)) {
      throw Errors.noOperationPermission('只有该申请的发起人可以撤回');
    }

    const status = apply.refund_status as number;
    if (status !== RefundStatus.PENDING_MANAGER && status !== RefundStatus.DRAFT) {
      throw Errors.param('该申请已进入审批流程，无法撤回；如需终止，请联系当前审批人驳回');
    }

    const applyNo = apply.apply_no as string;
    const studentName = apply.student_name as string;
    const t = now();

    await db.transaction(async (trx) => {
      await tblTrx(trx, SRC, 't_class_refund_apply', STAGE).where({ id: b.bizId }).update({
        refund_status: RefundStatus.WITHDRAWN,
        current_handler_role: null,
        ...baseUpdate(user),
      } as never);

      await logApproval(trx, {
        applyType: ApplyType.REFUND,
        applyNo,
        bizId: b.bizId,
        action: 'withdraw',
        fromStatus: status,
        toStatus: RefundStatus.WITHDRAWN,
        user,
        opinion: b.reason?.trim() || '申请人主动撤回',
      });

      await sendNotifyByRole(
        trx,
        {
          notifyType: 2,
          applyType: ApplyType.REFUND,
          bizId: b.bizId,
          applyNo,
          title: `退费申请已撤回：${studentName}`,
          content: `班主任 ${user.userName} 撤回了 ${studentName} 的退费申请（${applyNo}），无需继续审批。`,
          linkPath: `/refund/detail?id=${b.bizId}`,
        },
        STUDY_MANAGER_ROLES,
      );
    });

    return ok(
      res,
      { bizId: b.bizId, refundStatus: RefundStatus.WITHDRAWN, refundStatusName: RefundStatusName[RefundStatus.WITHDRAWN] },
      '已撤回该退费申请',
    );
  }),
);

/* ============================== 审批 ============================== */

const approveSchema = z.object({
  bizId: z.string().min(1, '缺少申请单ID'),
  action: z.enum(['approve', 'reject'], { errorMap: () => ({ message: '审批动作只能是 approve / reject' }) }),
  opinion: z.string().optional().nullable(),
});

/**
 * @openapi
 * /api/class/refund/approve:
 *   post:
 *     tags: [审批流程]
 *     summary: 5.7 退费审批（按当前节点自动判定该谁审）
 *     description: |
 *       节点与处理角色：
 *       - 2 待经理审批 → 学管
 *       - 3 待教务核算 → 教务老师（学管可代）
 *       - 4 待财务出款 → 财务
 *       - 5 待校长审批 → 校长（仅超过阈值时出现）
 *       驳回必须填原因，单子回到班主任并通知。
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [bizId, action]
 *             properties:
 *               bizId: { type: string }
 *               action: { type: string, enum: [approve, reject] }
 *               opinion: { type: string }
 *     responses:
 *       200: { description: 审批结果与最新状态 }
 */
refundRouter.post(
  '/approve',
  validate({ body: approveSchema }),
  wrap(async (req, res) => {
    const user = req.user!;
    const b = req.body as z.infer<typeof approveSchema>;

    const apply = (await notDeleted(tbl(db, SRC, 't_class_refund_apply', STAGE)).where('id', b.bizId).first()) as
      | Record<string, unknown>
      | undefined;
    if (!apply) throw Errors.applyNotFound('退费申请单不存在');

    const status = apply.refund_status as number;
    const applyNo = apply.apply_no as string;
    const studentName = apply.student_name as string;
    const isNeedPrincipal = Number(apply.is_need_principal) === 1;

    if (status === RefundStatus.REFUNDED || status === RefundStatus.REJECTED || status === RefundStatus.DRAFT || status === RefundStatus.WITHDRAWN) {
      throw Errors.param('该退费申请已结束，无法继续审批');
    }
    if (!canApproveAt(user, status)) {
      throw Errors.noOperationPermission(`当前节点应由「${RefundStatusHandlerRole[status] ?? '指定角色'}」处理，您无权操作`);
    }
    if (b.action === 'reject' && (!b.opinion || !b.opinion.trim())) {
      throw Errors.required('驳回原因');
    }

    const toStatus = b.action === 'reject' ? RefundStatus.REJECTED : nextStatus(status, isNeedPrincipal);
    const t = now();

    await db.transaction(async (trx) => {
      await tblTrx(trx, SRC, 't_class_refund_apply', STAGE).where({ id: b.bizId }).update({
        refund_status: toStatus,
        current_handler_role: RefundStatusHandlerRole[toStatus] ?? null,
        ...(b.action === 'reject' ? { reject_reason: b.opinion } : {}),
        ...baseUpdate(user),
      } as never);

      await logApproval(trx, {
        applyType: ApplyType.REFUND,
        applyNo,
        bizId: b.bizId,
        action: b.action === 'approve' ? 'approve' : 'reject',
        fromStatus: status,
        toStatus,
        user,
        opinion: b.opinion ?? undefined,
      });

      if (toStatus === RefundStatus.REJECTED) {
        await sendNotify(
          trx,
          {
            notifyType: 2,
            applyType: ApplyType.REFUND,
            bizId: b.bizId,
            applyNo,
            title: `退费申请被驳回：${studentName}`,
            content: `您提交的退费申请（${applyNo}）在「${RefundStatusName[status]}」环节被 ${user.userName} 驳回，原因：${b.opinion ?? '未填写'}`,
            linkPath: `/refund/detail?id=${b.bizId}`,
          },
          { userId: apply.applicant_id as string, userName: apply.applicant_name as string },
        );
        await sendNotifyByRole(
          trx,
          {
            notifyType: 2,
            applyType: ApplyType.REFUND,
            bizId: b.bizId,
            applyNo,
            title: `退费申请被驳回：${studentName}`,
            content: `退费申请 ${applyNo} 在「${RefundStatusName[status]}」环节被 ${user.userName} 驳回，原因：${b.opinion ?? '未填写'}`,
            linkPath: `/refund/detail?id=${b.bizId}`,
          },
          STUDY_MANAGER_ROLES,
        );
        return;
      }

      if (toStatus === RefundStatus.REFUNDED) {
        await sendNotify(
          trx,
          {
            notifyType: 1,
            applyType: ApplyType.REFUND,
            bizId: b.bizId,
            applyNo,
            title: `退费已完成：${studentName}`,
            content: `退费申请（${applyNo}）已走完全部审批节点，金额 ${(Number(apply.refund_amount) / 100).toFixed(2)} 元，流程结束。`,
            linkPath: `/refund/detail?id=${b.bizId}`,
          },
          { userId: apply.applicant_id as string, userName: apply.applicant_name as string },
        );
        await sendNotifyByRole(
          trx,
          {
            notifyType: 1,
            applyType: ApplyType.REFUND,
            bizId: b.bizId,
            applyNo,
            title: `退费已完成：${studentName}`,
            content: `退费申请 ${applyNo} 已全部审批通过并完成出款，流程结束。`,
            linkPath: `/refund/detail?id=${b.bizId}`,
          },
          STUDY_MANAGER_ROLES,
        );
        return;
      }

      // 通知下一节点处理人
      const nextRoles = NODE_ROLE[toStatus] ?? [];
      await sendNotifyByRole(
        trx,
        {
          notifyType: 3,
          applyType: ApplyType.REFUND,
          bizId: b.bizId,
          applyNo,
          title: `退费申请待您处理：${studentName}`,
          content: `退费申请 ${applyNo} 已流转到「${RefundStatusName[toStatus]}」，请及时处理。金额 ${(Number(apply.refund_amount) / 100).toFixed(2)} 元。`,
          linkPath: `/refund/detail?id=${b.bizId}`,
        },
        nextRoles,
      );
    });

    const statusName = RefundStatusName[toStatus] ?? '';
    return ok(
      res,
      { bizId: b.bizId, refundStatus: toStatus, refundStatusName: statusName },
      toStatus === RefundStatus.REFUNDED
        ? '退费流程已走完，状态更新为「已退费」'
        : toStatus === RefundStatus.REJECTED
          ? '已驳回，已通知申请人'
          : `已通过，流转至「${statusName}」`,
    );
  }),
);

/* ============================== 列表 / 详情 ============================== */

const listSchema = z.object({
  ...pageQuerySchema.shape,
  classId: z.string().optional(),
  studentNo: z.string().optional(),
  studentName: z.string().optional(),
  refundStatus: z.coerce.number().int().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  keyword: z.string().optional(),
  onlyMine: z.coerce.boolean().optional(),
  onlyTodo: z.coerce.boolean().optional(),
});

/**
 * @openapi
 * /api/class/refund/list:
 *   get:
 *     tags: [审批流程]
 *     summary: 5.8 退费申请列表
 *     description: 老师只看本班；学管 / 校长看全部。`onlyTodo=true` 只看当前节点该我审的。
 *     responses:
 *       200: { description: 分页列表 }
 */
refundRouter.get(
  '/list',
  validate({ query: listSchema }),
  wrap(async (req, res) => {
    const user = req.user!;
    const query = q<z.infer<typeof listSchema>>(req);

    const base = tbl(db, SRC, 't_class_refund_apply', STAGE);
    notDeleted(base);
    await applySyncScope(base, user);
    if (query.classId) base.where('class_id', query.classId);
    if (query.studentNo) base.where('student_no', 'like', `%${query.studentNo}%`);
    if (query.studentName) base.where('student_name', 'like', `%${query.studentName}%`);
    if (query.refundStatus) base.where('refund_status', query.refundStatus);
    if (query.startDate) base.where('apply_time', '>=', `${query.startDate} 00:00:00`);
    if (query.endDate) base.where('apply_time', '<=', `${query.endDate} 23:59:59`);
    if (query.keyword) {
      const k = query.keyword;
      base.where(function (this: Knex.QueryBuilder) {
        this.where('student_no', 'like', `%${k}%`)
          .orWhere('student_name', 'like', `%${k}%`)
          .orWhere('apply_no', 'like', `%${k}%`);
      });
    }
    if (query.onlyMine) base.where('applicant_id', user.userId);
    if (query.onlyTodo) {
      const statuses = [1, 2, 3, 4, 5].filter(
        (s) => s !== RefundStatus.DRAFT && canApproveAt(user, s),
      );
      if (!statuses.length) base.whereRaw('1 = 0');
      else base.whereIn('refund_status', statuses);
    }
    base.orderBy('apply_time', 'desc');

    const paged = await paginate(base, query, async (qb) => {
      const rows = (await qb) as Array<Record<string, unknown>>;
      const ids = rows.map((r) => r.id as string);
      const items = ids.length
        ? ((await notDeleted(tbl(db, SRC, 't_class_refund_item', STAGE)).whereIn('refund_id', ids)) as Array<
            Record<string, unknown>
          >)
        : [];
      const byRefund = new Map<string, Array<Record<string, unknown>>>();
      for (const it of items) {
        const key = it.refund_id as string;
        if (!byRefund.has(key)) byRefund.set(key, []);
        byRefund.get(key)!.push(it);
      }

      return rows.map((r) => {
        const c = rowsToCamel<Record<string, unknown>>([r])[0];
        const st = r.refund_status as number;
        return {
          ...c,
          refundStatusName: RefundStatusName[st] ?? '未知',
          currentHandlerName: RefundStatusHandlerRole[st] ?? '—',
          isNeedPrincipal: Number(r.is_need_principal) === 1,
          refundAmountYuan: (Number(r.refund_amount ?? 0) / 100).toFixed(2),
          refundItems: (byRefund.get(r.id as string) ?? []).map((it) => ({
            feeType: it.fee_type as number,
            feeTypeName: FeeTypeName[it.fee_type as number] ?? '未知',
            amount: it.amount as number,
            amountYuan: (Number(it.amount ?? 0) / 100).toFixed(2),
          })),
        };
      });
    });

    return ok(res, pageData(paged.total, paged.page, paged.size, paged.list), '查询成功');
  }),
);

/**
 * @openapi
 * /api/class/refund/detail:
 *   get:
 *     tags: [审批流程]
 *     summary: 5.9 退费申请详情（含审批日志）
 *     parameters:
 *       - { in: query, name: id, schema: { type: string }, required: true }
 *     responses:
 *       200: { description: 详情 }
 */
refundRouter.get(
  '/detail',
  validate({ query: z.object({ id: z.string().min(1, '缺少申请单ID') }) }),
  wrap(async (req, res) => {
    const user = req.user!;
    const { id } = q<{ id: string }>(req);

    const apply = (await notDeleted(tbl(db, SRC, 't_class_refund_apply', STAGE)).where('id', id).first()) as
      | Record<string, unknown>
      | undefined;
    if (!apply) throw Errors.applyNotFound();
    assertClassAccess(user, apply.class_id as string | null, '该申请');

    const [items, logs] = await Promise.all([
      notDeleted(tbl(db, SRC, 't_class_refund_item', STAGE)).where('refund_id', id),
      notDeleted(tbl(db, SRC, 't_class_approval_log', STAGE)).where({ biz_id: id }).orderBy('operate_time', 'asc'),
    ]);

    const c = rowsToCamel<Record<string, unknown>>([apply])[0];
    const st = apply.refund_status as number;
    return ok(
      res,
      {
        apply: {
          ...c,
          refundStatusName: RefundStatusName[st] ?? '未知',
          isNeedPrincipal: Number(apply.is_need_principal) === 1,
          refundAmountYuan: (Number(apply.refund_amount ?? 0) / 100).toFixed(2),
          refundItems: (items as Array<Record<string, unknown>>).map((it) => ({
            feeType: it.fee_type as number,
            feeTypeName: FeeTypeName[it.fee_type as number] ?? '未知',
            amount: it.amount as number,
            amountYuan: (Number(it.amount ?? 0) / 100).toFixed(2),
          })),
        },
        logs: rowsToCamel(logs as Array<Record<string, unknown>>),
        nextHandlerRole: RefundStatusHandlerRole[st] ?? '—',
        canApprove: canApproveAt(user, st),
      },
      '查询成功',
    );
  }),
);
