/**
 * 学籍异动审批 · 仓储共享类型
 * ============================================================
 * 三个仓储（实训 / 初高 / 大学）导出**同名同签名**的函数，
 * 适配器（service.ts）才能按 stage 一致地分派。
 */

/** 新建申请单的入参（service 已补全学生/班级快照；`bizType` 是**统一码**） */
export interface LeaveWriteInput {
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
  deptCode: number | null;
  headTeacherId: string | null;
  headTeacherName: string | null;

  /** ★ 统一业务类型：1 休学 · 2 退学 · 3 复学（仓储内部翻成自己库的原码） */
  bizType: number;
  leaveDate: string;
  expectResumeDate: string | null;
  newClassId: string | null;
  newClassName: string | null;
  leaveReason: string;
  attendedHours: number | null;

  initiatorId: string;
  initiatorName: string;
}

export interface StudentOption {
  id: string;
  no: string;
  name: string;
  classId: string | null;
  className: string | null;
}

/** 学生快照（建单用） */
export interface StudentSnapshot {
  no: string;
  name: string;
  gender: string | null;
  idCard: string | null;
  phone: string | null;
  parentPhone: string | null;
  classId: string | null;
  className: string | null;
  deptCode: number | null;
  /** 当前学生状态（用于"能不能发起"的校验） */
  studentStatus: number | null;
}

export interface LeaveAggregate {
  total: number;
  suspendCount: number;
  quitCount: number;
  resumeCount: number;
  /** 审批中 */
  pendingCount: number;
  approvedCount: number;
}
