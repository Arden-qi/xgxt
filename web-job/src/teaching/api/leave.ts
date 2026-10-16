/**
 * 统一学籍异动审批接口（第 2 期 · 第 5 个域）· 前端封装
 * ============================================================
 * ★ 审批链统一采用「实训那一套」：
 *    休学 1 步（学管）· 复学 1 步（学管）· 退学 2 步（学管 → 校长）
 * ★ 业务类型：1 休学 · 2 退学 · 3 复学
 * ⚠️ 大学**没有「复学」**（业务事实，见 `/meta` 的 stageBizTypes）
 */

import { http } from '@/api/request';
import type { TeachingStage } from './attendance';

export type { TeachingStage };

export const STAGE_NAME: Record<TeachingStage, string> = {
  jh: '初高部',
  class: '大学部',
  job: '实训',
};

/** 统一业务类型 */
export const LEAVE_BIZ_NAME: Record<number, string> = {
  1: '休学',
  2: '退学',
  3: '复学',
};

/** 统一状态码（= 实训那套 ApprovalStatus） */
export const LEAVE_STATUS = {
  DRAFT: 1,
  PENDING_MANAGER: 2,
  PENDING_PRINCIPAL: 3,
  APPROVED: 4,
  REJECTED: 5,
  CANCELED: 6,
} as const;

export const LEAVE_STATUS_NAME: Record<number, string> = {
  1: '待提交',
  2: '待学管审批',
  3: '待校长审批',
  4: '已通过',
  5: '已驳回',
  6: '已撤销',
};

export const LEAVE_STATUS_TAG: Record<number, string> = {
  1: 'info',
  2: 'warning',
  3: 'warning',
  4: 'success',
  5: 'danger',
  6: 'info',
};

/** 各类型走几步（用于页面提示"本次走几步"） */
export const LEAVE_CHAIN_STEPS: Record<number, number> = { 1: 1, 2: 2, 3: 1 };

/** 各学段支持的类型（默认值；实际以后端 /meta 为准） */
export const LEAVE_STAGE_BIZ_DEFAULT: Record<TeachingStage, number[]> = {
  jh: [1, 2, 3],
  class: [1, 2],
  job: [1, 2, 3],
};

export interface LeaveRow {
  stage: TeachingStage;
  stageName: string;
  id: string;
  bizType: number;
  bizTypeName: string;
  studentId: string;
  studentNo: string;
  studentName: string;
  gender: string | null;
  idCard: string | null;
  phone: string | null;
  parentPhone: string | null;
  classId: string | null;
  className: string | null;
  deptName: string | null;
  headTeacherName: string | null;
  leaveDate: string | null;
  expectResumeDate: string | null;
  newClassId: string | null;
  newClassName: string | null;
  leaveReason: string;
  attendedHours: number | null;
  relatedRefundNo: string | null;
  approvalStatus: number;
  approvalStatusName: string;
  currentHandlerHint: string | null;
  createTime: string | null;
  canApprove: boolean;
  canCancel: boolean;
  canSubmit: boolean;
}

export interface LeaveLogRow {
  step: number;
  nodeName: string;
  operatorName: string;
  actionName: string;
  comment: string | null;
  time: string | null;
}

export interface LeaveDetail {
  record: LeaveRow;
  logs: LeaveLogRow[];
}

export interface LeaveSummary {
  stage: TeachingStage;
  stageName: string;
  total: number;
  suspendCount: number;
  quitCount: number;
  resumeCount: number;
  pendingCount: number;
  approvedCount: number;
}

export interface StudentOption {
  id: string;
  no: string;
  name: string;
  classId: string | null;
  className: string | null;
}

export interface LeaveMeta {
  bizTypes: Array<{ value: number; label: string; steps: number }>;
  statuses: Array<{ value: number; label: string }>;
  stageBizTypes: Record<string, number[]>;
}

export function listLeaves(p: {
  stage?: TeachingStage;
  page?: number;
  size?: number;
  keyword?: string;
  classId?: string;
  bizType?: number;
  status?: number;
  onlyMine?: boolean;
  startDate?: string;
  endDate?: string;
}) {
  return http.get<{ total: number; page: number; size: number; list: LeaveRow[] }>(
    '/api/teaching/leave/list',
    p,
  );
}

export function getLeaveDetail(id: string) {
  return http.get<LeaveDetail>('/api/teaching/leave/detail', { id });
}

export function listStudentOptions(stage: TeachingStage, keyword?: string) {
  return http.get<StudentOption[]>('/api/teaching/leave/student-options', { stage, keyword });
}

export function listClasses() {
  return http.get<Array<{ stage: TeachingStage; stageName: string; id: string; name: string }>>(
    '/api/teaching/leave/classes',
  );
}

export function getLeaveSummary() {
  return http.get<LeaveSummary[]>('/api/teaching/leave/summary');
}

export function getLeaveMeta() {
  return http.get<LeaveMeta>('/api/teaching/leave/meta');
}

export function createLeave(body: {
  stage: TeachingStage;
  studentId: string;
  bizType: number;
  leaveDate?: string;
  expectResumeDate?: string;
  newClassId?: string;
  leaveReason: string;
  remark?: string | null;
  submit?: boolean;
}) {
  return http.post<{ id: string }>('/api/teaching/leave/create', body);
}

export function submitLeave(stage: TeachingStage, id: string) {
  return http.post<{ approvalStatus: number; approvalStatusName: string }>(
    '/api/teaching/leave/submit',
    { stage, id },
  );
}

/** ★ 复学在终审通过时要带 `newClassId`（复学班） */
export function approveLeave(
  stage: TeachingStage,
  id: string,
  body: { comment?: string; newClassId?: string } = {},
) {
  return http.post<{ finished: boolean; approvalStatus: number; approvalStatusName: string }>(
    '/api/teaching/leave/approve',
    { stage, id, ...body },
  );
}

export function rejectLeave(stage: TeachingStage, id: string, reason: string) {
  return http.post<{ approvalStatus: number; approvalStatusName: string }>(
    '/api/teaching/leave/reject',
    { stage, id, reason },
  );
}

export function cancelLeave(stage: TeachingStage, id: string, reason?: string) {
  return http.post<{ approvalStatus: number; approvalStatusName: string }>(
    '/api/teaching/leave/cancel',
    { stage, id, reason },
  );
}
