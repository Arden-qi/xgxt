/**
 * 退费服务（试学阶段流失）
 *
 * ⚠️ 退费规则（业务方定的，代码强制）：
 *    试学费 − 试学期间实际消耗 = 实退
 *    每日消耗：住宿费 ¥15/天、餐费 ¥28/天、保险费 ¥5/天
 *    另加：学生领用的个人物品（校服/被褥/工具包/教材/军训服/门禁卡）
 *
 * ⚠️ 审批链：
 *    咨询老师发起 → 咨询经理审批 → 上报财务 → 财务打款 → 学生状态变「已退费」
 *    经理自己发起则自审自批，直接进「待财务打款」
 *    经理驳回 → 学生退回试学中，可修改后重新提交
 *
 * ⚠️ 金额单位一律「分」
 */

import { randomUUID } from 'crypto';
import {
  BizCode,
  ConsultState,
  ConsultRefundStatus as CRS,
  CONSULT_REFUND_STATUS_NAME,
  CONSULT_STATE_NAME,
  CONSULT_FEE_STATUS_NAME,
  TRIAL_DAILY_RATE_CENT,
  FeeType,
  nameOf,
} from 'shared-types/consult';
// ★ 2026-10-22 退费来源要用「咨询部门」，不能复用班主任那个值
import { RefundSourceType } from 'shared-types/finance';
import type {
  ConsultRefundOrder,
  RefundDeductItem,
  ConsultRefundCalcResult,
  ConsultRefundStats,
} from 'shared-types/consult';
import { db } from '../utils/db';
import { BizError } from '../middleware/errorHandler';
import {
  findStudent,
  addHistory,
  formatTime,
  formatDate,
  diffDays,
  today,
  getItemPrice,
  getConsumeItems,
  getConfigNumber,
} from './student.service';
import {
  getArrivedTrialIncome,
  centToYuan,
  tempStudentNo,
  findOpenFeeOrders,
} from './fee-order.service';
import { terminateStudentPlans } from './installment.service';
import { changeState } from './state.service';
import { financeClient } from './finance.client';

export const REFUND_TABLE = 't_consult_refund';

/* ============================================================
 * 单号与视图
 * ============================================================ */

/** 生成退费单号：TK + YYYYMMDD + 3 位序号 */
export async function nextRefundNo(): Promise<string> {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const day = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  const prefix = `TK${day}-`;

  const row = await db(REFUND_TABLE)
    .where('refund_no', 'like', `${prefix}%`)
    .orderBy('refund_no', 'desc')
    .first();

  let seq = 1;
  if (row?.refund_no) {
    const last = Number(String(row.refund_no).slice(prefix.length));
    if (!isNaN(last)) seq = last + 1;
  }
  return `${prefix}${String(seq).padStart(3, '0')}`;
}

/** 解析扣减明细 JSON */
function parseDeduct(raw: any): RefundDeductItem[] {
  if (!raw) return [];
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/** 行 → 视图 */
export function toRefundView(row: any): ConsultRefundOrder {
  return {
    refundId: row.id,
    refundNo: row.refund_no,
    financeRefundId: row.finance_refund_id || undefined,
    consultStudentId: row.consult_student_id,
    studentName: row.student_name || '',
    studentNo: row.student_no || undefined,
    className: row.class_name || undefined,

    applyByName: row.apply_by_name || '',
    applyByTitle: row.apply_by_title || '',
    applyAt: formatTime(row.apply_at),
    selfApprove: !!row.self_approve,
    approveByName: row.approve_by_name || undefined,
    approveAt: row.approve_at ? formatTime(row.approve_at) : undefined,
    rejectReason: row.reject_reason || undefined,

    trialStart: row.trial_start ? formatDate(row.trial_start) : undefined,
    trialEnd: row.trial_end ? formatDate(row.trial_end) : undefined,
    trialDays: row.trial_days,
    incomeAmount: row.income_amount,
    deductItems: parseDeduct(row.deduct_detail),
    deductTotal: row.deduct_total,
    refundAmount: row.refund_amount,

    status: row.status,
    statusName: nameOf(CONSULT_REFUND_STATUS_NAME, row.status),

    payByName: row.pay_by_name || undefined,
    payAt: row.pay_at ? formatTime(row.pay_at) : undefined,
    payMethod: row.pay_method || undefined,
    payRef: row.pay_ref || undefined,
    payTo: row.pay_to || undefined,

    remark: row.remark || undefined,
    createTime: formatTime(row.create_time),
  };
}

/* ============================================================
 * ⭐ 退费试算（前端弹窗实时算）
 * ============================================================ */

/**
 * 试算退费金额（不落库）
 *
 * ⚠️ 前端在弹窗里改天数、勾物品时反复调这个接口，
 *    保证「用户看到的数字」和「提交后后端算的数字」完全一致。
 */
export async function calcRefund(
  consultStudentId: string,
  trialStart: string,
  trialEnd: string,
  trialDaysOverride?: number,
  itemNames: string[] = [],
  /** ★ 2026-10-08 勾选的每日消耗项 key（accommodation/meal/insurance）；不传默认全选 */
  dailyItems?: string[],
): Promise<ConsultRefundCalcResult> {
  const stu = await findStudent(consultStudentId);
  if (!stu) throw new BizError(BizCode.STUDENT_NOT_FOUND, '学生不存在');

  // ---- 天数：优先用前端传的，没传就按日期算 ----
  const days = trialDaysOverride && trialDaysOverride > 0
    ? trialDaysOverride
    : diffDays(trialStart, trialEnd);

  // ---- 已到账试学费 ----
  const income = await getArrivedTrialIncome(consultStudentId);

  // ---- 每日消耗（从配置读，配置缺失用 shared-types 的默认值）----
  const rateAcc = await getConfigNumber('trial_rate_accommodation', TRIAL_DAILY_RATE_CENT.accommodation);
  const rateMeal = await getConfigNumber('trial_rate_meal', TRIAL_DAILY_RATE_CENT.meal);
  const rateIns = await getConfigNumber('trial_rate_insurance', TRIAL_DAILY_RATE_CENT.insurance);

  // ★ 每日消耗也按多选参与计算：前端勾了哪项才算哪项，明细逐条列出
  const DAILY_DEFS = [
    { key: 'accommodation', name: '住宿费', rate: rateAcc },
    { key: 'meal', name: '餐费', rate: rateMeal },
    { key: 'insurance', name: '保险费（试学期短期险）', rate: rateIns },
  ];
  const activeDaily = Array.isArray(dailyItems)
    ? DAILY_DEFS.filter((d) => dailyItems.includes(d.key))
    : DAILY_DEFS;

  const deductItems: RefundDeductItem[] = activeDaily.map((d) => ({
    item: d.name,
    calc: `¥${d.rate / 100}/天 × ${days} 天`,
    amount: d.rate * days,
  }));

  // ---- 物品领用 ----
  for (const name of itemNames) {
    const price = await getItemPrice(name);
    if (price === null) continue;   // 字典里没有的跳过
    deductItems.push({
      item: `物品领用 · ${name}`,
      calc: '领用 1 件',
      amount: price,
    });
  }

  const deductTotal = deductItems.reduce((a, b) => a + b.amount, 0);
  // ⚠️ 实退不能为负：扣减超过已缴时，最多退 0（差额由业务人工处理，不在这里倒欠）
  const refundAmount = Math.max(0, income - deductTotal);

  return {
    trialDays: days,
    incomeAmount: income,
    deductItems,
    deductTotal,
    refundAmount,
    itemOptions: await getConsumeItems(),
  };
}

/* ============================================================
 * ⭐ 发起退费申请
 * ============================================================ */

/**
 * 发起退费
 *
 * @param operator 发起人（含岗位，用于判断是否经理自审自批）
 */
export async function applyRefund(
  consultStudentId: string,
  payload: {
    trialStart: string;
    trialEnd: string;
    trialDays?: number;
    itemNames?: string[];
    /** ★ 2026-10-08 勾选的每日消耗项 key（accommodation/meal/insurance） */
    dailyItems?: string[];
    remark?: string;
  },
  operator: { name: string; title?: string; isManager: boolean },
): Promise<{ refundId: string; refundNo: string }> {
  const stu = await findStudent(consultStudentId);
  if (!stu) throw new BizError(BizCode.STUDENT_NOT_FOUND, '学生不存在');

  // ---- 只有试学相关状态能发起退费 ----
  const allowed: number[] = [
    ConsultState.TRIAL_WAIT_CLASS,
    ConsultState.TRIAL,
    ConsultState.TRIAL_FEE_PENDING,
  ];
  /**
   * ★ 2026-10-26 自愈：状态卡在「退费中」，但根本没有在途退费单
   *
   * 现场（王麻子 / TK20261026-002）：财务驳回时只把退费单改成「已驳回」，
   * **忘了回滚学生状态** → 人一直停在「退费·待财务打款(9)」，
   * 于是「发起退费」下拉选不到他、学生管理里也没有任何后续操作，流程断死。
   *
   * 现在：状态是 8/9 但查不到在途退费单（下面那段在途校验会兜住真有单的情况），
   * 说明是历史脏数据 —— 放行，并在跟进历史里留一条自愈记录。
   * 已退费(10) / 流失(12) 仍然一律拒绝。
   */
  const staleRefundState =
    stu.consult_state === ConsultState.REFUND_MGR || stu.consult_state === ConsultState.REFUND_FINANCE;
  if (!allowed.includes(stu.consult_state) && !staleRefundState) {
    throw new BizError(
      BizCode.INVALID_STATUS,
      `当前状态「${CONSULT_STATE_NAME[stu.consult_state] || stu.consult_state}」不允许发起退费（仅「咨询中 / 待分班 / 试学中」可发起）。已退费 / 退费中 / 流失的学生不能重复发起，如需直接退学请联系教务模块处理。`,
    );
  }

  // ---- 不允许重复发起 ----
  /**
   * ★ 2026-10-26 用户口径：「退费的、流失的、申请中的不可以再发起退费了」
   *
   * 在途单要同时看「待经理审批」和「待财务打款」两种 —— 原来只查前者，
   * 一旦学生状态因为别的原因没同步过去，就能给已上报财务的学生再建一张退费单。
   */
  const exists = await db(REFUND_TABLE)
    .where({
      consult_student_id: consultStudentId,
      is_deleted: false,
    })
    .whereIn('status', [CRS.PENDING_MANAGER, CRS.PENDING_FINANCE])
    .first();
  if (exists) {
    throw new BizError(
      BizCode.REFUND_ALREADY_EXISTS,
      `该学生已有在途退费单（${exists.refund_no}）处于「${CONSULT_REFUND_STATUS_NAME[exists.status] || '处理中'}」，请勿重复发起。`,
    );
  }

  // ---- 已退过费的，不再受理（历史单可能是旧数据，状态没同步）----
  const paid = await db(REFUND_TABLE)
    .where({ consult_student_id: consultStudentId, is_deleted: false, status: CRS.PAID })
    .first();
  if (paid) {
    throw new BizError(
      BizCode.REFUND_ALREADY_EXISTS,
      `该学生已退费完成（${paid.refund_no}），不能重复发起退费。`,
    );
  }

  /**
   * ★ 2026-10-26 用户口径：「缴费中的要退费也不能选择」
   *
   * 有在途收费单 = 钱还没确认到账（待上传凭证 / 待财务确认），
   * 这时候账上都还没有这笔钱，退费无从谈起 —— 直接拒，并告诉老师两条路。
   * 前端下拉已用 `excludePendingFee` 剔掉这类学生，这里是接口层的兜底。
   */
  const openFees = await findOpenFeeOrders(consultStudentId);
  if (openFees.length) {
    const first = openFees[0];
    throw new BizError(
      BizCode.INVALID_STATUS,
      `该学生有收费单还在「${CONSULT_FEE_STATUS_NAME[Number(first.status)] || '处理中'}」` +
        `（${first.order_no ?? ''}），钱还没确认到账，不能发起退费。` +
        `请先在「收款与缴费」里让这张单走完财务确认，或直接作废后再办理退费。`,
    );
  }

  /**
   * ★ 2026-10-26 「驳回后能退回到哪」必须在发起时就记下来
   *
   * 老逻辑是驳回一律退回「试学中(5)」—— 待分班(4) 的人被驳回后凭空分了班，
   * 后续「分配班级」按钮也没了。现在把发起时的状态存进 origin_state，
   * 驳回时按它回滚；历史单没这个字段，就按「有没有分班」推断。
   */
  const originState: number = staleRefundState ? derivePreRefundState(stu) : stu.consult_state;
  if (staleRefundState) {
    await addHistory(
      consultStudentId,
      '系统',
      `检测到学生状态卡在「${CONSULT_STATE_NAME[stu.consult_state] || stu.consult_state}」，` +
        `但没有任何在途退费单（历史单据已被驳回、状态未回滚），` +
        `按「${CONSULT_STATE_NAME[originState] || originState}」重新发起退费`,
      '系统',
      'REFUND_STATE_SELF_HEAL',
    );
  }

  // ---- 试算 ----
  const calc = await calcRefund(
    consultStudentId,
    payload.trialStart,
    payload.trialEnd,
    payload.trialDays,
    payload.itemNames || [],
    payload.dailyItems,
  );

  if (calc.incomeAmount <= 0) {
    throw new BizError(
      BizCode.TRIAL_FEE_NOT_ARRIVED,
      '该学生的试学费尚未确认到账，无法办理退费。请先在「收款与缴费」页上传缴费截图并等财务确认。',
    );
  }

  // ---- 经理自审自批：直接进「待财务打款」 ----
  const selfApprove = operator.isManager;
  const status = selfApprove ? CRS.PENDING_FINANCE : CRS.PENDING_MANAGER;

  const refundId = randomUUID();
  const refundNo = await nextRefundNo();

  await db(REFUND_TABLE).insert({
    id: refundId,
    refund_no: refundNo,
    consult_student_id: consultStudentId,
    student_name: stu.student_name,
    student_no: stu.student_no || tempStudentNo(consultStudentId),
    class_name: stu.class_name || null,

    apply_by_id: null,
    apply_by_name: operator.name,
    apply_by_title: operator.title || '咨询师',
    apply_at: new Date(),
    self_approve: selfApprove,
    approve_by_name: selfApprove ? `${operator.name}（自审自批）` : null,
    approve_at: selfApprove ? new Date() : null,

    trial_start: payload.trialStart,
    trial_end: payload.trialEnd,
    trial_days: calc.trialDays,
    income_amount: calc.incomeAmount,
    deduct_detail: JSON.stringify(calc.deductItems),
    deduct_total: calc.deductTotal,
    refund_amount: calc.refundAmount,

    status,
    /** ★ 2026-10-26 发起时的状态，驳回时用来回滚 */
    origin_state: originState,
    remark: payload.remark || null,

    create_time: new Date(),
    create_by: operator.name,
    create_by_name: operator.name,
    is_deleted: false,
  });

  // ---- 变更学生状态 + 写历史 ----
  const nextState = selfApprove ? ConsultState.REFUND_FINANCE : ConsultState.REFUND_MGR;
  await changeState(consultStudentId, nextState, {
    byName: operator.name,
    byTitle: operator.title,
    action: 'REFUND_APPLY',
    historyText: selfApprove
      ? `经理发起退费申请并自审自批：试学 ${calc.trialDays} 天消耗 ¥${centToYuan(calc.deductTotal)}，应退 ¥${centToYuan(calc.refundAmount)}，直接上报财务打款（${refundNo}）`
      : `学生申请退学（试学阶段流失），发起退费申请：试学 ${calc.trialDays} 天消耗 ¥${centToYuan(calc.deductTotal)}，应退 ¥${centToYuan(calc.refundAmount)}，等待咨询经理审批（${refundNo}）`,
  });

  // ---- 自审自批的，立刻上报财务 ----
  if (selfApprove) {
    await reportToFinance(refundId, { name: operator.name, title: operator.title });
  }

  return { refundId, refundNo };
}

/* ============================================================
 * ⭐ 驳回 → 学生状态回滚（经理驳回 / 财务驳回共用）
 * ============================================================ */

/**
 * 推断「发起退费之前」学生应该处于什么状态（历史单没有 origin_state 时用）
 *
 * 已分班（class_id 有值）→ 试学中(5)；还没分班 → 待分班(4)。
 * 退费只允许从「咨询中 / 待分班 / 试学中」发起，所以这两个落点够了。
 */
function derivePreRefundState(stu: any): ConsultState {
  return String(stu?.class_id || '').trim() ? ConsultState.TRIAL : ConsultState.TRIAL_WAIT_CLASS;
}

/**
 * 驳回退费单后，把学生状态从「退费中」退回到发起之前
 *
 * ⚠️ 2026-10-26 为什么必须有这个函数：
 *   财务驳回那条链路（syncRefundFromFinance，rs=7）**只改了退费单状态，
 *   没回滚学生状态** → 学生永远停在「退费·待财务打款(9)」：
 *     · 「发起退费」下拉按状态排除 8/9 → 搜不到这个人，没法二次发起；
 *     · 学生管理里状态是退费的，actionsOf 一个动作都不返回 → 没有后续操作；
 *     · 退费列表里那张单已经是「已驳回」，但没有任何入口能重新提交。
 *   结果就是一次财务驳回把学生彻底卡死，流程闭不上环。
 *
 * @param source '经理' | '财务' —— 只影响历史文案，处理逻辑完全一致
 */
async function restoreStudentAfterReject(
  row: any,
  opts: { reason: string; byName: string; byTitle?: string; source: '经理' | '财务' },
): Promise<void> {
  const stu = await findStudent(row.consult_student_id);
  if (!stu) return;

  const cur = Number(stu.consult_state);
  /**
   * 只回滚「还停在退费中」的学生。
   * 万一驳回期间有人手工把状态改成别的（例如已流失），以人工为准，不覆盖。
   */
  if (cur !== ConsultState.REFUND_MGR && cur !== ConsultState.REFUND_FINANCE) return;

  const restorable: number[] = [
    ConsultState.TRIAL_FEE_PENDING,
    ConsultState.TRIAL_WAIT_CLASS,
    ConsultState.TRIAL,
  ];
  const origin = Number(row.origin_state);
  const target = restorable.includes(origin) ? origin : derivePreRefundState(stu);

  await changeState(row.consult_student_id, target, {
    byName: opts.byName,
    byTitle: opts.byTitle,
    action: opts.source === '财务' ? 'REFUND_FINANCE_REJECT' : 'REFUND_REJECT',
    historyText:
      `${opts.source}驳回退费申请：${opts.reason}。` +
      `学生状态由「${CONSULT_STATE_NAME[cur] || cur}」退回「${CONSULT_STATE_NAME[target] || target}」，` +
      `可修改后重新发起退费`,
  });
}

/* ============================================================
 * 审批（经理）
 * ============================================================ */

/** 经理审批通过 */
export async function approveRefund(
  refundId: string,
  operator: { name: string; title?: string },
): Promise<void> {
  const row = await db(REFUND_TABLE).where({ id: refundId, is_deleted: false }).first();
  if (!row) throw new BizError(BizCode.REFUND_NOT_FOUND, '退费单不存在');

  if (row.status !== CRS.PENDING_MANAGER) {
    throw new BizError(
      BizCode.INVALID_STATUS,
      `只有「待经理审批」的退费单可以审批，当前状态是「${nameOf(CONSULT_REFUND_STATUS_NAME, row.status)}」`,
    );
  }

  // ---- 更新审批信息，状态 → 待财务打款 ----
  await db(REFUND_TABLE).where({ id: refundId }).update({
    status: CRS.PENDING_FINANCE,
    approve_by_name: operator.name,
    approve_at: new Date(),
    update_time: new Date(),
    update_by: operator.name,
  });

  // ---- 学生状态 → 退费·待财务打款 ----
  await changeState(row.consult_student_id, ConsultState.REFUND_FINANCE, {
    byName: operator.name,
    byTitle: operator.title,
    action: 'REFUND_APPROVE',
    historyText: `审批通过退费明细（应退 ¥${centToYuan(row.refund_amount)}），上报财务打款`,
  });

  // ---- ⭐ 上报财务 ----
  await reportToFinance(refundId, operator);
}

/** 经理驳回 */
export async function rejectRefund(
  refundId: string,
  rejectReason: string,
  operator: { name: string; title?: string },
): Promise<void> {
  const row = await db(REFUND_TABLE).where({ id: refundId, is_deleted: false }).first();
  if (!row) throw new BizError(BizCode.REFUND_NOT_FOUND, '退费单不存在');

  if (row.status !== CRS.PENDING_MANAGER) {
    throw new BizError(BizCode.INVALID_STATUS, '只有「待经理审批」的退费单可以驳回');
  }

  await db(REFUND_TABLE).where({ id: refundId }).update({
    status: CRS.REJECTED,
    reject_reason: rejectReason,
    reject_by_name: operator.name,
    update_time: new Date(),
    update_by: operator.name,
  });

  /**
   * ★ 2026-10-26 退回「发起之前的状态」（origin_state），不再一律退回试学中
   *
   * 待分班(4) 的学生被驳回后如果直接变试学中，等于凭空分了班 ——
   * 「分配班级」按钮也跟着消失（canEnroll 只认 4）。走统一回滚逻辑。
   */
  await restoreStudentAfterReject(row, {
    reason: rejectReason,
    byName: operator.name,
    byTitle: operator.title,
    source: '经理',
  });
}

/* ============================================================
 * ⭐ 上报财务
 * ============================================================ */

/**
 * 把退费单推给财务模块
 *
 * ⚠️ 财务侧有独立的退费申请接口（/refund/apply），
 *    调成功后把 finance_refund_id 回填到本地，便于后续回读打款结果。
 *
 * ⚠️ 失败不阻断：上报失败时保留「待财务打款」状态，
 *    并在历史里记一条警告，人工可在财务侧补录。
 */
async function reportToFinance(
  refundId: string,
  operator: { name: string; title?: string },
): Promise<void> {
  const row = await db(REFUND_TABLE).where({ id: refundId }).first();
  if (!row) return;

  try {
    /**
     * ⚠️ 2026-10-15 修复：入参原先缺 `refundItems` / `refundReason`，
     *    财务的 applySchema 里这两个是**必填**，zod 校验直接 400：
     *      「参数「refundItems」类型不正确」
     *    → 咨询退费单永远进不了财务（用户反馈的正是这个现象）。
     *
     * ⚠️ 同时补 deptCode：财务退费列表按「部门」分 Tab，
     *    不传部门的话这张单在财务的部门筛选下根本看不到。
     */
    const stu = await findStudent(row.consult_student_id).catch(() => null);
    const deptCode = stu?.dept_code != null ? Number(stu.dept_code) : undefined;

    const res = await financeClient.applyRefund({
      studentId: row.consult_student_id,
      studentNo: row.student_no || undefined,
      studentName: row.student_name || undefined,
      className: row.class_name || undefined,
      deptCode,
      /** 咨询退费只针对「试学费」（试学阶段流失），退费项目固定为 TRIAL_FEE */
      refundItems: [FeeType.TRIAL_FEE],
      refundAmount: row.refund_amount,
      refundReason: row.remark || '试学阶段流失退费',
      /**
       * ★ 2026-10-22 来源改成 CONSULT(3)
       *
       * 原来传 1（= HEAD_TEACHER「班主任提交」），财务退费列表上全是「班主任提交」，
       * 与真实来源不符（用户反馈：单据是咨询提交的）。
       */
      sourceType: RefundSourceType.CONSULT,
      // ★ 2026-10-26 必须带上游单号：财务出款后靠它回写「学生已流失」
      sourceModule: 'consult',
      sourceStage: 'jh',
      sourceRefundId: String(row.id),
      remark: `咨询模块退费单 ${row.refund_no}（试学 ${row.trial_days} 天，扣减 ¥${centToYuan(row.deduct_total)}）`,
    });

    await db(REFUND_TABLE).where({ id: refundId }).update({
      finance_refund_id: res.id,
      // ⚠️ 财务返回的字段是 `orderNo`（TF 单号），不是 refundNo ——
      //    原先读 refundNo 拿到 undefined，finance_refund_no 永远是空
      finance_refund_no: res.orderNo || null,
      update_time: new Date(),
    });

    await addHistory(
      row.consult_student_id,
      operator.name,
      `退费单已上报财务（财务单号 ${res.orderNo || res.id}），等待财务出款 ¥${centToYuan(row.refund_amount)}`,
      operator.title,
      'REFUND_REPORT',
    );
  } catch (err: any) {
    await addHistory(
      row.consult_student_id,
      '系统',
      `⚠️ 退费单上报财务失败：${err?.message || '未知错误'}。单据已保存在本地，请在财务模块手工补录。`,
      '系统',
      'REFUND_REPORT_FAILED',
    );
    console.error('[退费上报财务失败]', row.refund_no, err?.message);
  }
}

/* ============================================================
 * ⭐ 财务打款回写（自动 + 手工）
 * ============================================================ */

/**
 * 从财务侧回读退费状态
 *
 * ⚠️ 财务出款后，本模块要把状态更新为「已打款」，
 *    学生状态流转为「已退费」，并回写打款流水号。
 */
/**
 * ★ 2026-10-09 财务同步节流（同 syncFromFinance）：
 *    退费列表每次刷新都全量回读财务，自调用 HTTP 并发放大导致请求超时。
 *    10 秒内不重复跑；指定 refundIds 的强制同步不受节流限制。
 */
const REFUND_SYNC_THROTTLE_MS = 10_000;
let lastRefundSyncAt = 0;

export async function syncRefundFromFinance(refundIds?: string[]): Promise<{ updated: number }> {
  if (!refundIds?.length && Date.now() - lastRefundSyncAt < REFUND_SYNC_THROTTLE_MS) {
    return { updated: 0 };
  }
  lastRefundSyncAt = Date.now();

  let query = db(REFUND_TABLE).where({ is_deleted: false, status: CRS.PENDING_FINANCE });
  if (refundIds?.length) {
    query = db(REFUND_TABLE).where({ is_deleted: false }).whereIn('id', refundIds);
  }
  const rows: any[] = await query;

  let updated = 0;
  for (const row of rows) {
    if (!row.finance_refund_id) continue;
    try {
      const detail: any = await financeClient.getRefundDetail(row.finance_refund_id);
      // 财务 RefundStatus: 6=已退费 7=已驳回 4=待财务出款
      const rs = detail?.refundStatus;

      if (rs === 6) {
        // ---- 已打款 ----
        await db(REFUND_TABLE).where({ id: row.id }).update({
          status: CRS.PAID,
          pay_by_name: detail.financePayBy || detail.payBy || '财务专员',
          pay_at: detail.financePayTime ? new Date(detail.financePayTime) : new Date(),
          pay_method: detail.payMethod || '银行转账',
          pay_ref: detail.billNo || detail.financePayNo || null,
          pay_to: detail.payTo || null,
          update_time: new Date(),
          update_by: 'system-sync',
        });

        // ★ 2026-10-15 用户口径：财务退款之后学生状态流转为「流失」，
        //    流失原因 = 发起退款时填写的流失原因（退费单 remark = 「流失原因 · 备注」）
        await changeState(row.consult_student_id, ConsultState.LOST, {
          byName: '财务模块',
          byTitle: '系统',
          action: 'REFUND_PAID',
          historyText: `退费打款 ¥${centToYuan(row.refund_amount)} 已完成，学生状态流转为「流失」`,
          extraFields: { loss_reason: row.remark || '退费流失' },
        });

        /* ★ 2026-10-16 分期：人已流失，未收的尾款不再收，终止在途分期计划 */
        await terminateStudentPlans(row.consult_student_id, '学生已退费流失');

        updated++;
      } else if (rs === 7) {
        // ---- 财务驳回 ----
        await db(REFUND_TABLE).where({ id: row.id }).update({
          status: CRS.REJECTED,
          reject_reason: detail.rejectReason || '财务驳回',
          // ★ 2026-10-26 以前这里留 null，列表上看不出是谁驳回的
          reject_by_name: detail.financeRejectBy || '财务模块',
          update_time: new Date(),
          update_by: 'system-sync',
        });
        /**
         * ★ 2026-10-26 关键修复：财务驳回必须把学生状态一起回滚
         *
         * 原来这里只改了退费单状态 + 写一条历史，学生一直停在
         * 「退费·待财务打款(9)」→ 退费下拉选不到、学生管理也没按钮，
         * 财务驳回一次就把人卡死（现场：王麻子 / TK20261026-002）。
         */
        await restoreStudentAfterReject(row, {
          reason: detail.rejectReason || '财务驳回',
          byName: '财务模块',
          byTitle: '系统',
          source: '财务',
        });
        updated++;
      }
    } catch (err: any) {
      console.warn('[syncRefundFromFinance] 跳过', row.refund_no, err?.message);
    }
  }

  return { updated };
}

/**
 * 手工确认打款（联调演示用）
 *
 * ⚠️ 真实场景应由财务侧出款后自动回写。
 *    这里保留手工入口，方便在财务模块未启动时也能演示完整流程。
 */
export async function manualPay(
  refundId: string,
  payload: {
    payMethod?: string;
    payRef?: string;
    payTo?: string;
  },
  operator: { name: string; title?: string },
): Promise<{ payRef: string }> {
  const row = await db(REFUND_TABLE).where({ id: refundId, is_deleted: false }).first();
  if (!row) throw new BizError(BizCode.REFUND_NOT_FOUND, '退费单不存在');

  if (row.status !== CRS.PENDING_FINANCE) {
    throw new BizError(BizCode.INVALID_STATUS, '只有「待财务打款」的退费单可以执行打款');
  }

  const payRef = payload.payRef || String(Date.now());

  await db(REFUND_TABLE).where({ id: refundId }).update({
    status: CRS.PAID,
    pay_by_name: operator.name,
    pay_at: new Date(),
    pay_method: payload.payMethod || '银行转账',
    pay_ref: payRef,
    pay_to: payload.payTo || null,
    update_time: new Date(),
    update_by: operator.name,
  });

  // ★ 2026-10-15 用户口径：财务退款之后学生状态流转为「流失」，
  //    流失原因 = 发起退款时填写的流失原因（退费单 remark = 「流失原因 · 备注」）
  await changeState(row.consult_student_id, ConsultState.LOST, {
    byName: operator.name,
    byTitle: operator.title,
    action: 'REFUND_PAID',
    historyText: `退费打款 ¥${centToYuan(row.refund_amount)}（${payload.payMethod || '银行转账'} · 流水号 ${payRef}），学生状态流转为「流失」`,
    extraFields: { loss_reason: row.remark || '退费流失' },
  });

  /* ★ 2026-10-16 分期：人已流失，未收的尾款不再收，终止在途分期计划 */
  await terminateStudentPlans(row.consult_student_id, '学生已退费流失');

  return { payRef };
}

/* ============================================================
 * 查询
 * ============================================================ */

/** 构造列表查询 */
export function buildRefundQuery(q: any, scopeOwner?: string) {
  const query = db(REFUND_TABLE).where('is_deleted', false);

  if (q.studentName) query.andWhere('student_name', 'like', `%${q.studentName}%`);
  if (q.refundNo) query.andWhere('refund_no', 'like', `%${q.refundNo}%`);
  if (q.className) query.andWhere('class_name', 'like', `%${q.className}%`);
  if (q.status) query.andWhere('status', q.status);
  if (q.ownerName) query.andWhere('apply_by_name', 'like', `%${q.ownerName}%`);
  if (q.keyword) {
    query.andWhere((qb: any) => {
      qb.where('student_name', 'like', `%${q.keyword}%`)
        .orWhere('refund_no', 'like', `%${q.keyword}%`)
        .orWhere('apply_by_name', 'like', `%${q.keyword}%`)
        .orWhere('class_name', 'like', `%${q.keyword}%`);
    });
  }
  // 咨询师只看自己的
  if (scopeOwner) {
    query.andWhere((qb: any) => {
      qb.where('apply_by_name', scopeOwner)
        .orWhereIn(
          'consult_student_id',
          db('t_consult_student').select('id').where('owner_name', scopeOwner).where('is_deleted', false),
        );
    });
  }
  return query;
}

/** 退费统计 */
export async function getRefundStats(q: any = {}, scopeOwner?: string): Promise<ConsultRefundStats> {
  const rows: any[] = await buildRefundQuery(q, scopeOwner).select('status', 'refund_amount');
  const stat = (st: number) => rows.filter((r) => r.status === st);

  return {
    pendingManagerCount: stat(CRS.PENDING_MANAGER).length,
    pendingFinanceCount: stat(CRS.PENDING_FINANCE).length,
    paidCount: stat(CRS.PAID).length,
    rejectedCount: stat(CRS.REJECTED).length,
    paidAmount: stat(CRS.PAID).reduce((a, b) => a + Number(b.refund_amount || 0), 0),
  };
}
