/**
 * 休学 / 退学 模块类型定义
 *
 * 归属模块：就业管理 > 实训阶段（马志斌）
 *
 * 【审批链】
 *   休学：班主任发起 → 学管审批 → 通过（★ 不走校长）
 *   退学：班主任发起 → 学管审批 → 校长审批
 *   复学：班主任发起 → 学管审批 → 通过（★ 不走校长，2026-10-01 新增）
 *
 * 【为什么放一个文件】
 *   三个业务字段基本一样，只是 bizType / 审批链 / 通过后动作不同。
 *   所以共用一套类型，用 bizType 区分。
 *
 * ⚠️ 复学的**班级由学管在审批时选定**（斌哥 2026-10-01 修正流程）：
 *    班主任只管提申请（填学生 + 日期 + 原因），学管审的时候才定"进哪个班"。
 *    所以「复学班」走**审批接口**的 `classId` 参数，不在建单 payload 里。
 */

import type { ApprovalStatus, StudentLeaveBizType } from './enums.js';

/**
 * 休学/退学申请单（详情）
 */
export interface StudentLeave {
  id: string;
  /** 单号，如 XX20260930001 */

  /** 业务类型 1休学 2退学 */
  bizType: StudentLeaveBizType;
  /** 类型名称（双返回）*/
  bizTypeName?: string;

  // ---- 学生信息（快照）----
  studentId: string;
  studentNo: string;
  studentName: string;
  gender?: number;
  genderName?: string;
  idCard?: string;
  phone?: string;
  parentPhone?: string;
  address?: string;

  /** 学生【原班】（建单时快照 —— 复学单里这就是"他休学前在哪个班"） */
  classId?: string;
  className?: string;
  deptName?: string;
  deptCode?: number;

  /**
   * ★【复学班】—— 只有复学单有值，由**学管在审批时选定**
   *   （斌哥 2026-10-01：复学班级不是班主任选的）
   */
  newClassId?: string | null;
  newClassName?: string | null;

  headTeacherId?: string;
  headTeacherName?: string;

  // ---- 业务字段 ----
  /** 已上课时（系统按实际出勤天数算）*/
  attendedHours?: number;
  leaveDate: string;
  leaveReason: string;
  headTeacherOpinion?: string;

  // ---- 审批 ----
  approvalId?: string;
  approvalStatus: ApprovalStatus;
  approvalStatusName?: string;
  currentHandlerHint?: string;

  // ---- 关联退费单 ----
  relatedRefundNo?: string;

  remark?: string;
  createTime?: string;
  updateTime?: string;
}

/**
 * 列表项（比详情少，去掉地址等大字段）
 */
export interface StudentLeaveListItem {
  id: string;
  bizType: StudentLeaveBizType;
  bizTypeName?: string;

  studentId: string;
  studentNo: string;
  studentName: string;
  gender?: number;
  genderName?: string;
  className?: string;
  deptName?: string;
  headTeacherName?: string;

  attendedHours?: number;
  leaveDate: string;
  leaveReason?: string;

  approvalStatus: ApprovalStatus;
  approvalStatusName?: string;
  currentHandlerHint?: string;

  /** 当前登录人能不能审批这条（前端据此显示/隐藏审批按钮）*/
  canApprove?: boolean;
  /** 当前登录人能不能撤回这条 */
  canCancel?: boolean;
}

/**
 * 列表查询参数
 */
export interface StudentLeaveQuery {
  page?: number;
  size?: number;
  /** 学生姓名/学号/单号 模糊搜 */
  keyword?: string;
  /** 类型：1休学 2退学 3复学（不传=全部）*/
  bizType?: StudentLeaveBizType;
  classId?: string;
  deptCode?: number;
  approvalStatus?: ApprovalStatus;
  /** 只看"待我审批" */
  onlyMine?: boolean;
  startDate?: string;
  endDate?: string;
}

/**
 * 新建/编辑申请单的提交内容
 *
 * ⚠️ 班主任只能填这些；
 *    单号、学生快照、审批状态都是系统自动写的。
 */
export interface StudentLeavePayload {
  /** 1休学 2退学 3复学 */
  bizType: StudentLeaveBizType;
  studentId: string;

  // ⚠️ 这里**没有** classId ——
  //   复学班级由**学管在审批时选定**（斌哥 2026-10-01 修正流程），
  //   所以它走审批接口的 `classId` 参数，不在这里传。
  //   休学/退学则系统自动取学生当前所在班。

  /** 休学/退学/复学日期 */
  leaveDate: string;
  /** 休学/退学原因（必填）*/
  leaveReason: string;
  /** 班主任意见（选填）*/
  headTeacherOpinion?: string;

  /** ★ 主档暂无这些字段，允许手填 */
  idCard?: string;
  address?: string;

  remark?: string;
}

/**
 * 详情（含审批轨迹 + 流程条）
 */
export interface StudentLeaveDetail extends StudentLeave {
  logs: import('./refund.js').ApprovalLogItem[];
  canApprove?: boolean;
  canCancel?: boolean;
  currentStep?: number;
  totalSteps?: number;
  chainNodes?: { step: number; name: string; done: boolean; current: boolean }[];
  /** 该学生的历史退费单（xmind：查看退费表）*/
  refunds?: {
    id: string;
    refundTypeName?: string;
    refundAmountText?: string;
    applyDate: string;
    approvalStatusName?: string;
  }[];
  /** 该学生的历史休学/退学单 */
  history?: {
    id: string;
    bizTypeName?: string;
    leaveDate: string;
    approvalStatusName?: string;
  }[];
}
