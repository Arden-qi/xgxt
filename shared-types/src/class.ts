/**
 * 班级信息管理 + 出勤管理 实体类型
 *
 * 归属模块：就业管理 > 实训阶段（马志斌）
 * 字段依据：docs/班级信息+出勤-字段定稿.md
 *
 * ⚠️ 命名规范：
 *   - 数据库字段用下划线（class_name），代码里用小驼峰（className）
 *   - 枚举双返回：classStatus(1) + classStatusName("开放")
 *   - 日期时间统一 string（'YYYY-MM-DD HH:mm:ss' 或 'YYYY-MM-DD'）
 */

import type { ClassStatus, ClassStage, JoinType, LeaveType, ClassStudentStatus, AttendStatus } from './enums.js';

/* ============================================================
 * 一、班级主档 t_job_class
 * ============================================================ */

/** 班级完整实体 */
export interface ClassInfo {
  id: string;

  /** 班级名称 */
  className: string;
  /** 班级编号 SX2026001 */
  classCode: string;
  /** 部门 1初高部 2大学部 */
  deptCode: number;
  /** 部门名（双返回） */
  deptName?: string;
  /** 阶段 */
  stage: ClassStage;
  /** 阶段名（双返回） */
  stageName?: string;

  /** 班主任ID */
  headTeacherId: string;
  /** 班主任姓名（快照） */
  headTeacherName?: string;
  /** 教员ID */
  teacherId?: string;
  /** 教员姓名（快照） */
  teacherName?: string;
  /** 助教ID */
  assistantId?: string;
  /** 助教姓名（快照） */
  assistantName?: string;

  /** 教室地点 */
  classroom?: string;
  /** 开班日期 */
  openDate: string;
  /** 结业日期（状态为已结业时才有值） */
  closeDate?: string;

  /** 班级人数（系统按花名册在班人数实时统计） */
  studentCount: number;

  /** 班级状态 */
  classStatus: ClassStatus;
  /** 班级状态名（双返回） */
  classStatusName?: string;

  /** 班级累计出勤率（%） */
  attendanceRate?: number;

  /** 备注 */
  remark?: string;

  createTime?: string;
  updateTime?: string;
}

/** 班级列表项（列表页用，比实体少一些字段） */
export interface ClassListItem {
  id: string;
  className: string;
  classCode: string;
  deptCode: number;
  deptName?: string;
  stage: ClassStage;
  stageName?: string;
  headTeacherName?: string;
  teacherName?: string;
  classroom?: string;
  openDate: string;
  /** 班级人数（在班） */
  studentCount: number;
  classStatus: ClassStatus;
  classStatusName?: string;
  /** 今日出勤率（从汇总表取，没登记则为空） */
  todayAttendanceRate?: number;
  remark?: string;
  /**
   * 当前登录人能不能删除这个班（后端按角色算好，前端只管按它显隐按钮）
   *
   * ⚠️ 班主任为 false —— 删除班级是管理动作（斌哥 2026-09-30 拍板）。
   *    后端 /delete/:id 也会再拦一次，前端藏按钮不等于安全。
   */
  canDelete?: boolean;
}

/** 班级查询参数 */
export interface ClassQuery {
  page?: number;
  size?: number;
  /** 班级名称，模糊匹配 */
  className?: string;
  /** 班级编号，模糊匹配 */
  classCode?: string;
  /** 班级状态 */
  classStatus?: ClassStatus;
  /** 部门 */
  deptCode?: number;
  /** 阶段 */
  stage?: ClassStage;
  /** 班主任ID（查「我带的班」） */
  headTeacherId?: string;
}

/** 班级新增/编辑提交体 */
export interface ClassSavePayload {
  className: string;
  classCode: string;
  deptCode: number;
  stage: ClassStage;
  headTeacherId: string;
  teacherId?: string;
  assistantId?: string;
  classroom?: string;
  openDate: string;
  classStatus: ClassStatus;
  remark?: string;
}

/** 班级下拉选项（给考试选班等场景用） */
export interface ClassOption {
  id: string;
  className: string;
  classCode: string;
  deptCode: number;
  stage: ClassStage;
  /** 阶段名（双返回） */
  stageName?: string;
  classStatus: ClassStatus;
  /** 班级状态名（双返回），如「开放」 */
  classStatusName?: string;
  /** 班级人数，方便选择时判断 */
  studentCount: number;
}

/* ============================================================
 * 二、班级花名册 t_job_class_student
 * ============================================================ */

/** 花名册记录 */
export interface ClassStudent {
  id: string;
  classId: string;
  className?: string;
  studentId: string;
  studentNo: string;
  studentName: string;
  /** 入班日期 */
  joinDate: string;
  /** 入班方式 */
  joinType: JoinType;
  joinTypeName?: string;
  /** 离班日期 */
  leaveDate?: string;
  /** 离班方式 */
  leaveType?: LeaveType;
  leaveTypeName?: string;
  /** 离班原因 */
  leaveReason?: string;
  /** 在班状态 */
  status: ClassStudentStatus;
  statusName?: string;
  remark?: string;
  createTime?: string;
}

/** 花名册列表项（带学生附加信息，便于列表展示） */
export interface ClassStudentListItem extends ClassStudent {
  /** 学生性别 1男 2女 */
  gender?: number;
  /** 学生手机号 */
  phone?: string;
  /** 家长手机号 */
  parentPhone?: string;
  /** 末班次数（末班转入的标识） */
  repeatCount?: number;
  /** 学习阶段 */
  stage?: number;
  /** 宿舍号 */
  dormNo?: string;
}

/** 花名册查询参数 */
export interface ClassStudentQuery {
  page?: number;
  size?: number;
  /** 班级ID（必传，花名册必须挂在某个班下） */
  classId: string;
  /** 在班状态；不传则查全部 */
  status?: ClassStudentStatus;
  /** 学号，模糊匹配 */
  studentNo?: string;
  /** 姓名，模糊匹配 */
  studentName?: string;
}

/** 可加入班级的候选人（不在本班、且在班状态正常的） */
export interface ClassStudentCandidate {
  studentId: string;
  studentNo: string;
  studentName: string;
  gender?: number;
  /** 当前所在班级名（空=未分班） */
  currentClassName?: string;
  /** 末班次数 */
  repeatCount?: number;
  /** 学生状态 */
  studentStatus?: number;
  studentStatusName?: string;
}

/** 批量加学生进班 */
export interface ClassStudentAddPayload {
  classId: string;
  /** 学生ID数组（批量） */
  studentIds: string[];
  /** 入班方式 */
  joinType: JoinType;
  /** 入班日期，默认今天 */
  joinDate?: string;
  remark?: string;
}

/** 批量移出班级 */
export interface ClassStudentRemovePayload {
  classId: string;
  studentIds: string[];
  /** 离班方式 */
  leaveType: LeaveType;
  /** 离班日期，默认今天 */
  leaveDate?: string;
  leaveReason?: string;
}

/* ============================================================
 * 三、班级每日出勤汇总 t_job_attendance_summary
 * ============================================================ */

export interface AttendanceSummary {
  id: string;
  classId: string;
  className?: string;
  attendDate: string;
  /** 应到人数（全部在班学生，含请假的） */
  shouldCount: number;
  /** 实到人数（出勤+迟到+早退） */
  actualCount: number;
  /** 未到人数（缺勤+请假+事假+病假） */
  absentCount: number;
  /** 当日出勤率（%） */
  attendanceRate: number;
  headTeacherName?: string;
  teacherName?: string;
  createTime?: string;
  updateTime?: string;
}

export interface AttendanceSummaryQuery {
  page?: number;
  size?: number;
  classId?: string;
  /** 日期范围开始 */
  startDate?: string;
  /** 日期范围结束 */
  endDate?: string;
}

/* ============================================================
 * 四、出勤记录 t_job_attendance
 * ============================================================ */

/** 出勤记录 */
export interface Attendance {
  id: string;
  classId: string;
  className?: string;
  studentId: string;
  studentNo?: string;
  studentName?: string;
  attendDate: string;
  attendStatus: AttendStatus;
  attendStatusName?: string;
  /** 请假类型（status 为 6/7 时有值） */
  attendType?: number;
  /** 原因（缺勤/请假时填） */
  reason?: string;
  remark?: string;
  registrarId?: string;
  registrarName?: string;
  createTime?: string;
  updateTime?: string;
}

/**
 * 考勤登记板的一行
 * 「取某班某天的考勤表」时，没登记过的学生也会出现（状态默认出勤）
 */
export interface AttendanceBoardRow {
  studentId: string;
  studentNo: string;
  studentName: string;
  gender?: number;
  /** 学生手机号 */
  phone?: string;
  /** 出勤状态；未登记过则为 undefined（前端默认显示出勤） */
  attendStatus?: AttendStatus;
  attendType?: number;
  reason?: string;
  remark?: string;
  /** 这条记录是否已存在库里 */
  registered: boolean;
}

/** 考勤登记板（含班级信息 + 统计 + 学生行） */
export interface AttendanceBoard {
  classId: string;
  className: string;
  classCode?: string;
  attendDate: string;
  headTeacherName?: string;
  teacherName?: string;
  /** 应到人数 */
  shouldCount: number;
  /** 实到人数 */
  actualCount: number;
  /** 未到人数 */
  absentCount: number;
  /** 出勤率（%） */
  attendanceRate: number;
  /** 是否已经登记过（有记录即 true） */
  registered: boolean;
  rows: AttendanceBoardRow[];
}

/**
 * ★ 出勤详情的一行（点「详情」看某班某天逐人情况）
 * 与 AttendanceBoardRow 的区别：这里 attendStatus 可能为 null 表示「未登记」，
 * 且带 attendStatusName（含「未登记」文案），方便前端直接显示。
 */
export interface AttendanceDetailRow {
  studentId: string;
  studentNo: string;
  studentName: string;
  gender?: number | null;
  phone?: string | null;
  /** 出勤状态；未登记为 null */
  attendStatus: AttendStatus | null;
  /** 状态中文名（未登记时是「未登记」） */
  attendStatusName: string;
  attendType?: number | null;
  reason?: string | null;
  remark?: string | null;
  /** 这条记录是否已存在库里 */
  registered: boolean;
}

/** ★ 出勤详情（某班某天的逐人明细 + 统计） */
export interface AttendanceDetail {
  classId: string;
  className: string;
  classCode?: string;
  attendDate: string;
  headTeacherName?: string | null;
  teacherName?: string | null;
  shouldCount: number;
  actualCount: number;
  absentCount: number;
  attendanceRate: number;
  /** 当天是否已登记过 */
  registered: boolean;
  /** 在班学生总数 */
  totalStudents: number;
  /** 已登记人数 */
  registeredStudents: number;
  rows: AttendanceDetailRow[];
}

/** 保存考勤的一行 */
export interface AttendanceSaveRow {
  studentId: string;
  attendStatus: AttendStatus;
  attendType?: number;
  reason?: string;
  remark?: string;
}

/** 保存考勤（批量 upsert） */
export interface AttendanceSavePayload {
  classId: string;
  attendDate: string;
  rows: AttendanceSaveRow[];
}

/** 出勤记录查询参数 */
export interface AttendanceQuery {
  page?: number;
  size?: number;
  classId?: string;
  studentId?: string;
  attendStatus?: AttendStatus;
  startDate?: string;
  endDate?: string;
  studentNo?: string;
  studentName?: string;
}

/** 出勤登记结果 */
export interface AttendanceSaveResult {
  /** 本次保存的记录数 */
  savedCount: number;
  /** 保存后的班级统计 */
  summary: AttendanceSummary;
}

/* ============================================================
 * 十、结业转就业（2026-10-01）
 *
 * ★ 斌哥拍板：「结业」和「转就业」是**一个动作**，点一下全部完成，不走审批。
 *   就业和实训在同一个服务(8004)、同一个库(sms_job)，
 *   所以"转就业"= 学生状态 实训中(8) → 待就业(9)，**不搬数据**。
 * ============================================================ */

/** 结业预览（点按钮前先让人看清楚会发生什么） */
export interface GraduatePreview {
  /** 班里在班学生总数 */
  totalInClass: number;
  /** 会被转走的（状态=实训中的） */
  willTransfer: number;
  /** 会被跳过的（休学/退学） */
  skipped: Array<{
    studentId: string;
    studentName: string;
    studentStatus: number;
    studentStatusName: string;
  }>;
  /** 其中"有宿舍"的（会连带生成退宿申请 + 住宿费退费单） */
  withDorm: number;
}

/** 结业执行结果 */
export interface GraduateResult {
  /** 实际转出到「待就业」的学生数 */
  graduatedCount: number;
  /** 连带生成的退宿申请单数 */
  dormChangeCount: number;
  /** 连带生成的住宿费退费单数 */
  refundCount: number;
  /** 被跳过的学生姓名（休学/退学） */
  skippedNames: string[];
}

/** 撤销结业结果 */
export interface RevokeGraduateResult {
  /** 恢复回「实训中」的学生数 */
  restoredCount: number;
  /** 被自动作废的退宿申请单数 */
  cancelledDormChange: number;
}
