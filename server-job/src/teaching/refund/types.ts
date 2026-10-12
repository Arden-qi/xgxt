/**
 * 退费仓储共享类型
 * ============================================================
 * 三个仓储（实训 / 初高 / 大学）导出**同名同签名**的函数，
 * 适配器（service.ts）才能按 stage 一致地分派。
 */

/** 新建退费单的入参（仓储层：已由 service 补全学生/班级快照） */
export interface RefundWriteInput {
  studentId: string;
  studentNo: string;
  studentName: string;
  classId: string | null;
  className: string | null;
  deptName: string | null;
  deptCode: number | null;
  /** 发起人身份快照（实训写 head_teacher_*，初高写 apply_user_*，大学写 applicant_*） */
  headTeacherId: string | null;
  headTeacherName: string | null;
  /** 费用类型（统一码；初高/大学/实训三套枚举一致） */
  feeType: number;
  refundAmount: number;
  applyDate: string;
  refundReason: string;
  remark: string | null;
  initiatorId: string;
  initiatorName: string;
}

/** 学生下拉项 */
export interface StudentOption {
  id: string;
  no: string;
  name: string;
  classId: string | null;
  className: string | null;
}

/** 汇总（各学段各算一份） */
export interface RefundAggregate {
  total: number;
  /** 审批中（统一码 2 待学管 + 3 待校长） */
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
  /** 已通过金额合计（分） */
  approvedAmount: number;
}
