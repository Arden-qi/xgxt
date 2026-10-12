import { Router } from 'express';
import { z } from 'zod';
import { RefundStatus, RoleCode, SuspendStatus, UpgradeStatus } from 'shared-types/class';
import { db } from '../../db';
import { ok, pageData } from '../../http/response';
import { pageQuerySchema, q, validate } from '../../lib/validate';
import { notDeleted } from '../../lib/repo';
import { rowsToCamel } from '../../lib/case';
import { hasAnyRole, isPrincipal, isStudyManager } from '../../lib/authUser';
import {
  ApplyTypeName,
  RefundStatusHandlerRole,
  RefundStatusName,
  SuspendStatusHandlerRole,
  SuspendStatusName,
  UpgradeStatusName,
} from '../../lib/dict';
import { wrap } from '../../middleware/error';
import { tbl } from '../../../teaching/shared/uniTable';

/**
 * 审批中心 / 我的待办
 *
 * 「当前登录人需要处理的单子」由**状态 + 角色**推导，不额外建待办表，
 * 避免出现「状态改了但待办没消」的双写不一致。
 *
 * ★ 第 4 期第 2 批：本文件 4 处裸访问老表已改走 `tbl()` 路由层。
 *   切读开关关 → 读老表（行为与改写前完全一致）；开 → 读统一表。
 *   学段固定 'class'：本模块是大学老审批接口。
 */
export const approvalRouter = Router();

/** 本模块只服务大学学段 */
const SRC = 'sms_class';
const STAGE = 'class' as const;

interface Todo {
  applyType: number;
  applyTypeName: string;
  bizId: string;
  applyNo: string;
  studentName: string;
  studentNo: string;
  className?: string | null;
  currentStatus: number;
  currentStatusName: string;
  submitTime: string;
  submitterName?: string | null;
  linkPath?: string;
  /** 该单子是否该当前登录人处理 */
  canApprove: boolean;
}

/**
 * @openapi
 * /api/class/approval/todo/list:
 *   get:
 *     tags: [审批流程]
 *     summary: 5.15 我的待办（休学 / 退学 / 退费 / 升学 四类汇总）
 *     description: |
 *       按当前登录人的角色与流程当前状态推导：
 *       - 学管：待经理审批的休学 / 退学、退费各节点、待接收的升学
 *       - 校长：待校长审批的退学与退费
 *       返回按提交时间倒序，含前端跳转路径。
 *     responses:
 *       200: { description: 分页待办列表 }
 */
approvalRouter.get(
  '/todo/list',
  validate({
    query: z.object({
      ...pageQuerySchema.shape,
      applyType: z.coerce.number().int().optional(),
    }),
  }),
  wrap(async (req, res) => {
    const user = req.user!;
    const query = q<{ page: number; size: number; applyType?: number }>(req);

    const isMgr = isStudyManager(user) || hasAnyRole(user, [RoleCode.ADMIN]);
    const isPrin = isPrincipal(user) || hasAnyRole(user, [RoleCode.ADMIN]);
    const todos: Todo[] = [];

    const wantSuspend = !query.applyType || query.applyType === 1 || query.applyType === 2;
    const wantRefund = !query.applyType || query.applyType === 3;
    const wantUpgrade = !query.applyType || query.applyType === 4;

    // ---- 休学 / 退学 ----
    if (wantSuspend && (isMgr || isPrin)) {
      const statuses: number[] = [];
      if (isMgr) statuses.push(SuspendStatus.PENDING_MANAGER);
      if (isPrin) statuses.push(SuspendStatus.PENDING_PRINCIPAL);
      if (statuses.length) {
        const rows = (await notDeleted(tbl(db, SRC, 't_class_suspend_apply', STAGE))
          .whereIn('apply_status', statuses)
          .orderBy('apply_time', 'desc')
          .limit(200)) as Array<Record<string, unknown>>;
        for (const r of rows) {
          const st = r.apply_status as number;
          todos.push({
            applyType: r.apply_type as number,
            applyTypeName: ApplyTypeName[r.apply_type as number] ?? '未知',
            bizId: r.id as string,
            applyNo: r.apply_no as string,
            studentName: r.student_name as string,
            studentNo: r.student_no as string,
            className: (r.class_name as string) ?? null,
            currentStatus: st,
            currentStatusName: SuspendStatusName[st] ?? '未知',
            submitTime: r.apply_time as string,
            submitterName: (r.applicant_name as string) ?? null,
            linkPath: `/approval/detail?id=${String(r.id)}`,
            canApprove: true,
          });
        }
      }
    }

    // ---- 退费 ----
    if (wantRefund && (isMgr || isPrin) && isMgr) {
      // 学管在退费链上可处理除「待财务出款」外的节点；财务 / 教务节点由各自角色处理
      const statuses = [
        RefundStatus.PENDING_MANAGER,
        RefundStatus.PENDING_ACADEMIC,
        ...(isPrin ? [RefundStatus.PENDING_PRINCIPAL] : []),
      ];
      const rows = (await notDeleted(tbl(db, SRC, 't_class_refund_apply', STAGE))
        .whereIn('refund_status', statuses)
        .orderBy('apply_time', 'desc')
        .limit(200)) as Array<Record<string, unknown>>;
      for (const r of rows) {
        const st = r.refund_status as number;
        todos.push({
          applyType: 3,
          applyTypeName: '退费',
          bizId: r.id as string,
          applyNo: r.apply_no as string,
          studentName: r.student_name as string,
          studentNo: r.student_no as string,
          className: (r.class_name as string) ?? null,
          currentStatus: st,
          currentStatusName: RefundStatusName[st] ?? '未知',
          submitTime: r.apply_time as string,
          submitterName: (r.applicant_name as string) ?? null,
          linkPath: `/refund/detail?id=${String(r.id)}`,
          canApprove: true,
        });
      }
    }

    // ---- 升学 ----
    if (wantUpgrade && isMgr) {
      const rows = (await notDeleted(tbl(db, SRC, 't_class_upgrade_apply', STAGE))
        .where('apply_status', UpgradeStatus.PENDING)
        .orderBy('apply_time', 'desc')
        .limit(200)) as Array<Record<string, unknown>>;
      for (const r of rows) {
        todos.push({
          applyType: 4,
          applyTypeName: '升学',
          bizId: r.id as string,
          applyNo: r.apply_no as string,
          studentName: r.student_name as string,
          studentNo: r.student_no as string,
          className: (r.from_class_name as string) ?? null,
          currentStatus: r.apply_status as number,
          currentStatusName: UpgradeStatusName[r.apply_status as number] ?? '未知',
          submitTime: r.apply_time as string,
          submitterName: (r.applicant_name as string) ?? null,
          linkPath: `/approval/detail?id=${String(r.id)}`,
          canApprove: true,
        });
      }
    }

    todos.sort((a, b) => String(b.submitTime).localeCompare(String(a.submitTime)));
    const page = Math.max(1, Number(query.page) || 1);
    const size = Math.min(200, Math.max(1, Number(query.size) || 20));
    const list = todos.slice((page - 1) * size, page * size);

    // 供前端一次拿到「哪一类各有多少条」，避免多次请求
    const counts = {
      suspend: todos.filter((t) => t.applyType === 1).length,
      quit: todos.filter((t) => t.applyType === 2).length,
      refund: todos.filter((t) => t.applyType === 3).length,
      upgrade: todos.filter((t) => t.applyType === 4).length,
      total: todos.length,
    };

    return ok(res, { ...pageData(todos.length, page, size, list), counts }, '查询成功');
  }),
);

/**
 * @openapi
 * /api/class/approval/log/list:
 *   get:
 *     tags: [审批流程]
 *     summary: 5.16 审批日志（全量留痕，供追溯）
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer } }
 *       - { in: query, name: size, schema: { type: integer } }
 *       - { in: query, name: bizId, schema: { type: string } }
 *       - { in: query, name: applyType, schema: { type: integer } }
 *     responses:
 *       200: { description: 分页日志 }
 */
approvalRouter.get(
  '/log/list',
  validate({
    query: z.object({
      ...pageQuerySchema.shape,
      bizId: z.string().optional(),
      applyNo: z.string().optional(),
      applyType: z.coerce.number().int().optional(),
    }),
  }),
  wrap(async (req, res) => {
    const query = q<{ page: number; size: number; bizId?: string; applyNo?: string; applyType?: number }>(req);
    const base = tbl(db, SRC, 't_class_approval_log', STAGE);
    notDeleted(base);
    if (query.bizId) base.where('biz_id', query.bizId);
    if (query.applyNo) base.where('apply_no', query.applyNo);
    if (query.applyType) base.where('apply_type', query.applyType);
    base.orderBy('operate_time', 'desc');

    const countRow = (await base.clone().clearSelect().clearOrder().count({ c: '*' }).first()) as unknown as {
      c?: number;
    };
    const total = Number(countRow?.c ?? 0);
    const page = Math.max(1, Number(query.page) || 1);
    const size = Math.min(200, Math.max(1, Number(query.size) || 20));
    const rows = (await base.limit(size).offset((page - 1) * size)) as Array<Record<string, unknown>>;

    const list = rowsToCamel<Record<string, unknown>>(rows).map((r) => ({
      ...r,
      applyTypeName: ApplyTypeName[r.applyType as number] ?? '未知',
    }));
    return ok(res, pageData(total, page, size, list), '查询成功');
  }),
);

/** 供前端提示「当前节点该谁审」的映射（与 dict 接口内容一致，这里只做冗余兜底） */
approvalRouter.get('/handler/map', (_req, res) =>
  ok(
    res,
    {
      suspend: SuspendStatusHandlerRole,
      refund: RefundStatusHandlerRole,
    },
    '查询成功',
  ),
);
