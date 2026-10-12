/**
 * 退费接口调用（含审批链）
 */

import { http } from './request';
import type {
  PageData,
  RefundApply,
  RefundDetail,
  RefundListQuery,
  RefundEligibleItem,
  RefundSavePayload,
  RefundApprovePayload,
  RefundRejectPayload,
} from 'shared-types/class-jh';

/** 退费列表 */
export function fetchRefundList(query: RefundListQuery): Promise<PageData<RefundApply>> {
  return http.get<PageData<RefundApply>>('/api/class-jh/refund/list', query);
}

/** 退费详情（含审批日志） */
export function fetchRefundDetail(id: string): Promise<RefundDetail> {
  return http.get<RefundDetail>('/api/class-jh/refund/detail', { id });
}

/** 可选学生（退学且费用未用完） */
export function fetchRefundEligible(keyword?: string): Promise<RefundEligibleItem[]> {
  return http.get<RefundEligibleItem[]>('/api/class-jh/refund/eligible', { keyword });
}

/** 新增退费 */
export function addRefund(payload: RefundSavePayload): Promise<{ id: string }> {
  return http.post<{ id: string }>('/api/class-jh/refund/add', payload);
}

/** 修改退费（仅待提交） */
export function updateRefund(payload: RefundSavePayload & { id: string }): Promise<null> {
  return http.put<null>('/api/class-jh/refund/update', payload);
}

/** 提交退费（1→2） */
export function submitRefund(id: string): Promise<null> {
  return http.post<null>('/api/class-jh/refund/submit', { id });
}

/** 退费审批（按当前状态推进） */
export function approveRefund(payload: RefundApprovePayload): Promise<{ refundStatus: number }> {
  return http.post<{ refundStatus: number }>('/api/class-jh/refund/approve', payload);
}

/** 退费驳回（→7） */
export function rejectRefund(payload: RefundRejectPayload): Promise<null> {
  return http.post<null>('/api/class-jh/refund/reject', payload);
}

/** 退费导出 */
export function exportRefund(query: RefundListQuery): Promise<RefundApply[]> {
  return http.get<RefundApply[]>('/api/class-jh/refund/export', query);
}
