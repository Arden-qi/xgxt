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

/** 催费推送（生成可复制文案） */
export function shareFee(payload: FeeSharePayload): Promise<FeeShareData> {
  return http.post<FeeShareData>('/api/class-jh/fee/share', payload);
}

/** 催费记录列表 */
export function fetchFeeNotifyList(query: FeeNotifyListQuery): Promise<PageData<FeeNotify>> {
  return http.get<PageData<FeeNotify>>('/api/class-jh/fee/notify/list', query);
}
