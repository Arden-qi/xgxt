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

/**
 * 「同一学生 + 同一费用项」重复申请的判重结果
 *
 * ★ 2026-10-23：判重粒度是**费用项**，不是整张单 ——
 *   业务口径（用户明确）：「一个学生可以有多条退费申请，比如第一条申请住宿费、
 *   第二条申请学费；但两条都是住宿费就要拦，提示这个费用类型已在审批」。
 *
 * 所以这里要说清楚**是哪一项**撞了、撞的是**哪张单**，
 * 用户才知道该去处理哪一单（而不是只知道"被拒"）。
 */
export interface FeeTypeConflict {
  /** 冲突的费用项（统一码：1 学费 / 2 住宿费 / 3 餐费 / 4 保险费 / 5 试学费 / 6 退学退费 / 9 其他） */
  feeType: number;
  /** 占用该费用项的那张退费单 id */
  refundId: string;
  /** 那张单的单号；初高 / 就业这两套表没有单号列 → 空串（文案里就不带单号） */
  applyNo: string;
  /** 那张单的状态（**统一码** 1 待提交 / 2 待学管 / 3 待校长） */
  status: number;
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
