/**
 * 催费管理 —— 前端/后端共用类型
 *
 * 归属模块：就业管理 > 实训阶段（马志斌）
 * 创建时间：2026-09-30
 *
 * ⚠️ 这个文件是「前后端唯一口径」，字段以这里为准。
 */

/** 催费单（列表项） */
export interface FeeCallListItem {
  id: string;
  feeType: number;   // FeeCallCategory: 2住宿费 4保险费 3餐费            // 2住宿费 4保险费 3餐费（FeeCallCategory，编码与 RefundType 对齐）
  feeTypeName: string;        // 枚举双返回

  studentId: string;
  studentNo: string | null;
  studentName: string | null;
  phone: string | null;
  parentPhone: string | null;

  classId: string | null;
  className: string | null;
  deptCode: number | null;
  deptName: string | null;
  headTeacherId: string | null;
  headTeacherName: string | null;

  /** 应缴金额（单位：分），可空 */
  feeAmount: number | null;
  /** 金额展示文本，如 "1,200.00"（后端算好，前端直接用） */
  feeAmountText: string | null;
  dueDate: string;            // 到期时间
  /** 是否已逾期（后端算好） */
  overdue: boolean;
  callReason: string | null;

  callStatus: number;         // 1待催缴 2催缴中 3已缴清（FeeCallStatus）
  callStatusName: string;
  handleTime: string | null;
  handleRemark: string | null;

  applicantId: string | null;
  applicantName: string | null;

  remark: string | null;
  createTime: string;

  /** ★ 当前登录人能不能处理这一单（班主任本人 / 管理员） */
  canHandle: boolean;
}

/** 查询条件 */
export interface FeeCallQuery {
  page?: number;
  size?: number;
  keyword?: string;
  feeType?: number;
  classId?: string;
  callStatus?: number;
  /** 只看我的（班主任：只看自己班） */
  onlyMine?: boolean;
  startDate?: string;
  endDate?: string;
}

/** 新建催费单入参 */
export interface FeeCallPayload {
  feeType: number;
  studentId: string;
  feeAmount?: number | null;  // 单位：分
  dueDate: string;
  callReason?: string | null;
  remark?: string | null;
}

/** 处理催费单入参（班主任催完了） */
export interface FeeCallHandlePayload {
  id: string;
  callStatus: number;         // 2催缴中 3已缴清（班主任能改的两种）
  handleRemark?: string | null;
}

/** 详情 */
export interface FeeCallDetail extends FeeCallListItem {
  /** 该学生的历史催费记录 */
  history: Array<{
    id: string;
    feeType: number;
    feeTypeName: string;
    dueDate: string;
    callStatus: number;
    callStatusName: string;
    createTime: string;
  }>;
}

/** 顶部统计 */
export interface FeeCallSummary {
  total: number;
  /** 待处理 = 待催缴 + 催缴中 */
  pending: number;
  /** 催缴中 */
  called: number;
  /** 已缴清 */
  done: number;
  /** 已逾期（未缴清 + 到期日 < 今天） */
  overdue: number;
  /** 仅「待催缴」 */
  pendingOnly: number;
  /** 仅「催缴中」 */
  calling: number;
}

/** 可催费的学生选项 */
export interface FeeCallStudentOption {
  studentId: string;
  studentNo: string;
  studentName: string;
  className: string | null;
  deptCode: number | null;
  deptName: string | null;
  headTeacherId: string | null;
  headTeacherName: string | null;
  phone: string | null;
  parentPhone: string | null;
}
