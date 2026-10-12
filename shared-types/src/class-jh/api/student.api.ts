/**
 * 接口契约：学生主档（教学管理初高）
 *
 * 路径前缀：GET/POST/PUT /api/class/student/*
 */

import { ApiResponse, PageResponse } from '../common';
import {
  Student,
  StudentListItem,
  StudentSavePayload,
} from '../student';

/* ============================================================
 * 接口 1：查询学生列表
 * 路径：GET /api/class/student/list
 * ============================================================ */

/** 学生列表查询参数 */
export interface StudentListQuery {
  page?: number;
  size?: number;
  keyword?: string;
  classId?: string;
  stage?: number;
  studentStatus?: number;
  deptCode?: number;
}

/** 学生列表响应 */
export type StudentListResponse = PageResponse<StudentListItem>;

/* ============================================================
 * 接口 2：查询学生详情（含 7 页签数据）
 * 路径：GET /api/class/student/detail?id=xxx
 * ============================================================ */

/**
 * 缴费情况一行（★ 2026-10-06：与财务管理·缴费管理同步后的统一口径）
 *
 * 字段与主工程 `server-job/src/utils/financeFeeRef.ts` 的 StudentFeeRecord 一一对应，
 * 初高 / 大学部 / 实训三处详情展示同一套字段。
 */
export interface StudentFeeRecord {
  feeId: string;
  studentNo: string;
  studentName: string;
  classId?: string | null;
  className?: string | null;
  /** 部门 1 二三期（初高部） / 2 大学部 */
  deptCode?: number | null;
  deptName: string;
  feeType: number;
  feeTypeName: string;
  /** 费用周期（财务侧 period，如 2026-09） */
  period?: string | null;
  /** 应缴（分） */
  amount: number;
  /** 已缴（分） */
  paidAmount: number;
  amountYuan: string;
  paidAmountYuan: string;
  unpaidAmountYuan: string;
  payStatus: number;
  payStatusName: string;
  payDate?: string | null;
  expireDate?: string | null;
  payMethod?: string | null;
  voucherUrl?: string | null;
}

/** 缴费情况的数据来源标记（实时财务 / 兜底副本） */
export interface StudentFeeMeta {
  /** finance = 实时取自财务管理；mirror = 财务取不到，走本模块台账兜底 */
  source: 'finance' | 'mirror';
  mirrorFrom?: string | null;
  /** true = 页面应提示「可能不是最新」 */
  degraded: boolean;
  message?: string | null;
  summary: {
    totalAmount: number;
    totalPaid: number;
    totalUnpaid: number;
    totalAmountYuan: string;
    totalPaidYuan: string;
    totalUnpaidYuan: string;
  };
}

/** 学生详情（7 页签：base/net/fee/dorm/exam/mkt/cls） */
export interface StudentDetail extends Student {
  /** 基础信息（含冗余展示字段） */
  base: Record<string, any>;
  /** 校园网信息 */
  net: Record<string, any>;
  /** 缴费情况（来自财务管理，实时为主 + 台账兜底） */
  fee: StudentFeeRecord[];
  /** 缴费情况的数据来源与汇总 */
  feeMeta?: StudentFeeMeta;
  /** 宿舍信息 */
  dorm: Record<string, any>;
  /** 考试成绩 */
  exam: any[];
  /** 市场咨询信息（招生/咨询老师） */
  mkt: Record<string, any>;
  /** 班级流程 / 末班记录 */
  cls: Record<string, any>;
}

/** 学生详情响应 */
export type StudentDetailResponse = ApiResponse<StudentDetail>;

/* ============================================================
 * 接口 3：新增学生
 * 路径：POST /api/class/student/add
 * ============================================================ */

/** 新增响应 */
export type StudentAddResponse = ApiResponse<{ id: string }>;

/* ============================================================
 * 接口 4：修改学生
 * 路径：PUT /api/class/student/update
 * ============================================================ */

/** 修改学生入参 = 白名单字段 + id */
export type StudentUpdatePayload = StudentSavePayload & { id: string };

/** 修改响应 */
export type StudentUpdateResponse = ApiResponse<null>;

/* ============================================================
 * 接口 5：删除学生（逻辑删除）
 * 路径：DELETE /api/class/student/delete/:id
 * ============================================================ */

/** 删除响应 */
export type StudentDeleteResponse = ApiResponse<null>;

/* ============================================================
 * 接口 6：导出学生（不分页，前端转 CSV）
 * 路径：GET /api/class/student/export
 * ============================================================ */

/** 导出响应 */
export type StudentExportResponse = ApiResponse<StudentListItem[]>;

/* ============================================================
 * 接口 7：学生流程入口（休/复/退/末班/转班）
 * 路径：POST /api/class/student/{suspend|resume|quit|repeat|transfer}
 * ============================================================ */

/** 休学入参 */
export interface StudentSuspendPayload {
  studentId: string;
  suspendStartDate: string;
  expectResumeDate?: string;
  suspendReason: string;
  phone?: string;
  attendedHours?: number;
}

/** 复学入参 */
export interface StudentResumePayload {
  studentId: string;
  resumeClassId: string;
  resumeDate: string;
  applyReason?: string;
}

/** 退学入参 */
export interface StudentQuitPayload {
  studentId: string;
  applyDate?: string;
  suspendReason: string;
  attendedHours?: number;
  /** 退费类型 1学费 2住宿费 3餐费 4保险费（审批通过后据此自动生成退费单） ★ */
  refundFeeType: number;
  /** 退费金额（整数，单位「分」）★ */
  refundAmount: number;
}

/** 末班入参 */
export interface StudentRepeatPayload {
  studentId: string;
  toClassId: string;
  repeatReason: string;
  notifyUserId?: string;
  isNotified?: boolean;
}

/** 转班入参 */
export interface StudentTransferPayload {
  studentId: string;
  toClassId: string;
  toStage?: number;
  transferReason?: string;
}

/** 流程提交响应（返回流程/末班记录 ID） */
export type StudentFlowSubmitResponse = ApiResponse<{ flowId?: string; repeatId?: string }>;
