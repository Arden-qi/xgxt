import { get, post } from './request';
import type { ConsultItem, ConsultReceivePayload, ConsultRejectPayload, PageData } from './types';

/** 咨询接口（前缀 /api/class/consult）：待接收学员 */

export function consultList(params: { page?: number; size?: number; applyStatus?: number; keyword?: string }) {
  return get<PageData<ConsultItem>>('/api/class/consult/list', params as Record<string, unknown>);
}

export function consultDetail(id: string) {
  return get<ConsultItem>('/api/class/consult/detail', { id });
}

/** 接收：把咨询学员归入班级（可一并补学号 / 阶段 / 宿舍床位等），返回新建后的 studentId */
export function consultReceive(payload: ConsultReceivePayload) {
  return post<{ studentId: string; studentNo: string }>('/api/class/consult/receive', payload);
}

/** 驳回：rejectReason 必填 */
export function consultReject(payload: ConsultRejectPayload) {
  return post<{ id: string }>('/api/class/consult/reject', payload);
}

/** 推送（演示用，前端可不接界面） */
export function consultPush(payload: { items: unknown[] }) {
  return post<{ pushed: number }>('/api/class/consult/push', payload);
}
