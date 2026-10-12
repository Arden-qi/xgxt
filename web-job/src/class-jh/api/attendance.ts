/**
 * 出勤管理接口调用
 */

import { http } from './request';
import type {
  PageData,
  AttendanceRecord,
  AttendanceDetailData,
  AttendanceListQuery,
  AttendanceDetailQuery,
  AttendanceImportPayload,
  AttendanceUnqualifiedQuery,
  AttendanceUnqualifiedItem,
} from 'shared-types/class-jh';

/** 出勤台账列表 */
export function fetchAttendanceList(query: AttendanceListQuery): Promise<PageData<AttendanceRecord>> {
  return http.get<PageData<AttendanceRecord>>('/api/class-jh/attendance/list', query);
}

/** 出勤详情（台账 + 明细） */
export function fetchAttendanceDetail(query: AttendanceDetailQuery): Promise<AttendanceDetailData> {
  return http.get<AttendanceDetailData>('/api/class-jh/attendance/detail', query);
}

/** 导入出勤表（自动算 rate 并回流学生） */
export function importAttendance(payload: AttendanceImportPayload): Promise<{ attendanceId: string }> {
  return http.post<{ attendanceId: string }>('/api/class-jh/attendance/import', payload);
}

/** 导出出勤台账 */
export function exportAttendance(query: AttendanceListQuery): Promise<AttendanceRecord[]> {
  return http.get<AttendanceRecord[]>('/api/class-jh/attendance/export', query);
}

/** 当月未达标学生 */
export function fetchUnqualified(query: AttendanceUnqualifiedQuery): Promise<AttendanceUnqualifiedItem[]> {
  return http.get<AttendanceUnqualifiedItem[]>('/api/class-jh/attendance/unqualified', query);
}
