/**
 * 退费管理 · 业务逻辑
 * 负责人：周铭（财务管理）
 *
 * ⚠️ 退费是「审批链」业务，状态流转顺序【不可变】（数据字典 4.8）：
 *
 *    1 待提交 → 2 待经理审批 → 3 待教务核算 → 4 待财务出款 → 5 待校长审批 → 6 已退费
 *                                       ↓ 任一环节被打回
 *                                      7 已驳回
 *
 *    ⚠️ 其中 5 待校长审批是「有条件」的：金额超阈值才有，
 *       所以 4 → 6 直达也是合法的（小额退费）。
 *
 *    财务的职责边界：只在「4 待财务出款」这一步动手，
 *    前面的经理审批 / 教务核算 / 校长审批都不是财务的活。
 *    但财务要能【看到】整条链走到哪了（时间轴）。
 */

import { randomUUID } from 'crypto';
import {
  BizCode,
  FEE_TYPE_NAME,
  REFUND_STATUS_NAME,
  DEPT_NAME,
  RefundStatus,
} from 'shared-types/finance';
import { db } from '../utils/db';
import { BizError } from '../middleware/errorHandler';
import { nextRefundOrderNo, nextBillNoForRefund } from '../utils/orderNo';
import { toDateStr, toTimeStr, isTempStudentNo } from './fee.service';
import { REFUND_SOURCE_NAME } from 'shared-types/finance';
import { config } from '../../config';
import { remotePost } from '../../shared/http';

export const REFUND_TABLE = 't_finance_refund';
export const BILL_TABLE = 't_finance_bill';
/**
 * 退费费用项明细表（★ 2026-10-22 新增）
 *
 * 一笔退费单可含多个费用项（学费 / 住宿费 …），财务侧每个费用项对应一行。
 * 主单 `t_finance_refund.refund_amount` 仍是总金额，出款也仍是一次（一张账单）。
 */
export const REFUND_ITEM_TABLE = 't_finance_refund_item';

/** 财务只认 1~5 的费用类型（6 退学退费 / 9 其他 是上游内部码，不能进财务字典） */
const FIN_FEE_TYPES = [1, 2, 3, 4, 5];

/** 退费行 → 前端契约格式 */
export function toRefundListItem(r: any) {
  return {
    id: r.id,
    orderNo: r.order_no,
    studentId: r.student_id,
    // ★ 2026-10-22 未分班（只有 ZX 临时号）→ 学号留空，前端显示「—」
    studentNo: isTempStudentNo(r.student_no) ? '' : r.student_no,
    studentName: r.student_name,
    classId: r.class_id ?? undefined,
    className: r.class_name ?? undefined,
    deptCode: r.dept_code ?? undefined,
    deptName: r.dept_code ? DEPT_NAME[r.dept_code] : undefined,
    refundType: r.refund_type,
    refundTypeName: FEE_TYPE_NAME[r.refund_type] || '',
    refundAmount: Number(r.refund_amount),
    refundReason: r.refund_reason,
    refundStatus: r.refund_status,
    refundStatusName: REFUND_STATUS_NAME[r.refund_status] || '',
    sourceType: r.source_type,
    sourceName: REFUND_SOURCE_NAME[r.source_type] || '',
    applicantName: r.applicant_name ?? undefined,
    applyTime: toTimeStr(r.apply_time),
    pushedTime: toTimeStr(r.pushed_time),
    // ⚠️ 只有「待财务出款」才能出款 —— 这是财务模块的权限边界
    canRefund: r.refund_status === RefundStatus.PENDING_FINANCE,
    isInBill: !!r.is_in_bill,
    // ★ 2026-10-22：上游来源（教学内容推送的单才有值）→ 前端据此切换时间轴口径
    sourceModule: r.source_module ?? undefined,
    sourceStage: r.source_stage ?? undefined,
    sourceRefundId: r.source_refund_id ?? undefined,
  };
}

/** 明细行 → 前端契约格式 */
function toItemLine(it: any) {
  return {
    feeType: Number(it.fee_type),
    feeTypeName: FEE_TYPE_NAME[it.fee_type] || '',
    amount: Number(it.amount),
  };
}

/**
 * 批量读费用项明细（列表用：一次查一页，别在循环里查）
 *
 * @returns Map<退费单 id, 明细行[]>
 */
export async function loadRefundItems(ids: string[]): Promise<Map<string, any[]>> {
  const map = new Map<string, any[]>();
  const uniq = Array.from(new Set(ids.filter(Boolean)));
  if (!uniq.length) return map;
  const rows = await db(REFUND_ITEM_TABLE)
    .whereIn('refund_id', uniq)
    .andWhere('is_deleted', false)
    .orderBy([{ column: 'fee_type', order: 'asc' }])
    .select('*')
    .catch(() => [] as any[]);
  for (const r of rows) {
    const list = map.get(r.refund_id) || [];
    list.push(toItemLine(r));
    map.set(r.refund_id, list);
  }
  return map;
}

/** 读单张退费单的明细（详情用） */
export async function itemsOfRefund(refundId: string) {
  const m = await loadRefundItems([refundId]);
  return m.get(refundId) || [];
}

/** 退费行 → 详情（含审批链时间轴） */
export function toRefundDetail(r: any) {
  return {
    ...toRefundListItem(r),
    managerApproveTime: toTimeStr(r.manager_approve_time),
    managerApproveBy: r.manager_approve_by ?? undefined,
    academicCheckTime: toTimeStr(r.academic_check_time),
    academicCheckBy: r.academic_check_by ?? undefined,
    principalApproveTime: toTimeStr(r.principal_approve_time),
    principalApproveBy: r.principal_approve_by ?? undefined,
    financePayTime: toTimeStr(r.finance_pay_time),
    financePayBy: r.finance_pay_by ?? undefined,
    rejectReason: r.reject_reason ?? undefined,
    attachmentUrl: r.attachment_url ?? undefined,
    remark: r.remark ?? undefined,
    createTime: toTimeStr(r.create_time) || '',
  };
}

/** 构造列表查询条件 */
export function buildRefundQuery(q: any) {
  const query = db(REFUND_TABLE).where('is_deleted', false);

  if (q.studentNo) query.andWhere('student_no', 'like', `%${q.studentNo}%`);
  if (q.studentName) query.andWhere('student_name', 'like', `%${q.studentName}%`);
  if (q.classId) query.andWhere('class_id', q.classId);
  if (q.deptCode) query.andWhere('dept_code', q.deptCode);
  if (q.refundStatus) query.andWhere('refund_status', q.refundStatus);
  if (q.startDate) query.andWhere('apply_time', '>=', `${q.startDate} 00:00:00`);
  if (q.endDate) query.andWhere('apply_time', '<=', `${q.endDate} 23:59:59`);
  if (q.keyword) {
    query.andWhere((qb: any) => {
      qb.where('student_no', 'like', `%${q.keyword}%`)
        .orWhere('student_name', 'like', `%${q.keyword}%`)
        .orWhere('order_no', 'like', `%${q.keyword}%`);
    });
  }
  return query;
}

/* ============================================================
 * 费用项明细（★ 2026-10-22 新增）
 * ============================================================ */

/**
 * 归一化「退费费用项」
 *
 * 三种入参形态，优先级从高到低：
 *   ① `refundItemDetails`（带各自金额）—— 教学域推送上来的就是这种
 *   ② `refundItems`（只有类型，没有金额）—— 老调用方
 *   ③ 都没有 —— 落一行 feeType=1，金额 = 主单金额（保留改造前的兜底行为）
 *
 * ⚠️ 财务字典只认 1~5；上游的 6 退学退费 / 9 其他 会被过滤掉。
 *   全部被过滤掉时退回 ①/③ 的兜底，避免明细表空着。
 */
function normalizeRefundItems(body: any): Array<{ feeType: number; amount: number }> {
  const details = Array.isArray(body.refundItemDetails) ? body.refundItemDetails : [];
  const fromDetails = details
    .map((it: any) => ({ feeType: Number(it?.feeType), amount: Math.round(Number(it?.amount)) }))
    .filter((it: any) => FIN_FEE_TYPES.includes(it.feeType) && Number.isFinite(it.amount) && it.amount > 0);
  if (fromDetails.length) return fromDetails;

  const types = (Array.isArray(body.refundItems) ? body.refundItems : [])
    .map((t: any) => Number(t))
    .filter((t: number) => FIN_FEE_TYPES.includes(t));
  const total = Math.round(Number(body.refundAmount));
  // 只有类型没有金额 → 无法拆行，落「主项 + 全额」一行（金额不能凭空猜）
  if (!types.length) return [{ feeType: 1, amount: Number.isFinite(total) ? total : 0 }];
  return [{ feeType: types[0], amount: Number.isFinite(total) ? total : 0 }];
}

/** 覆盖写某张退费单的明细（先软删旧行，再插新行 —— 满足「禁止物理删除」约定） */
async function replaceRefundItems(
  refundId: string,
  items: Array<{ feeType: number; amount: number }>,
  operator: { userId: string; userName: string },
): Promise<void> {
  const now = new Date();
  await db(REFUND_ITEM_TABLE)
    .where({ refund_id: refundId, is_deleted: false })
    .update({ is_deleted: true, update_time: now, update_by: operator.userId });

  if (!items.length) return;
  await db(REFUND_ITEM_TABLE).insert(
    items.map((it) => ({
      id: randomUUID(),
      refund_id: refundId,
      fee_type: it.feeType,
      amount: it.amount,
      is_deleted: false,
      create_time: now,
      create_by: operator.userId,
    })),
  );
}

/* ============================================================
 * 提交退费申请
 * ============================================================ */

/**
 * 提交退费申请（上游模块审批通过后上报；财务也可代提交）
 *
 * ⭐ 2026-10-15 修正：落库状态从「1 待提交」改为「4 待财务出款」
 *
 * 【原来的错】
 *   这里硬编码 `RefundStatus.DRAFT`（待提交），但本接口的实际调用方
 *   **全都是已经走完自己审批链的上游模块**：
 *     · 咨询 → 经理审批通过后上报
 *     · 就业 / 教学·初高 / 班级 → 各自审批通过后上报（utils/financeClient）
 *   咨询侧的映射常量 `CONSULT_TO_FINANCE_REFUND_STATUS` 也白纸黑字写着
 *     「经理批准后上报 → 财务侧 4 待财务出款」。
 *   落成「待提交」的后果：列表项 `canRefund=false` → **财务看不到「出款」按钮，
 *   整条退费流程卡死在财务这一步**（用户 2026-10-15 反馈的现象）。
 *
 * 【为什么是 4 而不是别的】
 *   财务侧不需要再走一遍审批 —— 上游已经审过了，财务的职责只是「出款」。
 *   所以上报即落到「待财务出款」；财务点「退费」后由 payRefund 转「6 已退费」。
 *
 * ⭐ 2026-10-22 用户反馈修正（截图那个 bug）：
 *   财务「退费管理」详情里的审批流转记录**除第一条外全是「待处理」**。
 *   原因是这里只写了 `apply_time`，`pushed_time` / `principal_approve_time` 从未落库，
 *   而前端时间轴是**纯按时间戳**渲染的（有值=已完成，无值=待处理）。
 *
 *   现在补三件事：
 *     ① 写 `pushed_time = now` —— 「推送到财务」这一步就是此刻发生的
 *     ② 写 `principal_approve_time/by`（上游校长审批真实时间/真实人）
 *        —— 上游审批链最后一步就是校长审批，语义完全一致，不是假数据
 *     ③ 写 `source_module / source_stage / source_refund_id` —— 出款后据此回写上游，
 *        同时 `uk_source` 唯一索引保证**同一张上游单不会重复建单**
 */
export async function applyRefund(
  body: any,
  operator: { userId: string; userName: string },
): Promise<{ id: string; orderNo: string; duplicated: boolean }> {
  const sourceModule = String(body.sourceModule || '').trim() || null;
  const sourceStage = String(body.sourceStage || '').trim() || null;
  const sourceRefundId = String(body.sourceRefundId || '').trim() || null;
  const items = normalizeRefundItems(body);

  // ---- 幂等：同一张上游单只落一条财务退费单 ----
  if (sourceModule && sourceRefundId) {
    const exists = await db(REFUND_TABLE)
      .where({ source_module: sourceModule, source_refund_id: sourceRefundId })
      .first();
    if (exists) {
      // 明细以本次推送为准（上游可能改过金额）→ 覆盖写，不新增单
      await replaceRefundItems(exists.id, items, operator);
      return { id: exists.id, orderNo: exists.order_no, duplicated: true };
    }
  }

  const orderNo = await nextRefundOrderNo();
  const id = randomUUID();
  const now = new Date();

  // 上游校长审批时间（没传就按「此刻 = 上游刚批完」处理）
  const upstreamRaw = body.upstreamApproveTime ? new Date(body.upstreamApproveTime) : now;
  const upstreamAt = Number.isNaN(upstreamRaw.getTime()) ? now : upstreamRaw;
  const upstreamBy = String(body.upstreamApproverName || '').trim() || null;

  // 主项：多选时取第一个（数据字典里 refund_type 是单值）
  const mainType = items.length ? items[0].feeType : 1;

  await db.transaction(async (t) => {
    await t(REFUND_TABLE).insert({
      id,
      create_time: now,
      create_by: operator.userId,
      is_deleted: false,
      order_no: orderNo,
      student_id: body.studentId,
      student_no: body.studentNo,
      student_name: body.studentName,
      class_id: body.classId ?? null,
      class_name: body.className ?? null,
      dept_code: body.deptCode ?? null,
      refund_type: mainType,
      refund_amount: body.refundAmount,
      refund_reason: body.refundReason,
      refund_status: RefundStatus.PENDING_FINANCE,
      source_type: body.sourceType ?? 1,
      apply_time: now,
      applicant_id: operator.userId,
      applicant_name: operator.userName,
      // ★ 2026-10-22：推送即「推送到财务」这一步的完成时刻
      pushed_time: now,
      // ★ 上游校长审批真实时间/人（前端时间轴据此点亮「校长审批」）
      principal_approve_time: upstreamAt,
      principal_approve_by: upstreamBy,
      // ★ 上游溯源（出款回写 + 防重复推送）
      source_module: sourceModule,
      source_stage: sourceStage,
      source_refund_id: sourceRefundId,
      is_in_bill: false,
      attachment_url: body.attachmentUrl ?? null,
      remark: body.remark ?? null,
    });

    if (items.length) {
      await t(REFUND_ITEM_TABLE).insert(
        items.map((it) => ({
          id: randomUUID(),
          refund_id: id,
          fee_type: it.feeType,
          amount: it.amount,
          is_deleted: false,
          create_time: now,
          create_by: operator.userId,
        })),
      );
    }
  });

  return { id, orderNo, duplicated: false };
}

/**
 * 出款后回写上游（★ 2026-10-22 新增，用户要求「自动回写」）
 *
 * 为什么在事务外、且失败只 warn：
 *   钱已经付出去了，上游教务没收到通知不能反过来让财务「出款失败」。
 *   失败就留痕，人工补录（与推送方向「失败只 log」的策略对称）。
 */
async function notifyUpstreamPaid(
  row: any,
  billNo: string,
  payTime: Date,
  payMethod?: number,
  remark?: string,
): Promise<void> {
  if (row.source_module !== 'teaching') return;
  if (!row.source_stage || !row.source_refund_id) return;

  try {
    await remotePost(
      'job',
      '/api/teaching/refund/internal/finance-paid',
      {
        stage: row.source_stage,
        id: row.source_refund_id,
        financeRefundId: row.id,
        financeRefundNo: row.order_no,
        billNo,
        payTime: toTimeStr(payTime),
        payMethod: payMethod ?? null,
        remark: remark ?? null,
      },
      {
        timeout: 5000,
        raw: true,
        headers: { 'x-internal-token': config.internalToken },
      },
    );
    // eslint-disable-next-line no-console
    console.log(
      `[退费出款回写] 成功：财务单 ${row.order_no} → 上游 ${row.source_stage}/${row.source_refund_id}`,
    );
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.warn(
      `[退费出款回写] 失败（不影响出款，需人工补录）：财务单 ${row.order_no}`,
      err?.message,
    );
  }
}

/**
 * 【核心】财务确认出款
 *
 * 做三件事（一个事务）：
 *   1. 校验：必须是「4 待财务出款」状态 —— 防止越权/重复出款
 *   2. 生成退费账单号，写入 t_finance_bill（bill_type = 2 退费账单）
 *   3. 回写退费单：refund_status = 6 已退费、finance_pay_time、is_in_bill = true
 *
 * ⚠️ 为什么必须先校验状态？
 *    出款是真金白银。如果允许「已退费」的单子再点一次，
 *    业务上就是重复打款 —— 这类事故在财务系统里是不可接受的。
 */
export async function payRefund(
  id: string,
  operator: { userId: string; userName: string },
  payMethod?: number,
  remark?: string,
): Promise<string> {
  const done = await db.transaction(async (t) => {
    const row = await t(REFUND_TABLE).where({ id, is_deleted: false }).first();
    if (!row) {
      throw new BizError(BizCode.PARAM_ERROR, '退费单不存在或已被删除');
    }

    // ---- 状态校验：只允许「待财务出款」----
    if (row.refund_status === RefundStatus.REFUNDED) {
      throw new BizError(BizCode.PARAM_ERROR, '该退费单已出款，请勿重复操作');
    }
    if (row.refund_status !== RefundStatus.PENDING_FINANCE) {
      const cur = REFUND_STATUS_NAME[row.refund_status] || row.refund_status;
      throw new BizError(
        BizCode.PARAM_ERROR,
        `该退费单当前状态为「${cur}」，不能出款（只有「待财务出款」的单子才能出款）`,
      );
    }
    if (!row.refund_amount || row.refund_amount <= 0) {
      throw new BizError(BizCode.PARAM_ERROR, '退费金额异常，请先核对');
    }

    // ---- 生成账单号并记账 ----
    const billNo = await nextBillNoForRefund();
    const now = new Date();

    await t(BILL_TABLE).insert({
      id: randomUUID(),
      create_time: now,
      create_by: operator.userId,
      is_deleted: false,
      bill_no: billNo,
      bill_type: 2, // 退费账单
      source_id: row.id,
      source_no: row.order_no,
      student_id: row.student_id,
      student_no: row.student_no,
      student_name: row.student_name,
      class_id: row.class_id ?? null,
      class_name: row.class_name ?? null,
      dept_code: row.dept_code ?? null,
      head_teacher_name: null,
      fee_type: row.refund_type,
      amount: row.refund_amount,
      bill_date: toDateStr(now)!,
      operator_id: operator.userId,
      operator_name: operator.userName,
      voucher_no: null,
      pay_method: payMethod ?? null,
      remark: remark ?? `退费出款（${FEE_TYPE_NAME[row.refund_type] || ''}）`,
    });

    // ---- 回写退费单 ----
    await t(REFUND_TABLE).where({ id }).update({
      refund_status: RefundStatus.REFUNDED,
      finance_pay_time: now,
      finance_pay_by: operator.userId,
      is_in_bill: true,
      update_time: now,
      update_by: operator.userId,
      ...(remark ? { remark } : {}),
    });

    return { billNo, row, paidAt: now };
  });

  // ★ 2026-10-22：事务提交后再回写上游（用户要求「自动回写」，上游不再人工登记出款）
  await notifyUpstreamPaid(done.row, done.billNo, done.paidAt, payMethod, remark);

  return done.billNo;
}

/** 驳回退费单 */
export async function rejectRefund(
  id: string,
  rejectReason: string,
  operator: { userId: string; userName: string },
): Promise<void> {
  const row = await db(REFUND_TABLE).where({ id, is_deleted: false }).first();
  if (!row) {
    throw new BizError(BizCode.PARAM_ERROR, '退费单不存在或已被删除');
  }
  if (row.refund_status === RefundStatus.REFUNDED) {
    throw new BizError(BizCode.PARAM_ERROR, '该退费单已出款完成，无法驳回');
  }
  if (row.refund_status === RefundStatus.REJECTED) {
    throw new BizError(BizCode.PARAM_ERROR, '该退费单已是驳回状态');
  }
  if (!rejectReason || !rejectReason.trim()) {
    throw new BizError(BizCode.REQUIRED_FIELD_MISSING, '驳回原因必填');
  }

  await db(REFUND_TABLE).where({ id }).update({
    refund_status: RefundStatus.REJECTED,
    reject_reason: rejectReason.trim(),
    update_time: new Date(),
    update_by: operator.userId,
  });
}

/**
 * 推进审批链（供其他模块或测试用）
 *
 * ⚠️ 严格按数据字典顺序推进，不许跳步：
 *    1→2→3→4→(5)→6
 *    其中 5 是「大额才有」的校长审批，用 needPrincipal 控制
 */
export async function advanceRefund(
  id: string,
  operator: { userId: string; userName: string },
  needPrincipal = false,
): Promise<number> {
  const row = await db(REFUND_TABLE).where({ id, is_deleted: false }).first();
  if (!row) {
    throw new BizError(BizCode.PARAM_ERROR, '退费单不存在或已被删除');
  }

  const now = new Date();
  const cur = row.refund_status;

  switch (cur) {
    case RefundStatus.DRAFT:
      await db(REFUND_TABLE).where({ id }).update({
        refund_status: RefundStatus.PENDING_MANAGER,
        apply_time: row.apply_time ?? now,
        applicant_id: operator.userId,
        applicant_name: operator.userName,
        update_time: now,
        update_by: operator.userId,
      });
      return RefundStatus.PENDING_MANAGER;

    case RefundStatus.PENDING_MANAGER:
      await db(REFUND_TABLE).where({ id }).update({
        refund_status: RefundStatus.PENDING_ACADEMIC,
        manager_approve_time: now,
        manager_approve_by: operator.userId,
        update_time: now,
        update_by: operator.userId,
      });
      return RefundStatus.PENDING_ACADEMIC;

    case RefundStatus.PENDING_ACADEMIC:
      // 教务核算完 → 大额转校长审批，小额直接推财务
      await db(REFUND_TABLE).where({ id }).update({
        refund_status: needPrincipal
          ? RefundStatus.PENDING_PRINCIPAL
          : RefundStatus.PENDING_FINANCE,
        academic_check_time: now,
        academic_check_by: operator.userId,
        pushed_time: needPrincipal ? null : now,
        update_time: now,
        update_by: operator.userId,
      });
      return needPrincipal ? RefundStatus.PENDING_PRINCIPAL : RefundStatus.PENDING_FINANCE;

    case RefundStatus.PENDING_PRINCIPAL:
      await db(REFUND_TABLE).where({ id }).update({
        refund_status: RefundStatus.PENDING_FINANCE,
        principal_approve_time: now,
        principal_approve_by: operator.userId,
        pushed_time: now,
        update_time: now,
        update_by: operator.userId,
      });
      return RefundStatus.PENDING_FINANCE;

    default:
      throw new BizError(
        BizCode.PARAM_ERROR,
        `当前状态「${REFUND_STATUS_NAME[cur] || cur}」无法继续推进`,
      );
  }
}

/** 退费单号生成（供测试/其他模块引用） */
export { nextRefundOrderNo };
