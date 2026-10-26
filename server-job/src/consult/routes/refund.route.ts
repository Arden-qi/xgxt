/**
 * 退费管理路由
 *
 * 路径前缀：/api/consult/refund
 *
 * ⚠️ 审批链与权限：
 *    发起退费   → 咨询师 / 经理（经理发起则自审自批）
 *    审批退费   → 仅咨询经理
 *    执行打款   → 仅财务专员
 */

import { Router } from 'express';
import { z } from 'zod';
import { BizCode, ConsultRefundStatus, ConsultRole } from 'shared-types/consult';
import { ok, page } from '../utils/response';
import { db } from '../utils/db';
import { wrap } from '../utils/wrap';
import { validate } from '../middleware/validate';
import { requireAdmin, requireManager } from '../middleware/auth';
import { BizError } from '../middleware/errorHandler';
import {
  REFUND_TABLE,
  buildRefundQuery,
  toRefundView,
  getRefundStats,
  calcRefund,
  applyRefund,
  approveRefund,
  rejectRefund,
  manualPay,
  syncRefundFromFinance,
} from '../services/refund.service';
// ★ formatDate：date 列可能被 mysql2 读成 Date 对象，必须归一成 YYYY-MM-DD 再比较
import { findStudent, formatDate } from '../services/student.service';
// ★ 2026-10-16 数据范围：咨询师只能给自己名下（分配给自己的）学生发起退费
import { assertStudentIdInScope } from '../services/data-scope';

export const refundRouter = Router();

/**
 * ★ 2026-10-22 / 2026-10-23 试学期间最早可选日 = 「人真正进班那天」
 *
 * 用户口径：「试学期间的时间从分配班级进班试学开始计算，没进班或者没来之前不能选择」
 *          「退费日期选择最开始的日期是分班之后开始」
 *
 * 【取值链（逐个兜底，保证一定有值）】
 *   1. `t_consult_student.trial_start` —— 试学分班时写的进班日，最准
 *   2. 跟进历史里最早的入班动作（ASSIGN_CLASS / ENROLL_TO_CLASS）日期
 *      —— ★ 缴全款直接转「正式在读」的学生，receive-ack 以前只在试学分支写
 *         trial_start，正式分支是空的，这类学生就靠这条补（截图里的何静宜就是）
 *   3. 建档日 `create_time` —— 连入班记录都没有（还没分班）的，至少不能早于建档
 *
 * 【为什么必须有值】
 *   早先 earliest 为 null 时前端「不设下限」，日历可以一路翻到几个月前，
 *   试学天数被算成 80 天，多扣住宿/餐费，退费金额被做小。
 *
 * ⚠️ 日期必须用 formatDate 归一成 `YYYY-MM-DD` 再比：
 *    mysql2 在部分配置下把 date 列读成 Date 对象，`String(date).slice(0,10)`
 *    会得到 "Thu Oct 22" 这种串，字符串比较直接失效（踩过）。
 */
export async function resolveEarliestTrialStart(
  stu: any,
): Promise<{ date: string; source: 'TRIAL_START' | 'CLASS_HISTORY' | 'CREATE_TIME' }> {
  const direct = formatDate(stu?.trial_start);
  if (direct) return { date: direct, source: 'TRIAL_START' };

  const row: any = await db('t_consult_history')
    .where({ consult_student_id: stu.id, is_deleted: false })
    .whereIn('action', ['ASSIGN_CLASS', 'ENROLL_TO_CLASS'])
    .orderBy('create_time', 'asc')
    .first();
  const byHistory = formatDate(row?.create_time);
  if (byHistory) return { date: byHistory, source: 'CLASS_HISTORY' };

  return { date: formatDate(stu?.create_time), source: 'CREATE_TIME' };
}

/**
 * 试学期间下限校验（后端二次拦截，防直接调接口 / 旧页面缓存）
 *
 * 前端日历也会按同一天禁用更早的日期，两边用的是同一个日期源。
 */
async function assertTrialStartNotBeforeClass(consultStudentId: string, trialStart: string): Promise<void> {
  const stu = await findStudent(consultStudentId);
  if (!stu) throw new BizError(BizCode.STUDENT_NOT_FOUND, '学生不存在');

  const { date: min, source } = await resolveEarliestTrialStart(stu);
  if (!min) return;
  if (trialStart < min) {
    const what = source === 'CREATE_TIME' ? '建档日期' : '进班日期';
    throw new BizError(
      BizCode.PARAM_ERROR,
      `试学期间不能早于${what}（${min}）：该学生在那之前还没${source === 'CREATE_TIME' ? '建档' : '进班'}，不计试学消耗`,
    );
  }
}

/* ============================================================
 * 1. 退费列表
 *    GET /api/consult/refund/list
 *
 * ⚠️ 数据范围：咨询师只看自己发起/自己名下学生的（数据隔离）
 * ============================================================ */

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(100).default(20),
  studentName: z.string().optional(),
  refundNo: z.string().optional(),
  ownerName: z.string().optional(),
  className: z.string().optional(),
  status: z.coerce.number().int().optional(),
  keyword: z.string().optional(),
  /** 是否先从财务同步打款状态 */
  sync: z.coerce.boolean().optional(),
});

refundRouter.get(
  '/list',
  validate(listSchema),
  wrap(async (req, res) => {
    const q = (req as any).validated as z.infer<typeof listSchema>;
    const user = req.user!;

    // ---- 同步财务打款状态 ----
    if (q.sync !== false) {
      try {
        await syncRefundFromFinance();
      } catch (err) {
        console.warn('[refund/list] 财务同步失败', err);
      }
    }

    // ---- 数据范围：咨询师只看自己的 ----
    const scopeOwner = user.role === ConsultRole.CONSULT ? user.userName : undefined;

    const query = buildRefundQuery(q, scopeOwner);
    const [{ total }] = await query.clone().count({ total: '*' });

    const rows = await query
      .clone()
      .select('*')
      .orderBy('create_time', 'desc')
      .limit(q.size)
      .offset((q.page - 1) * q.size);

    res.json(page(rows.map(toRefundView), Number(total), q));
  }),
);

/* ============================================================
 * 2. 退费统计
 *    GET /api/consult/refund/stats
 * ============================================================ */

refundRouter.get(
  '/stats',
  validate(listSchema),
  wrap(async (req, res) => {
    const q = (req as any).validated as z.infer<typeof listSchema>;
    const user = req.user!;
    const scopeOwner = user.role === ConsultRole.CONSULT ? user.userName : undefined;
    res.json(ok(await getRefundStats(q, scopeOwner)));
  }),
);

/* ============================================================
 * 3. 退费详情
 *    GET /api/consult/refund/detail?id=xxx
 * ============================================================ */

refundRouter.get(
  '/detail',
  validate(z.object({ id: z.string().min(1) })),
  wrap(async (req, res) => {
    const { id } = (req as any).validated as { id: string };
    const row = await db(REFUND_TABLE).where({ id, is_deleted: false }).first();
    if (!row) throw new BizError(BizCode.REFUND_NOT_FOUND, '退费单不存在');
    res.json(ok(toRefundView(row)));
  }),
);

/* ============================================================
 * 4. ⭐ 退费试算（前端弹窗实时算）
 *    POST /api/consult/refund/calc
 *
 * ⚠️ 不落库。前端改天数/勾物品时反复调，保证显示与提交一致。
 * ============================================================ */

const calcSchema = z.object({
  consultStudentId: z.string().min(1),
  trialStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '试学开始日期格式应为 YYYY-MM-DD'),
  trialEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '试学结束日期格式应为 YYYY-MM-DD'),
  trialDays: z.coerce.number().int().min(0).optional(),
  itemNames: z.array(z.string()).optional(),
  /** ★ 2026-10-08 勾选的每日消耗项 key（accommodation/meal/insurance）；传空数组=一项都不算 */
  dailyItems: z.array(z.string()).optional(),
});

refundRouter.post(
  '/calc',
  validate(calcSchema),
  wrap(async (req, res) => {
    const body = (req as any).validated as z.infer<typeof calcSchema>;
    // ★ 2026-10-22 试学期间不能早于进班试学日（试算也拦，保证显示与提交一致）
    await assertTrialStartNotBeforeClass(body.consultStudentId, body.trialStart);
    const result = await calcRefund(
      body.consultStudentId,
      body.trialStart,
      body.trialEnd,
      body.trialDays,
      body.itemNames || [],
      body.dailyItems,
    );
    res.json(ok(result));
  }),
);

/* ============================================================
 * 5. ⭐ 发起退费申请
 *    POST /api/consult/refund/apply
 *
 * ⚠️ 经理发起 → 自审自批，直接进「待财务打款」
 *    咨询师发起 → 进「待经理审批」
 * ============================================================ */

const applySchema = z.object({
  consultStudentId: z.string().min(1),
  trialStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '试学开始日期格式应为 YYYY-MM-DD'),
  trialEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '试学结束日期格式应为 YYYY-MM-DD'),
  trialDays: z.coerce.number().int().min(0).optional(),
  itemNames: z.array(z.string()).optional(),
  /** ★ 2026-10-08 勾选的每日消耗项 key */
  dailyItems: z.array(z.string()).optional(),
  remark: z.string().max(500).optional(),
});

refundRouter.post(
  '/apply',
  validate(applySchema),
  wrap(async (req, res) => {
    const body = (req as any).validated as z.infer<typeof applySchema>;
    const operator = req.user!;

    /**
     * ★ 2026-10-16 数据范围：咨询师只能发起「自己负责的学生」的退费
     *   （经理不受限 —— 经理看全部、也能代发起）
     */
    await assertStudentIdInScope(body.consultStudentId, req.user);

    // ★ 2026-10-22 试学期间不能早于进班试学日
    await assertTrialStartNotBeforeClass(body.consultStudentId, body.trialStart);

    const result = await applyRefund(
      body.consultStudentId,
      {
        trialStart: body.trialStart,
        trialEnd: body.trialEnd,
        trialDays: body.trialDays,
        itemNames: body.itemNames || [],
        dailyItems: body.dailyItems,
        remark: body.remark,
      },
      {
        name: operator.userName,
        title: operator.roleTitle,
        isManager: operator.isManager,
      },
    );

    res.json(
      ok(
        result,
        operator.isManager
          ? `退费申请已提交并自审自批，已上报财务打款（${result.refundNo}）`
          : `退费申请已提交，等待咨询经理审批（${result.refundNo}）`,
      ),
    );
  }),
);

/* ============================================================
 * 6. ⭐ 经理审批通过
 *    POST /api/consult/refund/approve
 * ============================================================ */

refundRouter.post(
  '/approve',
  requireManager,
  validate(z.object({ refundId: z.string().min(1) })),
  wrap(async (req, res) => {
    const { refundId } = (req as any).validated as { refundId: string };
    const operator = req.user!;

    await approveRefund(refundId, {
      name: operator.userName,
      title: operator.roleTitle,
    });

    res.json(ok(null, '审批通过，已上报财务打款'));
  }),
);

/* ============================================================
 * 7. 经理驳回
 *    POST /api/consult/refund/reject
 *
 * ⚠️ 驳回后学生退回「试学中」，可修改后重新提交
 * ============================================================ */

refundRouter.post(
  '/reject',
  requireManager,
  validate(
    z.object({
      refundId: z.string().min(1),
      rejectReason: z.string().min(1, '请填写驳回原因').max(200),
    }),
  ),
  wrap(async (req, res) => {
    const body = (req as any).validated as { refundId: string; rejectReason: string };
    const operator = req.user!;

    await rejectRefund(body.refundId, body.rejectReason, {
      name: operator.userName,
      title: operator.roleTitle,
    });

    res.json(ok(null, '已驳回，学生退回「试学中」'));
  }),
);

/* ============================================================
 * 8. ⭐ 财务打款（手工确认，联调演示用）
 *    POST /api/consult/refund/pay
 *
 * ⚠️⚠️ 2026-10-02 调整：本模块的「财务专员」角色已删除（财务动作统一归
 *    财务管理模块 05 执行）。此手工入口保留仅作【财务模块未启动时的演示兜底】，
 *    权限从「财务专员」收窄为「系统管理员」。
 *
 * ⚠️ 真实场景应由财务侧出款后自动回写（syncRefundFromFinance）。
 * ============================================================ */

const paySchema = z.object({
  refundId: z.string().min(1),
  payMethod: z.string().max(20).optional(),
  payRef: z.string().max(64).optional(),
  payTo: z.string().max(100).optional(),
});

refundRouter.post(
  '/pay',
  requireAdmin,
  validate(paySchema),
  wrap(async (req, res) => {
    const body = (req as any).validated as z.infer<typeof paySchema>;
    const operator = req.user!;

    const result = await manualPay(
      body.refundId,
      { payMethod: body.payMethod, payRef: body.payRef, payTo: body.payTo },
      { name: operator.userName, title: operator.roleTitle },
    );

    res.json(ok(result, `退费打款成功，流水号 ${result.payRef}`));
  }),
);

/* ============================================================
 * 9. 从财务同步打款状态（手工触发）
 *    POST /api/consult/refund/sync
 * ============================================================ */

refundRouter.post(
  '/sync',
  wrap(async (_req, res) => {
    const result = await syncRefundFromFinance();
    res.json(
      ok(result, result.updated > 0 ? `已同步 ${result.updated} 笔退费单状态` : '状态已是最新'),
    );
  }),
);

/* ============================================================
 * 10. 某学生的退费预填信息（发起退费弹窗打开时调）
 *     GET /api/consult/refund/prefill?consultStudentId=xxx
 * ============================================================ */

refundRouter.get(
  '/prefill',
  validate(z.object({ consultStudentId: z.string().min(1) })),
  wrap(async (req, res) => {
    const { consultStudentId } = (req as any).validated as { consultStudentId: string };
    const stu = await findStudent(consultStudentId);
    if (!stu) throw new BizError(BizCode.STUDENT_NOT_FOUND, '学生不存在');

    const { today } = await import('../services/student.service');
    const end = today();
    /**
     * ★ 2026-10-22 / 2026-10-23 试学期间最早可选日 = 进班日
     *
     * 前端日历用它禁用更早的日期（没进班之前的日期不该能选）。
     * 与 `trialStart` 分开返回：trialStart 是「默认填入的开始日」，
     * earliestTrialStart 是「允许的最早一天」。
     *
     * ⚠️ 2026-10-23 起**不再返回 null**：trial_start 缺失时会退到入班历史 / 建档日
     *    （见 resolveEarliestTrialStart）。正式在读学生以前 trial_start 为空，
     *    这里返回 null → 前端不设下限 → 能选到几个月前，试学天数被算爆。
     */
    const earliestInfo = await resolveEarliestTrialStart(stu);
    const earliest = earliestInfo.date || null;
    const start = earliest || end;

    // 用「无物品、无每日消耗」先算一次，给前端初始值（前端会按勾选立即重算）
    const calc = await calcRefund(consultStudentId, start, end, undefined, [], []);

    res.json(
      ok({
        studentName: stu.student_name,
        ownerName: stu.owner_name,
        className: stu.class_name,
        trialStart: start,
        trialEnd: end,
        /** 试学期间最早可选日（进班日 / 入班历史日 / 建档日）；正常不会为 null */
        earliestTrialStart: earliest,
        /** 这个下限是怎么来的，前端可据此写提示文案 */
        earliestSource: earliestInfo.source,
        ...calc,
      }),
    );
  }),
);

export default refundRouter;
