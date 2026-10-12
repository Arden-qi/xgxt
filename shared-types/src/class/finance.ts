import { BaseEntity } from './common';
import { FeeType, OuterSyncStatus, PayStatus, RefundStatus } from './enums';

/**
 * 费用相关
 *
 * 数据来源：
 *  - 缴费信息 **同步自财务管理**（需求三）
 *  - 催费信息 **同步自教务管理**（需求二）
 *  本模块保存只读副本，供学管 / 班主任查看与发起退费。
 */

/** 缴费记录（同步自财务管理，本模块只读） */
export interface FeeRecord extends BaseEntity {
  studentId: string;
  studentNo: string;
  studentName: string;
  classId?: string;
  className?: string;
  feeType: FeeType;
  feeTypeName?: string;
  /** 金额，单位「分」 */
  amount: number;
  /** 实收金额，单位「分」 */
  paidAmount?: number;
  payStatus: PayStatus;
  payStatusName?: string;
  /** 缴费日期 YYYY-MM-DD */
  payDate?: string;
  /** 到期日期 YYYY-MM-DD */
  expireDate?: string;
  /** 缴费凭证 URL */
  voucherUrl?: string;
  /** 缴费方式 */
  payMethod?: string;
  syncStatus: OuterSyncStatus;
  syncStatusName?: string;
  sourceUpdateTime?: string;
}

export interface FeeQuery {
  page: number;
  size: number;
  classId?: string;
  studentNo?: string;
  studentName?: string;
  feeType?: FeeType;
  payStatus?: PayStatus;
  startDate?: string;
  endDate?: string;
  keyword?: string;
}

/** 催费记录（同步自教务管理，本模块只读） */
export interface UrgeRecord extends BaseEntity {
  studentId: string;
  studentNo: string;
  studentName: string;
  classId?: string;
  className?: string;
  phone?: string;
  parentPhone?: string;
  headTeacherId?: string;
  headTeacherName?: string;
  feeType: FeeType;
  feeTypeName?: string;
  /** 欠费金额，单位「分」 */
  amount: number;
  /** 到期日期 YYYY-MM-DD（逾期判定依据） */
  expireDate: string;
  /** 逾期天数，后端按当前日期计算 */
  overdueDays?: number;
  payStatus: PayStatus;
  payStatusName?: string;
  /** 催费次数 */
  urgeCount: number;
  /** 最近催费时间 */
  lastUrgeTime?: string;
  syncStatus: OuterSyncStatus;
  syncStatusName?: string;
  sourceUpdateTime?: string;
}

export interface UrgeQuery {
  page: number;
  size: number;
  classId?: string;
  feeType?: FeeType;
  payStatus?: PayStatus;
  /** 只看逾期 */
  onlyOverdue?: boolean;
  startDate?: string;
  endDate?: string;
  keyword?: string;
}

/** 退费申请项 */
export interface RefundItem {
  feeType: FeeType;
  feeTypeName?: string;
  /** 该项退费金额，单位「分」 */
  amount: number;
}

/** 退费申请（审批链见 RefundStatus） */
export interface RefundApply extends BaseEntity {
  applyNo: string;
  studentId: string;
  studentNo: string;
  studentName: string;
  classId?: string;
  className?: string;
  deptCode?: number;
  /** 退费项目（可多选） */
  refundItems: RefundItem[];
  /** 退费总金额，单位「分」 */
  refundAmount: number;
  /** 退费原因（必填） */
  refundReason: string;
  refundStatus: RefundStatus;
  refundStatusName?: string;
  /** 是否需要校长审批（超过阈值时为 true） */
  isNeedPrincipal: boolean;
  applicantId?: string;
  applicantName?: string;
  applyTime: string;
  /** 当前处理人姓名，列表展示「当前处理人」用 */
  currentHandlerName?: string;
  /** 最近一次驳回原因 */
  rejectReason?: string;
}

/** 退费申请入参 */
export interface RefundApplyPayload {
  studentId: string;
  refundItems: RefundItem[];
  refundAmount: number;
  refundReason: string;
}

export interface RefundQuery {
  page: number;
  size: number;
  classId?: string;
  studentNo?: string;
  studentName?: string;
  refundStatus?: RefundStatus;
  startDate?: string;
  endDate?: string;
  keyword?: string;
}
