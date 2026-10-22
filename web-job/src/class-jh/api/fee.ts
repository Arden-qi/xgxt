/**
 * 催费管理接口调用
 */

import { http } from './request';
import type {
  PageData,
  FeeRecord,
  FeeListQuery,
  FeeSharePayload,
  FeeShareData,
  FeeNotify,
  FeeNotifyListQuery,
  FeePaymentPayload,
  FeePaymentResult,
  FeeTransferResult,
} from 'shared-types/class-jh';

/**
 * 催费列表（含 remainDays/isUrgent）
 *
 * ★ 2026-10-20：后端只返回「到期日距今 ≤ 催费窗口天数」的单，
 *   并把 windowDays 一起带回来（urgeWindowDays），用于界面上说明「为什么比台账少」。
 */
export type FeeListPage = PageData<FeeRecord> & { urgeWindowDays?: number };

export function fetchFeeList(query: FeeListQuery): Promise<FeeListPage> {
  return http.get<FeeListPage>('/api/class-jh/fee/list', query);
}

/** 催费导出 */
export function exportFee(query: FeeListQuery): Promise<FeeRecord[]> {
  return http.get<FeeRecord[]>('/api/class-jh/fee/export', query);
}

/**
 * 登记缴费（上传缴费凭证）
 *
 * ★ 2026-10-20 用户要求：操作列「上传缴费凭证」——
 *   缴费方式（微信支付/支付宝/现金）+ 缴费金额 + 缴费时间（默认当天、不能选未来）+ 备注 + 截图。
 *   截图在前端读成 dataURL 一起提交，后端落盘 uploads/voucher 后返回相对地址。
 */
export function submitFeePayment(payload: FeePaymentPayload): Promise<FeePaymentResult> {
  return http.post<FeePaymentResult>('/api/class-jh/fee/voucher', payload);
}

/**
 * 批量转交财务 · 候选列表（★ 2026-10-20）
 *
 * 返回「已登记缴费」的初高台账行（最多 500 条），带 transferred 标记
 * —— 弹窗里的「只选未上传过」就是挑 transferred !== true 的那些。
 */
export function fetchTransferCandidates(): Promise<FeeRecord[]> {
  return http.get<FeeRecord[]>('/api/class-jh/fee/transfer/candidates');
}

/** 批量转交财务：把勾选的缴费单在财务缴费管理里生成对应单据 */
export function transferFees(feeIds: string[]): Promise<FeeTransferResult> {
  return http.post<FeeTransferResult>('/api/class-jh/fee/transfer', { feeIds });
}

/* ============================================================
 * 批量上传到财务 · 三部门统一版（★ 2026-10-22）
 * ============================================================
 * 【为什么要新接口】
 *   上面那两个只服务初高：后端候选只读 `sms_class_jh.t_class_fee`，
 *   提交里还硬判断 dept_code=1，前端按钮也只在 初高/全部部门 时显示。
 *   用户 2026-10-22 要求大学部和就业部也能转交，所以后端新开了
 *   `/api/teaching/fee/transfer*`（三部门各自读自己的催费表）。
 *
 * ⚠️ 老接口保留不动（初高仍可回退），下面这两个是页面实际调用的。
 * ============================================================ */

/** 转交候选行的部门码 */
export type TransferDept = 'jh' | 'class' | 'employ';

export interface TransferCandidate {
  /** 原始催费单 id（不带 urge:/call: 前缀，前缀只有列表接口才用） */
  feeId: string;
  dept: TransferDept;
  deptName: string;
  studentNo: string;
  studentName: string;
  className: string;
  feeType: number | null;
  /** 应缴金额（分） */
  feeAmount: number;
  /** 实缴金额（分） */
  paidAmount: number | null;
  payMethod: number | null;
  payMethodName: string;
  payDate: string | null;
  expireDate: string | null;
  voucherUrl: string | null;
  payRemark: string | null;
  transferred: boolean;
  /** 已转交时：财务侧缴费单 id */
  financeFeeId: string;
}

export interface TransferCandidateResult {
  list: TransferCandidate[];
  /** 某个部门查询失败（无权限等）的原因 —— 不静默，弹窗里要提示 */
  errors: Array<{ dept: TransferDept; deptName: string; message: string }>;
  /**
   * 每个部门的取样统计（★ 2026-10-22 新增，★ 2026-10-23 加 transferred）
   *
   * `scanned` = 该部门未删除的单据总数；`paid` = 其中已登记缴费的条数；
   * `transferred` = 其中已经上传过财务的条数；`picked` = 本次返回（待上传）的条数。
   * 弹窗里显示「初高：共 12 单，已登记缴费 3 单（已上传 2 / 待上传 1）」——
   * 否则「弹窗只剩 1 条」永远分不清是「没单」「没登记缴费」还是「都上传过了」。
   */
  stats?: Array<{
    dept: TransferDept;
    deptName: string;
    scanned: number;
    paid: number;
    /** 已上传过财务的条数（不包含在 list 里） */
    transferred: number;
    picked: number;
    error?: string;
  }>;
}

/**
 * 拉转交候选：`dept` 传 all 就是三个部门一起取
 *
 * ★ 2026-10-23 用户要求「列表只显示没有上传过的内容」：
 *   接口已过滤掉 `finance_fee_id` 非空（= 已转交）的行，
 *   `list` 里每一条都是可转交的，前端不需要再自己筛。
 */
export function fetchTransferCandidatesAll(dept: TransferDept | 'all'): Promise<TransferCandidateResult> {
  return http.get<TransferCandidateResult>('/api/teaching/fee/transfer/candidates', { dept });
}

/** 提交转交（三部门统一入口） */
export function transferFeesAll(
  items: Array<{ dept: TransferDept; feeId: string }>,
): Promise<FeeTransferResult & { voucherOnly?: number }> {
  return http.post<FeeTransferResult & { voucherOnly?: number }>('/api/teaching/fee/transfer', { items });
}

/** 催费推送（生成可复制文案） */
export function shareFee(payload: FeeSharePayload): Promise<FeeShareData> {
  return http.post<FeeShareData>('/api/class-jh/fee/share', payload);
}

/** 催费记录列表 */
export function fetchFeeNotifyList(query: FeeNotifyListQuery): Promise<PageData<FeeNotify>> {
  return http.get<PageData<FeeNotify>>('/api/class-jh/fee/notify/list', query);
}
