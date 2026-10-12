/**
 * 收款单服务（咨询发起 → 财务核对）
 *
 * ⚠️ 核心联动逻辑：
 *    发起收费 → 调财务 /standard/get 拿金额（规则2）
 *             → 调财务 /fee/add 建单（带 sourceModule=1，规则3-①）
 *             → 把财务返回的 feeId 存到本地，用于后续回读核对状态
 *
 * ⚠️ 金额一律「分」，本文件内不出现浮点运算。
 */

import { randomUUID } from 'crypto';
import {
  BizCode,
  FeeType,
  FEE_TYPE_NAME,
  PayStatus,
  PAY_STATUS_NAME,
  DeptCode,
  SourceModule,
  FULL_FEE_TYPES,
  ConsultState,
  CONSULT_STATE_NAME,
  nameOf,
} from 'shared-types/consult';
import type {
  ConsultFeeOrder,
  ConsultFeeCreateResult,
  ConsultFeeStats,
  ConsultFeeStatus,
  ConsultSupplementPlan,
} from 'shared-types/consult';
import { ConsultFeeStatus as CFS, CONSULT_FEE_STATUS_NAME } from 'shared-types/consult';
import { db } from '../utils/db';
import { BizError } from '../middleware/errorHandler';
import { financeClient } from './finance.client';
import { formatTime, findStudent, addHistory } from './student.service';
import { changeState } from './state.service';

export const FEE_ORDER_TABLE = 't_consult_fee_order';

/**
 * 补缴明细里「单类型状态」的中文名
 *
 * ⚠️ 与 ConsultFeeStatus 不同：
 *    ConsultFeeStatus 描述「一张单」的状态（含 NO_VOUCHER 待上传凭证），
 *    而补缴明细描述「一个费用类型」的缺口，所以多了 NOT_STARTED（还没发起过）。
 */
export const SUPPLEMENT_STATE_NAME: Record<string, string> = {
  ARRIVED: '已到账',
  PENDING: '待确认',
  REJECTED: '已驳回',
  NOT_STARTED: '未发起',
};

/* ============================================================
 * 单号生成
 * ============================================================ */

/**
 * 生成本模块收款单号：SK + YYYYMMDD + 3 位序号
 * 例：SK20261002-001
 *
 * ⚠️ 并发撞号由唯一索引兜底（uk_cfo_order_no），撞了就重试
 */
export async function nextOrderNo(): Promise<string> {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const day = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  const prefix = `SK${day}-`;

  const row = await db(FEE_ORDER_TABLE)
    .where('order_no', 'like', `${prefix}%`)
    .orderBy('order_no', 'desc')
    .first();

  let seq = 1;
  if (row?.order_no) {
    const last = Number(String(row.order_no).slice(prefix.length));
    if (!isNaN(last)) seq = last + 1;
  }
  return `${prefix}${String(seq).padStart(3, '0')}`;
}

/* ============================================================
 * 临时学号
 * ============================================================ */

/**
 * 咨询阶段临时学号
 *
 * 业务背景：
 *   学生在咨询阶段只有「咨询学生ID」（cs-0001），正式学号（S20260001）
 *   要等转正式、由教务分配。但财务侧的缴费单 studentNo 是必填（用于对账快照），
 *   所以咨询侧建单时先生成一个临时学号占位。
 *
 * 规则：去掉 ID 前缀，取数字部分 → cs-0006 → ZX0006
 *
 * ⚠️ 转正式后教务会分配正式学号，届时以教务/财务侧为准，
 *    本临时号只用于咨询阶段的缴费单对账。
 */
export function tempStudentNo(consultStudentId: string): string {
  const digits = String(consultStudentId).replace(/\D/g, '');
  return digits ? `ZX${digits.padStart(4, '0')}` : `ZX${String(consultStudentId).slice(-6)}`;
}

/* ============================================================
 * 行 → 视图
 * ============================================================ */

/** 元转分（前端传元时用；本模块内部一律分） */
export function yuanToCent(y: number | string): number {
  return Math.round(Number(y) * 100);
}

/** 分转元字符串（显示用，两位小数） */
export function centToYuan(c: number): string {
  return (Number(c || 0) / 100).toFixed(2);
}

/** 行 → 视图 */
export function toOrderView(row: any): ConsultFeeOrder {
  return {
    orderId: row.id,
    financeFeeId: row.finance_fee_id || undefined,
    orderNo: row.order_no,
    consultStudentId: row.consult_student_id,
    studentName: row.student_name || '',
    studentNo: row.student_no || undefined,
    className: row.class_name || undefined,
    // ★ 2026-10-09 学生当前咨询状态（list 接口补查注入；已退费/退费中时前端隐藏「分班」）
    consultState: row.consult_state ?? undefined,
    consultStateName:
      row.consult_state !== undefined && row.consult_state !== null
        ? nameOf(CONSULT_STATE_NAME, row.consult_state)
        : undefined,
    feeType: row.fee_type,
    feeTypeName: nameOf(FEE_TYPE_NAME, row.fee_type),
    amount: row.amount,
    amountYuan: centToYuan(row.amount),
    status: row.status,
    statusName: nameOf(CONSULT_FEE_STATUS_NAME, row.status),
    financePayStatus: row.finance_pay_status ?? undefined,
    financePayStatusName: row.finance_pay_status
      ? nameOf(PAY_STATUS_NAME, row.finance_pay_status)
      : undefined,
    rejectReason: row.reject_reason || undefined,
    voucherUrl: row.voucher_url || undefined,
    voucherNo: row.voucher_no || undefined,
    voucherBy: row.voucher_by || undefined,
    payMethod: row.pay_method || undefined,
    createdByName: row.create_by_name || '',
    createTime: formatTime(row.create_time),
    lastAction: row.reject_reason
      ? `财务打回：${row.reject_reason}`
      : row.status === CFS.ARRIVED
        ? '财务已确认到账'
        : row.status === CFS.PENDING
          ? '凭证已上传，等待财务核对'
          : '已发起收费，等待上传缴费截图',
  };
}

/* ============================================================
 * ⭐ 发起收费（核心联动）
 * ============================================================ */

/**
 * 发起一笔或多笔收费
 *
 * 流程（每一笔独立处理，单笔失败不影响其他笔）：
 *   1. 调财务 /standard/get 拿金额 + 来源校验信息
 *   2. 调财务 /fee/add 建单（amount 不传 → 财务按标准取）
 *   3. 本地落一条收款单记录（保存 financeFeeId）
 */
export async function createFees(
  consultStudentId: string,
  feeTypes: FeeType[],
  operator: { name: string; title?: string },
  payMethod?: string,
): Promise<ConsultFeeCreateResult> {
  const stu = await findStudent(consultStudentId);
  if (!stu) {
    throw new BizError(BizCode.STUDENT_NOT_FOUND, '学生不存在');
  }

  const deptCode: DeptCode = stu.dept_code || DeptCode.JUNIOR_SENIOR;
  // ⚠️ 咨询阶段学生还没有正式学号（转正式后由教务分配），
  //    但财务侧 studentNo 是必填（用于对账快照），所以这里生成「临时学号」：
  //    规则：ZX + 咨询学生ID 去掉前缀 → 如 cs-0006 → ZX0006
  //    转正式时教务会分配正式学号（S202600XX），届时以教务为准。
  const studentNo = stu.student_no || tempStudentNo(consultStudentId);
  const created: ConsultFeeCreateResult['created'] = [];
  // 同一次发起用同一个批次号，便于前端分组显示
  const batchNo = Date.now();

  for (const feeType of feeTypes) {
    const feeTypeName = nameOf(FEE_TYPE_NAME, feeType);

    try {
      // ---- 1. 取费用标准（规则2）----
      // ⚠️ 不传 amount 给财务，让财务自己按标准取值，避免两边算不一致
      const std = await financeClient.getStandard(feeType, deptCode);

      // ---- 2. 校验来源（规则3-① 的前置检查，财务侧还会再校验一次）----
      if (std.sourceModule !== SourceModule.CONSULT) {
        throw new BizError(
          BizCode.SOURCE_MODULE_MISMATCH,
          `${feeTypeName} 应由「${std.sourceModuleName}」发起，咨询模块无权建单。`,
        );
      }

      // ---- 3. 调财务建单 ----
      const financeRes = await financeClient.addFee({
        studentId: consultStudentId,
        studentNo,
        studentName: stu.student_name,
        feeType,
        deptCode,
        classId: stu.class_id || undefined,
        className: stu.class_name || undefined,
        sourceModule: SourceModule.CONSULT,
        payMethod,
        remark: `咨询模块发起（${operator.name}）`,
      });

      // ---- 4. 本地落库 ----
      const orderId = randomUUID();
      const orderNo = await nextOrderNo();
      await db(FEE_ORDER_TABLE).insert({
        id: orderId,
        order_no: orderNo,
        finance_fee_id: financeRes.id,
        consult_student_id: consultStudentId,
        student_name: stu.student_name,
        student_no: studentNo,
        class_name: stu.class_name || null,
        dept_code: deptCode,
        fee_type: feeType,
        amount: std.amount,
        status: CFS.NO_VOUCHER,     // 刚建单，还没传凭证
        pay_method: payMethod || null,
        batch_no: batchNo,
        create_time: new Date(),
        create_by: operator.name,
        create_by_name: operator.name,
        is_deleted: false,
      });

      created.push({
        orderId,
        financeFeeId: financeRes.id,
        orderNo,
        feeType,
        feeTypeName,
        amount: std.amount,
        success: true,
      });
    } catch (err: any) {
      // 单笔失败不影响其他笔
      created.push({
        orderId: '',
        orderNo: '',
        feeType,
        feeTypeName,
        amount: 0,
        success: false,
        reason: err?.message || '未知错误',
      });
    }
  }

  const okCount = created.filter((c) => c.success).length;
  const failCount = created.length - okCount;

  // 写跟进历史
  if (okCount > 0) {
    const total = created.filter((c) => c.success).reduce((a, b) => a + b.amount, 0);
    const names = created.filter((c) => c.success).map((c) => c.feeTypeName).join('/');
    await addHistory(
      consultStudentId,
      operator.name,
      `发起收费：${names} 共 ¥${centToYuan(total)}，等待上传缴费截图并由财务确认到账`,
      operator.title,
      'CHARGE',
    );
  }

  return {
    created,
    message: failCount === 0
      ? `${okCount} 笔已发起成功，请上传缴费截图`
      : `${okCount} 笔成功、${failCount} 笔失败：${created.filter((c) => !c.success).map((c) => `${c.feeTypeName}（${c.reason}）`).join('；')}`,
  };
}

/* ============================================================
 * 凭证上传 / 重新提交
 * ============================================================ */

/**
 * 上传缴费凭证
 *
 * ⚠️ 这里会把凭证同步给财务侧 —— 调财务 /fee/add 时带 voucherUrl，
 *    但单已建过，所以走「更新」路径：
 *    实际做法是：本地先存，然后提示财务侧（财务的凭证更新接口在本期未开放，
 *    故此处仅本地记录 + 提示「请在财务模块核对页确认」）。
 *
 *    如果财务侧后续开放凭证更新接口，把 TODO 部分补上即可。
 */
export async function uploadVoucher(
  orderId: string,
  voucherUrl: string,
  voucherNo: string | undefined,
  operator: { name: string; title?: string },
): Promise<void> {
  const row = await db(FEE_ORDER_TABLE).where({ id: orderId, is_deleted: false }).first();
  if (!row) {
    throw new BizError(BizCode.ORDER_NOT_FOUND, '收款单不存在');
  }

  // 已到账的单子不允许再改凭证
  if (row.status === CFS.ARRIVED) {
    throw new BizError(BizCode.INVALID_STATUS, '该笔费用已确认到账，不能再修改凭证');
  }

  await db(FEE_ORDER_TABLE).where({ id: orderId }).update({
    voucher_url: voucherUrl,
    voucher_no: voucherNo || null,
    voucher_by: operator.name,
    // 上传凭证 → 状态变「待确认」，等财务核对
    status: CFS.PENDING,
    reject_reason: null,
    update_time: new Date(),
    update_by: operator.name,
  });

  await addHistory(
    row.consult_student_id,
    operator.name,
    `上传缴费截图（${nameOf(FEE_TYPE_NAME, row.fee_type)} ¥${centToYuan(row.amount)}${voucherNo ? `，转账单号 ${voucherNo}` : ''}），等待财务核对`,
    operator.title,
    'UPLOAD_VOUCHER',
  );

  // ---- 回传凭证给财务（规则3-②的呼应）----
  // ⚠️ 必须回传成功才算上传完成，原因：
  //    财务侧会做「凭证唯一性」校验（非餐费一人一张，规则3-②），
  //    如果只是本地记录、财务拒绝了却不告诉用户，会出现
  //    「学生以为交了、财务那边根本没这张单」的对不上账。所以这里要：
  //      ① 回传失败 → 回滚本地凭证和状态 ② 把财务的原因原样抛给用户
  if (row.finance_fee_id) {
    try {
      await financeClient.attachVoucher({
        id: row.finance_fee_id,
        voucherUrl,
        voucherNo: voucherNo || undefined,
      });
      await addHistory(
        row.consult_student_id,
        operator.name,
        '缴费凭证已同步至财务模块，等待财务核对到账',
        operator.title,
        'VOUCHER_SYNCED',
      );
    } catch (err: any) {
      // 回滚本地：把凭证撤掉，状态退回「待上传凭证」
      await db(FEE_ORDER_TABLE).where({ id: orderId }).update({
        voucher_url: null,
        voucher_no: null,
        voucher_by: null,
        status: CFS.NO_VOUCHER,
        update_time: new Date(),
        update_by: operator.name,
      });

      // 财务的原始原因对用户最有价值（例如「该凭证已被 XX 占用」），原样透出
      const reason = err?.message || '财务模块不可达，请稍后重试';
      await addHistory(
        row.consult_student_id,
        operator.name,
        `凭证上传失败（财务未接受）：${reason}`,
        operator.title,
        'VOUCHER_REJECTED',
      );
      throw new BizError(BizCode.DOWNSTREAM_ERROR, `凭证未通过财务校验：${reason}`);
    }
  }
}

/** 被驳回后重新提交（把状态推回待确认） */
export async function resubmitOrder(
  orderId: string,
  operator: { name: string; title?: string },
): Promise<void> {
  const row = await db(FEE_ORDER_TABLE).where({ id: orderId, is_deleted: false }).first();
  if (!row) throw new BizError(BizCode.ORDER_NOT_FOUND, '收款单不存在');

  if (row.status !== CFS.REJECTED) {
    throw new BizError(BizCode.INVALID_STATUS, '只有被驳回的单据才能重新提交');
  }
  if (!row.voucher_url) {
    throw new BizError(BizCode.REQUIRED_FIELD_MISSING, '请先上传缴费截图再重新提交');
  }

  await db(FEE_ORDER_TABLE).where({ id: orderId }).update({
    status: CFS.PENDING,
    update_time: new Date(),
    update_by: operator.name,
  });

  await addHistory(
    row.consult_student_id,
    operator.name,
    `重新提交被驳回的收款单（${nameOf(FEE_TYPE_NAME, row.fee_type)} ¥${centToYuan(row.amount)}）`,
    operator.title,
    'RESUBMIT',
  );
}

/* ============================================================
 * ⭐ 回读财务状态（同步核对结果）
 * ============================================================ */

/**
 * 从财务侧拉取最新核对状态，更新本地收款单
 *
 * ⚠️ 为什么要这一步？
 *    核对动作是财务做的，咨询侧只是"旁观者"。
 *    每次打开收款列表时主动同步一次，保证状态是最新的。
 *
 * @param orderIds 可选，只同步指定的单；不传则同步全部未到账的单
 */
/**
 * ★ 2026-10-09 财务同步节流：
 *    fee/list 每次刷新都会触发全量同步，而同步内部是「自调用 HTTP」（单体里
 *    打回自己 8004），并发刷新时嵌套放大连接占用 —— 是「请求超时」的主要来源。
 *    加 10 秒节流：刚同步过就跳过（指定 orderIds 的强制同步不受节流限制）。
 */
const SYNC_THROTTLE_MS = 10_000;
let lastFeeSyncAt = 0;

export async function syncFromFinance(orderIds?: string[]): Promise<{ updated: number }> {
  if (!orderIds?.length && Date.now() - lastFeeSyncAt < SYNC_THROTTLE_MS) {
    return { updated: 0 };
  }
  lastFeeSyncAt = Date.now();

  let query = db(FEE_ORDER_TABLE).where({ is_deleted: false });
  if (orderIds?.length) {
    query = query.whereIn('id', orderIds);
  } else {
    // 只要还没到账的（已到账/已驳回的不用再查）
    query = query.whereIn('status', [CFS.NO_VOUCHER, CFS.PENDING]);
  }
  const rows = await query;

  let updated = 0;
  for (const row of rows) {
    if (!row.finance_fee_id) continue;
    try {
      const detail: any = await financeClient.getFeeDetail(row.finance_fee_id);
      const payStatus = detail?.payStatus;

      let nextStatus: ConsultFeeStatus | null = null;
      let rejectReason: string | null = null;

      if (payStatus === PayStatus.VERIFIED) {
        nextStatus = CFS.ARRIVED;
      } else if (detail?.rejectReason || detail?.status === 'REJECTED') {
        // 财务打回
        nextStatus = CFS.REJECTED;
        rejectReason = detail.rejectReason || '财务打回，凭证有误';
      } else if (payStatus === PayStatus.PAID) {
        nextStatus = CFS.PENDING;
      }

      if (nextStatus !== null && nextStatus !== row.status) {
        await db(FEE_ORDER_TABLE).where({ id: row.id }).update({
          status: nextStatus,
          finance_pay_status: payStatus,
          reject_reason: rejectReason,
          update_time: new Date(),
          update_by: 'system-sync',
        });

        // 状态变化时补历史
        if (nextStatus === CFS.ARRIVED) {
          await addHistory(
            row.consult_student_id,
            '财务模块',
            `${nameOf(FEE_TYPE_NAME, row.fee_type)} ¥${centToYuan(row.amount)} 财务已确认到账`,
            '系统',
            'FEE_ARRIVED',
          );
          // ★ 2026-10-08 到账不只是改收款单 —— 学生的咨询状态也要跟着流转，
          //   否则会停在「试学费·待确认」不动（用户实测：财务确认到账后状态没变）
          await advanceStudentStateOnArrival(row);
        } else if (nextStatus === CFS.REJECTED) {
          await addHistory(
            row.consult_student_id,
            '财务模块',
            `${nameOf(FEE_TYPE_NAME, row.fee_type)} ¥${centToYuan(row.amount)} 被财务打回：${rejectReason}`,
            '系统',
            'FEE_REJECTED',
          );
        }
        updated++;
      } else if (payStatus !== row.finance_pay_status) {
        // 状态没变但 payStatus 变了（如 待缴→已缴），也更新一下
        await db(FEE_ORDER_TABLE).where({ id: row.id }).update({
          finance_pay_status: payStatus,
        });
      }
    } catch (err: any) {
      // 财务侧查不到这张单（可能被删了）不报错，跳过
      console.warn('[syncFromFinance] 跳过', row.order_no, err?.message);
    }
  }

  // ★ 2026-10-08 补偿：在「推进逻辑上线之前」就已到账的单，
  //   不会再进上面的循环（它们的收款单状态已是 ARRIVED），靠这里补推学生状态。
  try {
    await syncArrivedStudentStates();
  } catch (err: any) {
    console.warn('[syncFromFinance] 到账状态补偿失败', err?.message);
  }

  return { updated };
}

/**
 * ★ 2026-10-08 补偿同步：遍历所有「已到账」的收款单，
 *    若学生状态还停在对应前置状态（说明之前漏推了），补推一次。
 *    幂等：推进本身有前置状态守卫，推过一次后不再重复。
 */
async function syncArrivedStudentStates(): Promise<void> {
  const rows = await db(FEE_ORDER_TABLE).where({ is_deleted: false, status: CFS.ARRIVED });
  for (const row of rows) {
    try {
      await advanceStudentStateOnArrival(row);
    } catch (err: any) {
      console.warn('[syncArrivedStudentStates] 跳过', row.order_no, err?.message);
    }
  }
}

/**
 * ★ 2026-10-08 费用到账 → 推进学生的咨询流转状态
 *
 * ⚠️ 用户实测问题：财务确认到账、凭证也传了，学生的「当前状态」
 *    还停在「试学费·待确认」不动 —— 根因就是 syncFromFinance 只更新了
 *    收款单状态，没有推进学生。
 *
 * 流转规则（只在学生处于对应前置状态时才动，幂等可重试）：
 *    · 试学费到账  → TRIAL_FEE_PENDING（试学费·待确认）→ TRIAL_WAIT_CLASS（试学中·待分班）
 *    · 学费（全款）到账 → 当前所有全款费用单都到账后 → FORMAL（正式学员）
 *      （转正式会一次发 4 笔 FULL_FEE_TYPES，必须等全到，不能到一笔就转）
 */
async function advanceStudentStateOnArrival(row: any): Promise<void> {
  const stu = await findStudent(row.consult_student_id);
  if (!stu) return;

  const cur = stu.consult_state as ConsultState;
  let target: ConsultState | null = null;
  let gate = '';

  if (row.fee_type === FeeType.TRIAL_FEE) {
    if (cur === ConsultState.TRIAL_FEE_PENDING) {
      target = ConsultState.TRIAL_WAIT_CLASS;
      gate = '试学费已到账';
    }
  } else if (FULL_FEE_TYPES.includes(row.fee_type)) {
    if (
      cur === ConsultState.FULL_FEE_PENDING ||
      cur === ConsultState.TRIAL_WAIT_CLASS ||
      cur === ConsultState.TRIAL
    ) {
      // 全款口径：该学生所有全款费用单全部到账才转「正式学员」
      const rows = await db(FEE_ORDER_TABLE)
        .where({ consult_student_id: row.consult_student_id, is_deleted: false })
        .whereIn('fee_type', FULL_FEE_TYPES)
        .whereNotIn('status', [CFS.ARRIVED]);
      const unpaidLeft = rows.filter((r: any) => r.id !== row.id).length;
      if (unpaidLeft === 0) {
        target = ConsultState.FORMAL;
        gate = '全款费用已全部到账';
      }
    }
  }

  if (!target) return;

  await changeState(row.consult_student_id, target, {
    byName: '财务模块',
    byTitle: '系统',
    action: 'FEE_ARRIVED_STATE',
    historyText: `${gate}，学生状态流转为「${nameOf(CONSULT_STATE_NAME, target)}」（由收款单 ${row.order_no} 触发）`,
  });
}

/* ============================================================
 * 查询
 * ============================================================ */

/** 构造列表查询 */
export function buildOrderQuery(q: any) {
  const query = db(FEE_ORDER_TABLE).where('is_deleted', false);

  if (q.studentName) query.andWhere('student_name', 'like', `%${q.studentName}%`);
  if (q.className) query.andWhere('class_name', 'like', `%${q.className}%`);
  if (q.feeType) query.andWhere('fee_type', q.feeType);
  if (q.status !== undefined && q.status !== null && q.status !== '') {
    query.andWhere('status', q.status);
  }
  if (q.ownerName) {
    // 按跟进人筛选：先查学生 id
    query.whereIn(
      'consult_student_id',
      db('t_consult_student').select('id').where('owner_name', 'like', `%${q.ownerName}%`).where('is_deleted', false),
    );
  }
  if (q.keyword) {
    query.andWhere((qb: any) => {
      qb.where('student_name', 'like', `%${q.keyword}%`)
        .orWhere('order_no', 'like', `%${q.keyword}%`)
        .orWhere('student_no', 'like', `%${q.keyword}%`)
        .orWhere('class_name', 'like', `%${q.keyword}%`);
    });
  }
  return query;
}

/** 统计（列表页 4 张卡） */
export async function getFeeStats(q: any = {}): Promise<ConsultFeeStats> {
  const rows: any[] = await buildOrderQuery(q).select('status', 'amount', 'voucher_url');

  const stat = (st: number) => rows.filter((r) => r.status === st);
  const sum = (list: any[]) => list.reduce((a, b) => a + Number(b.amount || 0), 0);

  return {
    pendingCount: stat(CFS.PENDING).length,
    pendingAmount: sum(stat(CFS.PENDING)),
    arrivedCount: stat(CFS.ARRIVED).length,
    arrivedAmount: sum(stat(CFS.ARRIVED)),
    rejectedCount: stat(CFS.REJECTED).length,
    voucherCount: rows.filter((r) => !!r.voucher_url).length,
  };
}

/** 查某学生的费用统计（学生列表页显示「已到账 N · 待确认 M」） */
export async function getStudentFeeStatMap(
  studentIds: string[],
): Promise<Record<string, { paid: number; pending: number }>> {
  if (!studentIds.length) return {};
  const rows: any[] = await db(FEE_ORDER_TABLE)
    .where('is_deleted', false)
    .whereIn('consult_student_id', studentIds)
    .select('consult_student_id', 'status');

  const map: Record<string, { paid: number; pending: number }> = {};
  for (const r of rows) {
    const key = r.consult_student_id;
    if (!map[key]) map[key] = { paid: 0, pending: 0 };
    if (r.status === CFS.ARRIVED) map[key].paid++;
    else if (r.status === CFS.NO_VOUCHER || r.status === CFS.PENDING) map[key].pending++;
  }
  return map;
}

/** 取某学生「已到账」的试学费合计（退费算钱用） */
export async function getArrivedTrialIncome(consultStudentId: string): Promise<number> {
  const row: any = await db(FEE_ORDER_TABLE)
    .where({
      consult_student_id: consultStudentId,
      fee_type: FeeType.TRIAL_FEE,
      status: CFS.ARRIVED,
      is_deleted: false,
    })
    .sum({ total: 'amount' })
    .first();
  return Number(row?.total || 0);
}

/** 检查某学生是否所有全款费用都已到账（转正式判定用） */
export async function checkFullFeeArrived(
  consultStudentId: string,
  fullFeeTypes: FeeType[],
): Promise<{ allArrived: boolean; missing: FeeType[] }> {
  const rows: any[] = await db(FEE_ORDER_TABLE)
    .where({
      consult_student_id: consultStudentId,
      status: CFS.ARRIVED,
      is_deleted: false,
    })
    .whereIn('fee_type', fullFeeTypes)
    .select('fee_type');

  const arrivedTypes = new Set(rows.map((r) => r.fee_type));
  const missing = fullFeeTypes.filter((t) => !arrivedTypes.has(t));
  return { allArrived: missing.length === 0, missing };
}

/* ============================================================
 * ⭐ 补缴明细统计（流程图：「咨询老师统计补缴金额和类型」）
 *
 * 背景（对应流程图「是否一次性付清学费 → 否」这条分支）：
 *   学生试学后决定转正式，但不是所有费用都一次交清。
 *   咨询老师需要先知道「还差多少、差哪几项、各项现在什么状态」，
 *   才能勾选本次要缴哪几笔，逐笔走财务。
 *
 * 数据来源：
 *   · 应缴金额 —— 调财务费用标准（规则2，不自己算）
 *   · 已缴状态 —— 以财务侧 payStatus 为准（syncFromFinance 已回写过）
 *
 * ⚠️ 为什么每个类型只看「最新一笔」？
 *    同一类型可能被驳回后重发，历史单会留痕。
 *    判断缺口应以最新一张单的状态为准，否则「已驳回的旧单」会误算成未发起。
 * ============================================================ */
export async function getSupplementPlan(
  consultStudentId: string,
  fullFeeTypes: FeeType[] = FULL_FEE_TYPES,
): Promise<ConsultSupplementPlan> {
  const stu = await findStudent(consultStudentId);
  if (!stu) throw new BizError(BizCode.STUDENT_NOT_FOUND, '学生不存在');

  const deptCode: DeptCode = stu.dept_code || DeptCode.JUNIOR_SENIOR;

  // ---- 1. 取全部应缴类型的最新一张单 ----
  //
  // ⚠️ 这里【不能】过滤 status = NO_VOUCHER（待上传凭证）。
  //    曾经的写法是 .whereNot({ status: CFS.NO_VOUCHER })，本意是「还没传凭证的草稿不算已发起」，
  //    但建单接口 createFees 建出来的单初始状态就是 NO_VOUCHER（财务侧还没有这张单，
  //    要等老师传了截图才会变成 PENDING）。
  //    结果：刚发起过的单在缺口计算里被当成「没发起」→ 同一类型可以被重复建单。
  //    正确做法是【所有在途单都算已发起】，用状态决定它属于「已到账 / 待确认 / 待上传凭证 / 已驳回」。
  const rows: any[] = await db(FEE_ORDER_TABLE)
    .where({ consult_student_id: consultStudentId, is_deleted: false })
    .whereIn('fee_type', fullFeeTypes)
    .orderBy('create_time', 'desc');

  const latestMap = new Map<number, any>();
  for (const r of rows) {
    if (!latestMap.has(r.fee_type)) latestMap.set(r.fee_type, r);
  }

  // ---- 2. 逐类型取财务标准金额 ----
  const items: ConsultSupplementPlan['items'] = [];
  let totalAmount = 0;
  let arrivedAmount = 0;

  for (const feeType of fullFeeTypes) {
    const feeTypeName = nameOf(FEE_TYPE_NAME, feeType);
    const latest = latestMap.get(feeType);

    // ⚠️ 金额一律取财务标准（规则2）；取不到就用该单已落库的金额兜底
    let amount = latest?.amount ?? 0;
    try {
      const std = await financeClient.getStandard(feeType, deptCode);
      amount = std.amount;
    } catch {
      // 财务不可达时用本地快照，不阻断「统计缺口」这个读操作
    }

    let state: ConsultSupplementPlan['items'][number]['state'] = 'NOT_STARTED';
    if (latest) {
      if (latest.status === CFS.ARRIVED) state = 'ARRIVED';
      // ⚠️ NO_VOUCHER 归到 PENDING：
      //    单已建到财务侧、只是还没传截图，语义上就是「在途/待确认」，
      //    不能当成 NOT_STARTED，否则会被判成缺口而重复建单。
      else if (latest.status === CFS.NO_VOUCHER) state = 'PENDING';
      else if (latest.status === CFS.PENDING) state = 'PENDING';
      else if (latest.status === CFS.REJECTED) state = 'REJECTED';
    }

    totalAmount += amount;
    if (state === 'ARRIVED') arrivedAmount += amount;

    items.push({
      feeType,
      feeTypeName,
      amount,
      state,
      stateName: SUPPLEMENT_STATE_NAME[state],
    });
  }

  /*
   * ⚠️ 什么算「缺口」（可以再次发起）？
   *    · NOT_STARTED → 从没发起过            → 是缺口
   *    · REJECTED    → 被财务打回，需重新提交 → 是缺口
   *    · PENDING     → 在途（含待上传凭证）   → 【不是】缺口，禁止重复建单
   *    · ARRIVED     → 已到账                 → 不是缺口
   */
  const arrivedCount = items.filter((i) => i.state === 'ARRIVED').length;
  const inFlight = items.filter((i) => i.state === 'PENDING');
  const missing = items
    .filter((i) => i.state === 'NOT_STARTED' || i.state === 'REJECTED')
    .map((i) => i.feeType);
  const missingAmount = items
    .filter((i) => i.state === 'NOT_STARTED' || i.state === 'REJECTED')
    .reduce((a, b) => a + b.amount, 0);
  /** 在途金额（已发起、等财务确认），前端可提示「另有 X 元在途」 */
  const inFlightAmount = inFlight.reduce((a, b) => a + b.amount, 0);

  return {
    consultStudentId,
    totalAmount,
    items,
    missing,
    missingAmount,
    arrivedAmount,
    inFlightAmount,
    // 「全款到齐」= 每一类都已到账（在途不算，否则会在还没到账时就禁止补缴）
    allArrived: arrivedCount === items.length,
    isPartial: arrivedAmount > 0 && (missing.length > 0 || inFlight.length > 0),
  };
}
