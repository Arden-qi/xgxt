import { get, post } from './request';
import type {
  ApprovalLogRow,
  NotifyRow,
  PageData,
  RefundRow,
  SuspendDetail,
  SuspendRow,
  TodoRow,
  UpgradeRow,
} from './types';

/* ============================ 休学 / 退学 ============================ */

export interface SuspendQuery {
  page?: number;
  size?: number;
  /** 1 休学 2 退学 */
  applyType?: number;
  applyStatus?: number;
  classId?: string;
  studentNo?: string;
  studentName?: string;
  keyword?: string;
  onlyMine?: boolean;
  onlyTodo?: boolean;
}

export function suspendList(params: SuspendQuery = {}) {
  return get<PageData<SuspendRow>>('/api/class/suspend/list', params as Record<string, unknown>);
}

export function suspendDetail(id: string) {
  return get<SuspendDetail>('/api/class/suspend/detail', { id });
}

export function suspendAdd(payload: {
  applyType: number;
  studentId: string;
  applyReason: string;
  effectDate?: string | null;
  expectResumeDate?: string | null;
  occurredAmount?: number | null;
  refundableAmount?: number | null;
}) {
  return post<{ applyId: string; applyNo: string; applyStatus: number }>('/api/class/suspend/add', payload);
}

export function suspendApprove(payload: { bizId: string; action: 'approve' | 'reject'; opinion?: string }) {
  return post<{ bizId: string; applyStatus: number; applyStatusName: string }>('/api/class/suspend/approve', payload);
}

export function suspendWithdraw(bizId: string) {
  return post<{ bizId: string }>('/api/class/suspend/withdraw', { bizId });
}

/* ============================ 退费 ============================ */

export interface RefundQuery {
  page?: number;
  size?: number;
  refundStatus?: number;
  classId?: string;
  keyword?: string;
  onlyMine?: boolean;
  onlyTodo?: boolean;
}

export function refundList(params: RefundQuery = {}) {
  return get<PageData<RefundRow>>('/api/class/refund/list', params as Record<string, unknown>);
}

export function refundDetail(id: string) {
  return get<{ apply: RefundRow; logs: ApprovalLogRow[] }>('/api/class/refund/detail', { id });
}

/**
 * 提交退费申请
 *
 * 后端要求 `refundAmount`（分）**必须等于** refundItems 各项之和，不等会直接报
 * 「退费总额与各项目之和不一致」——所以前端在提交前先自己校验一遍，
 * 别把这种低级错误丢给后端去拦。
 * 金额一律用「分」传输（列表回显另有 xxxYuan 字符串字段可直接展示）。
 */
export function refundAdd(payload: {
  studentId: string;
  refundItems: Array<{ feeType: number; amount: number }>;
  refundAmount: number;
  refundReason: string;
  /** 申请时间（YYYY-MM-DD，选填；不传由后端取当前时间） */
  applyTime?: string | null;
}) {
  return post<{ applyId: string; applyNo: string; refundStatus: number }>('/api/class/refund/add', payload);
}

export function refundApprove(payload: { bizId: string; action: 'approve' | 'reject'; opinion?: string }) {
  return post<{ bizId: string; refundStatus: number; refundStatusName: string }>('/api/class/refund/approve', payload);
}

/**
 * 撤回退费申请（申请人本人，进入审批前）
 *
 * 只有班主任本人发起的、仍处于「待经理审批」的申请可以撤回；撤回后状态为「已撤回」，
 * 不再进入审批链。已流转的申请不能撤回，只能由当前节点驳回。
 */
export function refundWithdraw(payload: { bizId: string; reason?: string }) {
  return post<{ bizId: string; refundStatus: number; refundStatusName: string }>('/api/class/refund/withdraw', payload);
}

/* ============================ 升学 ============================ */

export function upgradeList(
  params: {
    page?: number;
    size?: number;
    applyStatus?: number;
    toDeptCode?: number;
    toStage?: number;
    fromClassId?: string;
    keyword?: string;
    onlyMine?: boolean;
  } = {},
) {
  return get<PageData<UpgradeRow>>('/api/class/upgrade/list', params as Record<string, unknown>);
}

export function upgradeDetail(id: string) {
  return get<{ apply: UpgradeRow; logs: ApprovalLogRow[]; gradeSnapshot: unknown }>('/api/class/upgrade/detail', {
    id,
  });
}

export function upgradeAdd(payload: {
  studentId: string;
  toDeptCode: number;
  toStage: number;
  toClassId?: string | null;
  examScore?: number | null;
}) {
  return post<{ applyId: string; applyNo: string; applyStatus: number }>('/api/class/upgrade/add', payload);
}

/** 学管接收升学（学生 stage / 班级随之更新，升学成绩随档案保存） */
export function upgradeReceive(payload: { bizId: string; toClassId?: string | null; opinion?: string }) {
  return post<{ bizId: string; applyStatus: number }>('/api/class/upgrade/receive', payload);
}

export function upgradeReject(payload: { bizId: string; opinion: string }) {
  return post<{ bizId: string; applyStatus: number }>('/api/class/upgrade/reject', payload);
}

/* ============================ 审批中心 ============================ */

export function todoList(params: { page?: number; size?: number; applyType?: number } = {}) {
  return get<PageData<TodoRow>>('/api/class/approval/todo/list', params as Record<string, unknown>);
}

export function approvalLogList(params: { page?: number; size?: number; bizId?: string; applyType?: number }) {
  return get<PageData<ApprovalLogRow>>('/api/class/approval/log/list', params as Record<string, unknown>);
}

/** 审批人映射表：状态 → 处理人角色中文（前端据此决定「我现在能不能审」） */
export function handlerMap() {
  return get<{ suspend: Record<string, string>; refund: Record<string, string> }>(
    '/api/class/approval/handler/map',
  );
}

/* ============================ 站内通知 ============================ */

export function notifyList(params: { page?: number; size?: number; onlyUnread?: boolean } = {}) {
  return get<PageData<NotifyRow>>('/api/class/notify/list', params as Record<string, unknown>);
}

export function notifyUnread() {
  return get<{ total: number; byType: Array<{ applyType: number; applyTypeName?: string; count: number }> }>(
    '/api/class/notify/unread',
  );
}

export function notifyRead(payload: { id?: string; ids?: string[] } = {}) {
  return post<{ affected: number }>('/api/class/notify/read', payload);
}

export function notifyDetail(id: string) {
  return get<NotifyRow>('/api/class/notify/detail', { id });
}
