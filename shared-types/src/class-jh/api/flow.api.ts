/**
 * 接口契约：流程管理（休学/复学/转班/换人/退学/就业协议/末班）
 *
 * 路径前缀：/api/class/flow、/api/class/repeat
 */

import { ApiResponse, PageResponse } from '../common';
import { FlowApply, FlowLog, RepeatRecord } from '../class';
import { FlowType } from '../enums';

/* ---------------- 流程列表 / 详情 ---------------- */

/** 流程列表查询参数 */
export interface FlowListQuery {
  page?: number;
  size?: number;
  flowType?: FlowType;
  flowStatus?: number;
  classId?: string;
  applyUserId?: string;
  startDate?: string;
  endDate?: string;
  keyword?: string;
}

/** 流程列表响应 */
export type FlowListResponse = PageResponse<FlowApply>;

/** 流程详情（含审批日志） */
export interface FlowDetail extends FlowApply {
  logs: FlowLog[];
}

/** 流程详情响应 */
export type FlowDetailResponse = ApiResponse<FlowDetail>;

/* ---------------- 提交 ---------------- */

/** 流程提交入参（各类型专有字段以可选方式提供） */
export interface FlowSubmitPayload {
  flowType: FlowType;
  studentId?: string;
  studentNo?: string;
  studentName?: string;
  classId?: string;
  applyReason?: string;
  /** 休学 */
  suspendStartDate?: string;
  expectResumeDate?: string;
  suspendReason?: string;
  phone?: string;
  attendedHours?: number;
  idCardNo?: string;
  /** 复学 */
  resumeClassId?: string;
  resumeDate?: string;
  /** 转班 */
  toClassId?: string;
  fromClassId?: string;
  toStage?: number;
  fromStage?: number;
  transferReason?: string;
  /** 退学 → 退费（审批通过后自动生成退费单）★ */
  refundFeeType?: number;
  refundAmount?: number;
  /** 换人 */
  handoverRole?: number;
  toUserId?: string;
  fromUserId?: string;
  handoverReason?: string;
  handoverContent?: string;
  handoverTime?: string;
  arrangeUserId?: string;
  /** 就业协议 */
  agreementStatus?: number;
  signDate?: string;
  agreementFileUrl?: string;
}

/** 流程提交响应 */
export type FlowSubmitResponse = ApiResponse<{ flowId: string }>;

/* ---------------- 审批 / 驳回 ---------------- */

/** 流程审批入参 */
export interface FlowApprovePayload {
  id: string;
  remark?: string;
}

/** 流程审批响应 */
export type FlowApproveResponse = ApiResponse<null>;

/** 流程驳回入参 */
export interface FlowRejectPayload {
  id: string;
  rejectReason: string;
}

/** 流程驳回响应 */
export type FlowRejectResponse = ApiResponse<null>;

/* ---------------- 末班记录 ---------------- */

/** 末班列表查询参数 */
export interface RepeatListQuery {
  page?: number;
  size?: number;
  studentId?: string;
  classId?: string;
  startDate?: string;
  endDate?: string;
}

/** 末班列表响应 */
export type RepeatListResponse = PageResponse<RepeatRecord>;

/** 末班新增入参 */
export interface RepeatAddPayload {
  studentId: string;
  toClassId: string;
  repeatReason: string;
  notifyUserId?: string;
  isNotified?: boolean;
}

/** 末班新增响应（末班改走审批流后，返回流程 ID）★ */
export type RepeatAddResponse = ApiResponse<{ flowId: string }>;
