/**
 * 接口契约：退费（审批链）
 *
 * 路径前缀：/api/class/refund
 */

import { ApiResponse, PageResponse } from '../common';
import { RefundApply, RefundLog } from '../class';
import { FeeType, RefundStatus } from '../enums';

/* ---------------- 退费列表 / 详情 ---------------- */

/** 退费列表查询参数 */
export interface RefundListQuery {
  page?: number;
  size?: number;
  refundStatus?: RefundStatus;
  classId?: string;
  feeType?: FeeType;
  startDate?: string;
  endDate?: string;
  keyword?: string;
}

/** 退费列表响应 */
export type RefundListResponse = PageResponse<RefundApply>;

/** 退费详情（含审批日志） */
export interface RefundDetail extends RefundApply {
  logs: RefundLog[];
}

/** 退费详情响应 */
export type RefundDetailResponse = ApiResponse<RefundDetail>;

/* ---------------- 可选学生 ---------------- */

/** 可选学生项（退学且费用未用完） */
export interface RefundEligibleItem {
  studentId: string;
  studentNo: string;
  studentName: string;
  className?: string;
}

/** 可选学生响应 */
export type RefundEligibleResponse = ApiResponse<RefundEligibleItem[]>;

/* ---------------- 新增 / 修改 / 提交 ---------------- */

/** 退费新增入参 */
export interface RefundSavePayload {
  studentId: string;
  feeType: FeeType;
  refundAmount: number;
  refundReason: string;
  applyDate: string;
  headTeacherOpinion?: string;
  isFeeUsedUp?: boolean;
}

/** 退费新增响应 */
export type RefundAddResponse = ApiResponse<{ id: string }>;

/** 退费修改入参 */
export type RefundUpdatePayload = RefundSavePayload & { id: string };

/** 退费修改响应 */
export type RefundUpdateResponse = ApiResponse<null>;

/** 退费提交响应 */
export type RefundSubmitResponse = ApiResponse<null>;

/* ---------------- 审批 / 驳回 ---------------- */

/** 退费审批入参（按当前状态推进） */
export interface RefundApprovePayload {
  id: string;
  remark?: string;
}

/** 退费审批响应（返回推进后的状态） */
export type RefundApproveResponse = ApiResponse<{ refundStatus: RefundStatus }>;

/** 退费驳回入参 */
export interface RefundRejectPayload {
  id: string;
  rejectReason: string;
}

/** 退费驳回响应 */
export type RefundRejectResponse = ApiResponse<null>;

/* ---------------- 导出 ---------------- */

/** 退费导出响应 */
export type RefundExportResponse = ApiResponse<RefundApply[]>;
