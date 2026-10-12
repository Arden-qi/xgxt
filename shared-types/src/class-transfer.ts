/**
 * 班级交接（换班交接）实体类型
 *
 * 归属模块：就业管理 > 实训阶段（马志斌）
 * 字段依据：docs/换班交接-字段定稿.md
 *
 * 【业务含义】（2026-09-29 斌哥拍板 方案A）
 *   一次交接 = 一个班「换负责人」：原班主任/教员/助教 → 新班主任/教员/助教。
 *   学生不动，整个班跟着新负责人走。
 *
 * ⚠️ 与「学生换班」「末班」区分：
 *   本文件是【老师层面】的班交接；
 *   学生个别转班走 t_job_class_student 的 leaveType=1换班转出 / 2末班转出。
 *
 * ⚠️ 命名规范：
 *   - 数据库字段用下划线（class_name），代码里用小驼峰（className）
 *   - 枚举双返回：transferType(1) + transferTypeName("调岗")
 *   - 日期统一 string（'YYYY-MM-DD'）
 */

import type { TransferType, ClassStatus, ClassStage, TransferItem } from './enums.js';

/* ============================================================
 * 一、交接记录完整实体 t_job_class_transfer
 * ============================================================ */

/** 班级交接记录（完整） */
export interface ClassTransfer {
  id: string;

  // ---- 班级信息（快照）----
  classId: string;
  className: string;
  classCode: string;
  classStatus: ClassStatus;
  classStatusName: string;
  stage: ClassStage;
  stageName: string;

  // ---- 原负责人 ----
  oldHeadTeacherId: string | null;
  oldHeadTeacherName: string | null;
  oldTeacherId: string | null;
  oldTeacherName: string | null;
  oldAssistantId: string | null;
  oldAssistantName: string | null;

  // ---- 新负责人 ----
  newHeadTeacherId: string;
  newHeadTeacherName: string | null;
  newTeacherId: string | null;
  newTeacherName: string | null;
  newAssistantId: string | null;
  newAssistantName: string | null;

  // ---- 交接本身 ----
  transferDate: string;
  transferType: TransferType;
  transferTypeName: string;
  transferReason: string | null;
  remark: string | null;

  // ---- 交接快照 ----
  /** 交接时在班人数 */
  snapshotStudentCount: number;
  /** 交接时累计出勤率（%） */
  snapshotAttendanceRate: number | null;
  /** 交接时在班学生名单（已解析成数组） */
  snapshotStudentList: TransferStudentSnapshot[];
  /** 交接内容清单 */
  snapshotDetail: TransferItem[];

  // ---- 公共 ----
  createByName: string | null;
  createTime: string;
}

/** 交接快照里的学生条目 */
export interface TransferStudentSnapshot {
  id: string;
  no: string;
  name: string;
}

/* ============================================================
 * 二、列表 / 查询
 * ============================================================ */

/** 交接记录列表项（列表页用，不返回学生名单明细） */
export interface ClassTransferListItem {
  id: string;
  classId: string;
  className: string;
  classCode: string;

  oldHeadTeacherName: string | null;
  oldTeacherName: string | null;
  newHeadTeacherName: string | null;
  newTeacherName: string | null;

  transferDate: string;
  transferType: TransferType;
  transferTypeName: string;
  transferReason: string | null;

  snapshotStudentCount: number;
  snapshotAttendanceRate: number | null;

  createByName: string | null;
  createTime: string;
}

/** 交接记录查询参数 */
export interface ClassTransferQuery {
  page?: number;
  size?: number;
  /** 按班级筛选 */
  classId?: string;
  /** 按交接原因类型筛选 */
  transferType?: TransferType;
  /** 按新班主任筛选 */
  newHeadTeacherId?: string;
  /** 自定义条件 */
  transferDate?: string;
  startDate?: string;
  endDate?: string;
  className?: string;
}

/* ============================================================
 * 三、执行交接
 * ============================================================ */

/** 执行交接的入参 */
export interface ClassTransferPayload {
  /** 要交接的班级 */
  classId: string;

  /** 新班主任（必填 —— 一个班必须有班主任） */
  newHeadTeacherId: string;
  newHeadTeacherName?: string;
  /** 新教员 */
  newTeacherId?: string;
  newTeacherName?: string;
  /** 新助教 */
  newAssistantId?: string;
  newAssistantName?: string;

  /** 交接日期 */
  transferDate?: string;
  /** 交接原因类型 */
  transferType: TransferType;
  /** 交接说明 */
  transferReason?: string;
  /** 备注 */
  remark?: string;

  /** 交接内容清单（多选） */
  transferItems?: TransferItem[];
}

/** 执行交接的返回 */
export interface ClassTransferResult {
  /** 交接记录ID */
  transferId: string;
  /** 交接后的班级负责人 */
  className: string;
  newHeadTeacherName: string | null;
  newTeacherName: string | null;
  newAssistantName: string | null;
  /** 快照：交接时在班人数 */
  snapshotStudentCount: number;
}

/* ============================================================
 * 四、交接前的预览（让用户在点"确认交接"前看到快照）
 * ============================================================ */

/** 交接预览：当前班级状态 + 学生名单 */
export interface ClassTransferPreview {
  classId: string;
  className: string;
  classCode: string;
  classStatusName: string;
  stageName: string;

  // 当前负责人（即将被替换掉的）
  headTeacherId: string | null;
  headTeacherName: string | null;
  teacherId: string | null;
  teacherName: string | null;
  assistantId: string | null;
  assistantName: string | null;

  /** 当前在班人数 */
  studentCount: number;
  /** 累计出勤率（%），可能为 null（还没登过考勤） */
  attendanceRate: number | null;
  /** 在班学生名单 */
  students: TransferStudentSnapshot[];
}

/* ============================================================
 * 五、可选负责人（下拉候选用）
 * ============================================================ */

/** 教师选项（用于新班主任/教员/助教下拉） */
export interface TeacherOption {
  id: string;
  name: string;
  /** 角色：head班主任 / teacher教员 / assistant助教 */
  role: string;
  phone?: string | null;
}

/** 交接记录里「学生名单快照」的展示用的查询入参 */
export interface TransferSnapshotQuery {
  transferId: string;
}
