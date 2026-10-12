/**
 * 班级信息管理 + 出勤管理 接口响应类型
 *
 * 路径与后端 /api/job/class、/api/job/class-student、/api/job/attendance 完全一致
 */

import type { PageData } from '../common.js';
import type {
  ClassInfo,
  ClassListItem,
  ClassOption,
  ClassStudentListItem,
  ClassStudentCandidate,
  Attendance,
  AttendanceBoard,
  AttendanceDetail,
  AttendanceSummary,
  AttendanceSaveResult,
} from '../class.js';

/* ---------- 班级管理 ---------- */

export type ClassPageResp = PageData<ClassListItem>;
export type ClassDetailResp = ClassInfo;
export type ClassOptionsResp = ClassOption[];
export type ClassAddResp = { id: string };
export type ClassUpdateResp = null;
export type ClassDeleteResp = null;
export type ClassSealResp = null;
export type ClassUnsealResp = null;
export type ClassGraduateResp = null;

/* ---------- 班级花名册 ---------- */

export type ClassStudentPageResp = PageData<ClassStudentListItem>;
export type ClassStudentCandidatesResp = ClassStudentCandidate[];
export type ClassStudentAddResp = { addedCount: number };
export type ClassStudentRemoveResp = { removedCount: number };

/* ---------- 出勤管理 ---------- */

export type AttendanceBoardResp = AttendanceBoard;
export type AttendanceDetailResp = AttendanceDetail;
export type AttendanceSaveResp = AttendanceSaveResult;
export type AttendancePageResp = PageData<Attendance>;
export type AttendanceSummaryResp = PageData<AttendanceSummary>;
