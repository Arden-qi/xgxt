/**
 * 接口契约：出勤管理
 *
 * 路径前缀：/api/class/attendance
 */

import { ApiResponse, PageResponse } from '../common';
import { AttendanceRecord, AttendanceDetail } from '../class';
import { AttendanceStatus } from '../enums';

/* ---------------- 出勤台账 ---------------- */

/** 出勤列表查询参数 */
export interface AttendanceListQuery {
  page?: number;
  size?: number;
  classId?: string;
  startDate?: string;
  endDate?: string;
}

/** 出勤列表响应 */
export type AttendanceListResponse = PageResponse<AttendanceRecord>;

/** 出勤详情查询参数（attendanceId 或 classId+attendanceDate 二选一） */
export interface AttendanceDetailQuery {
  attendanceId?: string;
  classId?: string;
  attendanceDate?: string;
}

/** 出勤详情响应 */
export interface AttendanceDetailData {
  record: AttendanceRecord;
  details: AttendanceDetail[];
}
export type AttendanceDetailResponse = ApiResponse<AttendanceDetailData>;

/* ---------------- 导入 / 导出 ---------------- */

/** 出勤明细导入项 */
export interface AttendanceImportItem {
  studentId: string;
  studentNo?: string;
  studentName?: string;
  attendanceStatus: AttendanceStatus;
  absentReason?: string;
}

/** 出勤导入入参 */
export interface AttendanceImportPayload {
  classId: string;
  attendanceDate: string;
  fileUrl: string;
  details?: AttendanceImportItem[];
  remark?: string;
}

/** 出勤导入响应 */
export type AttendanceImportResponse = ApiResponse<{ attendanceId: string }>;

/** 出勤导出响应（） */
export type AttendanceExportResponse = ApiResponse<AttendanceRecord[]>;

/* ---------------- 未达标 ---------------- */

/** 未达标查询参数 */
export interface AttendanceUnqualifiedQuery {
  classId?: string;
  month?: string;
}

/** 未达标学生项 */
export interface AttendanceUnqualifiedItem {
  studentId: string;
  studentNo: string;
  studentName: string;
  className?: string;
  attendanceRate: number;
  unqualifiedCount: number;
}

/** 未达标响应 */
export type AttendanceUnqualifiedResponse = ApiResponse<AttendanceUnqualifiedItem[]>;
