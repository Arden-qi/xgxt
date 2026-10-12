/**
 * 流程管理接口调用（休学/复学/转班/换人/退学/就业协议/末班）
 */

import { http } from './request';
import type {
  PageData,
  FlowApply,
  FlowDetail,
  FlowListQuery,
  FlowSubmitPayload,
  FlowApprovePayload,
  FlowRejectPayload,
  RepeatRecord,
  RepeatListQuery,
  RepeatAddPayload,
} from 'shared-types/class-jh';

/* ---------------- 流程 ---------------- */

/** 流程列表 */
export function fetchFlowList(query: FlowListQuery): Promise<PageData<FlowApply>> {
  return http.get<PageData<FlowApply>>('/api/class-jh/flow/list', query);
}

/** 流程详情（含审批日志） */
export function fetchFlowDetail(id: string): Promise<FlowDetail> {
  return http.get<FlowDetail>('/api/class-jh/flow/detail', { id });
}

/** 流程提交（新建或推进已有） */
export function submitFlow(payload: FlowSubmitPayload): Promise<{ flowId: string }> {
  return http.post<{ flowId: string }>('/api/class-jh/flow/submit', payload);
}

/** 流程审批 */
export function approveFlow(payload: FlowApprovePayload): Promise<null> {
  return http.post<null>('/api/class-jh/flow/approve', payload);
}

/** 流程驳回 */
export function rejectFlow(payload: FlowRejectPayload): Promise<null> {
  return http.post<null>('/api/class-jh/flow/reject', payload);
}

/* ---------------- 末班 ---------------- */

/** 末班列表 */
export function fetchRepeatList(query: RepeatListQuery): Promise<PageData<RepeatRecord>> {
  return http.get<PageData<RepeatRecord>>('/api/class-jh/repeat/list', query);
}

/** 末班新增（直接生效） */
export function addRepeat(payload: RepeatAddPayload): Promise<{ repeatId: string }> {
  return http.post<{ repeatId: string }>('/api/class-jh/repeat/add', payload);
}
