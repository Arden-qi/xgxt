/**
 * 休学/退学 接口响应类型
 */

import type { StudentLeaveListItem, StudentLeaveDetail } from '../studentLeave.js';

/** 列表响应（与通用分页一致）*/
export interface StudentLeaveListResp {
  list: StudentLeaveListItem[];
  total: number;
  page: number;
  size: number;
}

/** 详情响应 */
export type StudentLeaveDetailResp = StudentLeaveDetail;

/** 新建响应 */
export interface StudentLeaveSaveResp {
  id: string;
}

/**
 * ★ 审批参数
 *
 * 复学**必须**带 `classId` —— 复学班级由**学管在审批时选定**
 * （斌哥 2026-10-01 修正流程：班主任只提申请，学管审的时候才定进哪个班）。
 */
export interface StudentLeaveApprovePayload {
  comment?: string;
  /** 复学专用：学管选定的复学班级 */
  classId?: string;
}

/** 审批动作结果 */
export interface StudentLeaveApprovalResult {
  finished: boolean;
  approvalStatus: number;
  approvalStatusName: string;
}

/** 统计卡片 */
export interface StudentLeaveSummary {
  total: number;
  suspendCount: number;
  quitCount: number;
  /** 复学（2026-10-01 新增） */
  resumeCount: number;
  /** 待学管审批 */
  pendingMgr: number;
  /** 待校长审批（仅退学有）*/
  pendingPrincipal: number;
  approved: number;
  /** 待我审批 */
  myPending: number;
}

/** 可选学生（班主任选人下拉） */
export interface StudentLeaveStudentOption {
  studentId: string;
  studentNo: string;
  studentName: string;
  gender?: number;
  genderName?: string;
  className: string | null;
  deptCode: number | null;
  deptName: string | null;
  headTeacherId: string | null;
  headTeacherName: string | null;
  /** 已上课时（系统算）*/
  attendedHours?: number;
  phone?: string | null;
  parentPhone?: string | null;
  dormNo?: string | null;
}
