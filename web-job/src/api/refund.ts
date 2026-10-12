/**
 * 退费模块 接口调用（就业管理 > 实训阶段）
 *
 * ⚠️ 路径与后端 /api/job/refund 完全一致
 * ⚠️ 返回类型从 shared-types 引，字段写错会编译报错
 *
 * 【页面共用说明】
 *   本页面是【班主任 / 学管 / 校长】三人共用：
 *     班主任 → 只能新建 + 撤回（看不到审批按钮）
 *     学管   → 只能审批第 1 步
 *     校长   → 只能审批第 2 步
 *   按钮显隐由后端返回的 canApprove / canCancel 控制，前端不自己判断角色。
 */

import { http } from './request';
import type {
  PageData,
  RefundListItem,
  RefundDetail,
  RefundQuery,
  RefundPayload,
  ApprovalActionPayload,
} from 'shared-types';

/** 退费列表 */
export function fetchRefundList(query: RefundQuery): Promise<PageData<RefundListItem>> {
  return http.get<PageData<RefundListItem>>('/api/job/refund/page', query);
}

/** 退费详情（含审批轨迹 + 流程条） */
export function fetchRefundDetail(id: string): Promise<RefundDetail> {
  return http.get<RefundDetail>('/api/job/refund/detail', { id });
}

/** 新建退费申请（可同时提交） */
export function createRefund(
  payload: RefundPayload & { submit?: boolean },
): Promise<{ id: string }> {
  return http.post<{ id: string }>('/api/job/refund/create', payload);
}

/** 提交审批 */
/**
 * 提交审批（待提交 → 待学管审批）
 *
 * @param refundAmount 可选，单位「分」—— 普通单的总金额
 *   ★ 班级结业自动生成的住宿费退费单：生成时是 0，班主任填完再提交。
 * @param detail 可选，「退学退费」合并单的三项明细（单位：分）
 *   ★ 退学审批通过后自动生成，同时含学费 + 住宿费 + 餐费，
 *     班主任分别填写，**总金额由后端求和**。
 */
export function submitRefund(
  id: string,
  refundAmount?: number,
  detail?: { tuitionAmount?: number; accommodationAmount?: number; mealAmount?: number },
): Promise<null> {
  return http.post<null>('/api/job/refund/submit', { id, refundAmount, ...(detail || {}) });
}

/** 同意（学管 / 校长） */
export function approveRefund(
  id: string,
  payload?: ApprovalActionPayload,
): Promise<{ finished: boolean; approvalStatus: number; approvalStatusName: string }> {
  return http.post('/api/job/refund/approve', { id, comment: payload?.comment });
}

/** 驳回（学管 / 校长） */
export function rejectRefund(id: string, reason: string): Promise<null> {
  return http.post<null>('/api/job/refund/reject', { id, reason });
}

/** 撤回（申请人本人） */
export function cancelRefund(id: string, reason?: string): Promise<null> {
  return http.post<null>('/api/job/refund/cancel', { id, reason });
}

/** 财务确认出款 */
export function financeConfirmRefund(
  id: string,
  payload: { financeRemark?: string; refundTime?: string },
): Promise<null> {
  return http.post<null>('/api/job/refund/finance-confirm', { id, ...payload });
}

/** 可选学生（班主任选人下拉） */
export interface RefundStudentOption {
  studentId: string;
  studentNo: string;
  studentName: string;
  className: string | null;
  deptCode: number | null;
  deptName: string | null;
  headTeacherId: string | null;
  headTeacherName: string | null;
}
export function fetchRefundStudentOptions(params: {
  keyword?: string;
  limit?: number;
}): Promise<RefundStudentOption[]> {
  return http.get<RefundStudentOption[]>('/api/job/refund/student-options', params);
}

/** 统计卡片 */
export interface RefundSummary {
  total: number;
  pendingMgr: number;
  pendingPrincipal: number;
  approved: number;
  approvedAmount: number;
  approvedAmountText: string;
  myPending: number;
}
export function fetchRefundSummary(): Promise<RefundSummary> {
  return http.get<RefundSummary>('/api/job/refund/summary');
}
