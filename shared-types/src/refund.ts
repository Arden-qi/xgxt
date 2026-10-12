/**
 * 退费模块类型定义
 *
 * 归属模块：就业管理 > 实训阶段（马志斌）
 * 审批链：班主任发起 → 学管审批 → 校长审批 → 财务退费
 *
 * ⚠️ 金额一律用「分」（整数），前端展示时再 ÷100
 */

import type { ApprovalStatus, RefundType } from './enums.js';

/**
 * 退费单（详情）
 */
export interface Refund {
  id: string;
  /** 退费单号，如 TK20260929001 */

  // ---- 学生信息（快照）----
  studentId: string;
  studentNo: string;
  studentName: string;
  classId?: string;
  className?: string;
  deptName?: string;
  deptCode?: number;

  // ---- 班主任 ----
  headTeacherId?: string;
  headTeacherName?: string;

  // ---- 退费业务字段 ----
  refundType: RefundType;
  /** 退费类型名称（双返回） */
  refundTypeName?: string;
  /** 退费金额（单位：分）*/
  refundAmount: number;
  /** 退费金额展示文本，如 "1,500.00"（后端算好，前端直接用）*/
  refundAmountText?: string;

  // ---- ★ 「退学退费」合并单的三项明细（2026-10-01 新增）----
  //   退学审批通过后系统自动生成一张合并单，同时含学费 + 住宿费 + 餐费。
  //   ⚠️ 只有这一种单子会填，其余单子这三项都是 null。
  //   ⚠️ refundAmount（总金额）恒等于三者之和。
  /** 学费（分）*/
  tuitionAmount?: number | null;
  tuitionAmountText?: string | null;
  /** 住宿费（分）—— 该生没有宿舍时为 0 */
  accommodationAmount?: number | null;
  accommodationAmountText?: string | null;
  /** 餐费（分）*/
  mealAmount?: number | null;
  mealAmountText?: string | null;

  applyDate: string;
  refundReason: string;

  // ---- 审批 ----
  approvalId?: string;
  approvalStatus: ApprovalStatus;
  /** 审批状态名称（双返回）*/
  approvalStatusName?: string;
  /** 当前处理人提示，如「待学管审批」*/
  currentHandlerHint?: string;

  // ---- 财务 ----
  financeRemark?: string;
  refundTime?: string;

  remark?: string;
  createTime?: string;
  updateTime?: string;
}

/**
 * 退费列表项（比详情少，去掉大字段）
 */
export interface RefundListItem {
  id: string;
  studentId: string;
  studentNo: string;
  studentName: string;
  className?: string;
  deptName?: string;
  headTeacherName?: string;
  refundType: RefundType;
  refundTypeName?: string;
  refundAmount: number;
  refundAmountText?: string;

  // ★ 「退学退费」合并单的三项明细（2026-10-01）—— 其余单子为 null
  tuitionAmount?: number | null;
  tuitionAmountText?: string | null;
  accommodationAmount?: number | null;
  accommodationAmountText?: string | null;
  mealAmount?: number | null;
  mealAmountText?: string | null;

  applyDate: string;
  refundReason?: string;
  approvalStatus: ApprovalStatus;
  approvalStatusName?: string;
  currentHandlerHint?: string;
  /** 当前登录人能不能审批这条（前端据此显示/隐藏审批按钮）*/
  canApprove?: boolean;
  /**
   * 当前登录人能不能**提交**这条
   *
   * ★ 2026-10-01 新增：班级结业时会自动生成「待提交」的住宿费退费单，
   *   必须有入口让班主任填金额、提交审批。
   */
  canSubmit?: boolean;
  /** 当前登录人能不能撤回/编辑这条 */
  canCancel?: boolean;
}

/**
 * 退费列表查询参数
 */
export interface RefundQuery {
  page?: number;
  size?: number;
  /** 学生姓名/学号 模糊搜 */
  keyword?: string;
  classId?: string;
  deptCode?: number;
  refundType?: RefundType;
  approvalStatus?: ApprovalStatus;
  /** 只看"待我审批"的（学管/校长用）*/
  onlyMine?: boolean;
  startDate?: string;
  endDate?: string;
}

/**
 * 新建/编辑退费单的提交内容
 *
 * ⚠️ 班主任只能填这些；
 *    审批状态、单号、班主任信息都是系统自动写的，不接受前端传。
 */
export interface RefundPayload {
  studentId: string;
  refundType: RefundType;
  /** 退费金额（单位：分）—— 斌哥确认由班主任填写 */
  refundAmount: number;
  applyDate: string;
  refundReason: string;
  remark?: string;
}

/**
 * 审批动作的提交内容（同意/驳回/撤回）
 */
export interface ApprovalActionPayload {
  /** 审批意见（同意时选填，驳回时必填）*/
  comment?: string;
}

/**
 * 审批轨迹的一条记录
 */
export interface ApprovalLogItem {
  id: string;
  step: number;
  nodeName?: string;
  operatorId?: string;
  operatorName?: string;
  operatorRole?: string;
  action: number;
  actionName?: string;
  comment?: string;
  createTime?: string;
  /** 头像文字（取姓名首字，前端用）*/
  avatarText?: string;
}

/**
 * 退费详情（含审批轨迹）
 */
export interface RefundDetail extends Refund {
  logs: ApprovalLogItem[];
  /** 当前登录人能做什么（前端据此显示按钮）*/
  canApprove?: boolean;
  canCancel?: boolean;
  /** 待提交（草稿）且本人发起 → 可填金额并提交（2026-10-01） */
  canSubmit?: boolean;
  /** 当前该谁审（显示在流程条上）*/
  currentStep?: number;
  totalSteps?: number;
  /** 审批链每一步的名字，用于画流程条 */
  chainNodes?: { step: number; name: string; done: boolean; current: boolean }[];
}
