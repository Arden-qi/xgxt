import { BaseEntity } from './common';
import { ApplyType, SuspendStatus, UpgradeStatus } from './enums';

/**
 * 审批相关实体
 *
 * 权限与流程（依据需求）：
 *  - 休学：班主任申请 → 学管（教质/学术经理）审批 → 通知班主任；驳回也通知
 *  - 退学：班主任申请 → 学管初步审批 → 校长审批 → 通知班主任和学管；驳回也通知
 *  - 退费：走 RefundStatus 审批链（见 shared-types/src/finance.ts）
 */

/**
 * 休学 / 退学申请
 *
 * 申请类型 applyType：1 休学（两级）/ 2 退学（三级，含校长）
 * 状态流转：
 *   休学 1 → 2 → 4(已同意) / 5(已驳回)
 *   退学 1 → 2 → 3 → 4(已同意) / 5(已驳回)
 */
export interface SuspendApply extends BaseEntity {
  applyNo: string;
  applyType: ApplyType;
  applyTypeName?: string;
  studentId: string;
  studentNo: string;
  studentName: string;
  classId?: string;
  className?: string;
  deptCode?: number;
  /** 身份证号（申请表要用） */
  idCard?: string;
  /** 家长联系电话 */
  parentPhone?: string;
  /** 申请原因（必填） */
  applyReason: string;
  /** 休学开始日期 / 退学申请日期 */
  effectDate?: string;
  /** 预计复学日期（休学专用） */
  expectResumeDate?: string;
  /** 已产生费用，单位「分」（退学核算用） */
  occurredAmount?: number;
  /** 应退费用，单位「分」 */
  refundableAmount?: number;
  applyStatus: SuspendStatus;
  applyStatusName?: string;
  applicantId?: string;
  applicantName?: string;
  applyTime: string;
  /** 学管审批人 */
  managerApproverId?: string;
  managerApproverName?: string;
  managerApproveTime?: string;
  managerOpinion?: string;
  /** 校长审批人（仅退学） */
  principalApproverId?: string;
  principalApproverName?: string;
  principalApproveTime?: string;
  principalOpinion?: string;
  /** 驳回原因（applyStatus = REJECTED 时必填） */
  rejectReason?: string;
  currentHandlerName?: string;
}

/** 休学 / 退学申请入参 */
export interface SuspendApplyPayload {
  applyType: ApplyType;
  studentId: string;
  applyReason: string;
  effectDate?: string;
  expectResumeDate?: string;
}

export interface SuspendApplyQuery {
  page: number;
  size: number;
  applyType?: ApplyType;
  applyStatus?: SuspendStatus;
  classId?: string;
  studentNo?: string;
  studentName?: string;
  startDate?: string;
  endDate?: string;
  keyword?: string;
}

/**
 * 升学申请
 *
 * 依据需求四：「初高中升学的学生信息需支持同步」
 * 流程：初高部班主任发起升学申请 → 学管模块接收并落库
 *      （更新 stage + 班级，升学时的成绩随档案一并保存）
 */
export interface UpgradeApply extends BaseEntity {
  applyNo: string;
  studentId: string;
  studentNo: string;
  studentName: string;
  /** 学生姓名 + 学号（列表展示用，原型如此） */
  who?: string;
  /** 原部门 */
  fromDeptCode: number;
  fromDeptName?: string;
  /** 原学习阶段 */
  fromStage: number;
  fromStageName?: string;
  fromClassId?: string;
  fromClassName?: string;
  /** 目标部门 */
  toDeptCode: number;
  toDeptName?: string;
  /** 目标学习阶段 */
  toStage: number;
  toStageName?: string;
  toClassId?: string;
  toClassName?: string;
  /** 升学考试成绩（随档案保存） */
  examScore?: number;
  /** 升学时的成绩明细快照（JSON 字符串，随档案一并保存） */
  gradeSnapshot?: string;
  applyStatus: UpgradeStatus;
  applyStatusName?: string;
  applicantId?: string;
  applicantName?: string;
  applyTime: string;
  receiveTime?: string;
  receiverName?: string;
  /** 驳回原因 */
  rejectReason?: string;
}

/** 升学申请入参 */
export interface UpgradeApplyPayload {
  studentId: string;
  toDeptCode: number;
  toStage: number;
  toClassId?: string;
  examScore?: number;
}

export interface UpgradeApplyQuery {
  page: number;
  size: number;
  applyStatus?: UpgradeStatus;
  toDeptCode?: number;
  toStage?: number;
  fromClassId?: string;
  keyword?: string;
}

/** 审批日志（所有审批动作都记一笔，供追溯） */
export interface ApprovalLog extends BaseEntity {
  /** 业务类型 */
  applyType: ApplyType;
  applyTypeName?: string;
  /** 业务单号 */
  applyNo: string;
  /** 业务主键 */
  bizId: string;
  /** 动作：submit / approve / reject */
  action: string;
  /** 动作前状态 */
  fromStatus: number;
  /** 动作后状态 */
  toStatus: number;
  operatorId?: string;
  operatorName?: string;
  operatorRole?: string;
  opinion?: string;
  operateTime: string;
}

/** 通用审批入参 */
export interface ApprovalPayload {
  /** 业务主键 id */
  bizId: string;
  /** 同意 / 驳回 */
  action: 'approve' | 'reject';
  /** 审批意见；驳回时必填 */
  opinion?: string;
}
