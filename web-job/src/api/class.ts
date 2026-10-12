/**
 * 班级信息管理 + 出勤管理 接口调用（就业管理 > 实训阶段）
 *
 * ⚠️ 要点：
 *   1. 路径与后端 /api/job/class、/api/job/class-student、/api/job/attendance 完全一致
 *   2. 返回类型从 shared-types 引，字段写错会编译报错
 *   3. 泛型写的是「data 里的类型」（http.xxx 已经帮你解包了）
 */

import { http } from './request';
import type {
  PageData,
  ClassInfo,
  ClassListItem,
  ClassQuery,
  ClassSavePayload,
  ClassOption,
  ClassStudentListItem,
  ClassStudentQuery,
  ClassStudentCandidate,
  ClassStudentAddPayload,
  ClassStudentRemovePayload,
  Attendance,
  AttendanceBoard,
  AttendanceDetail,
  AttendanceQuery,
  AttendanceSavePayload,
  AttendanceSaveResult,
  AttendanceSummary,
  AttendanceSummaryQuery,
  ClassTransfer,
  ClassTransferListItem,
  ClassTransferQuery,
  ClassTransferPayload,
  ClassTransferResult,
  ClassTransferPreview,
  TeacherOption,
  GraduatePreview,
  GraduateResult,
  RevokeGraduateResult,
} from 'shared-types';

/* ============ 一、班级管理 ============ */

/** 查询班级列表 */
export function fetchClassList(query: ClassQuery): Promise<PageData<ClassListItem>> {
  return http.get<PageData<ClassListItem>>('/api/job/class/page', query);
}

/** 查询班级详情 */
export function fetchClassDetail(id: string): Promise<ClassInfo> {
  return http.get<ClassInfo>('/api/job/class/detail', { id });
}

/** 班级下拉选项（只返回开放的班；给考试选班等场景用） */
export function fetchClassOptions(params?: {
  deptCode?: number;
  includeAll?: boolean;
}): Promise<ClassOption[]> {
  return http.get<ClassOption[]>('/api/job/class/options', params);
}

/** 生成班级编号 */
export function fetchGenClassCode(): Promise<{ classCode: string }> {
  return http.get<{ classCode: string }>('/api/job/class/gen-code');
}

/** 新建班级 */
export function addClass(payload: ClassSavePayload): Promise<{ id: string }> {
  return http.post<{ id: string }>('/api/job/class/add', payload);
}

/** 编辑班级 */
export function updateClass(payload: ClassSavePayload & { id: string }): Promise<null> {
  return http.put<null>('/api/job/class/update', payload);
}

/** 删除班级（逻辑删，有在班学生不允许删） */
export function deleteClass(id: string): Promise<null> {
  return http.delete<null>(`/api/job/class/delete/${id}`);
}

/** 封班 */
export function sealClass(id: string): Promise<null> {
  return http.post<null>(`/api/job/class/seal/${id}`);
}

/** 解封 */
export function unsealClass(id: string): Promise<null> {
  return http.post<null>(`/api/job/class/unseal/${id}`);
}

/** 结业预览：点按钮前先看清楚会转出多少人、有没有人被跳过 */
export function fetchGraduatePreview(id: string): Promise<GraduatePreview> {
  return http.get<GraduatePreview>(`/api/job/class/graduate/preview/${id}`);
}

/**
 * 结业（= 班级结业 + 全班转就业，一个动作、不走审批）
 *
 * ★ 2026-10-01 斌哥拍板。连带动作：
 *   - 有宿舍的学生 → 自动生成「退宿申请」（走教务审批，不立即释放床位）
 *   - 有宿舍的学生 → 自动生成「住宿费退费单」（待提交，班主任核对金额后提交）
 */
export function graduateClass(id: string, closeDate: string): Promise<GraduateResult> {
  return http.post<GraduateResult>(`/api/job/class/graduate/${id}`, { closeDate });
}

/** 撤销结业（仅校长）：学生侧回滚，未审批的退宿申请自动作废 */
export function revokeGraduate(id: string): Promise<RevokeGraduateResult> {
  return http.post<RevokeGraduateResult>(`/api/job/class/revoke-graduate/${id}`);
}

/* ============ 二、班级花名册 ============ */

/** 查询花名册 */
export function fetchClassStudentList(
  query: ClassStudentQuery,
): Promise<PageData<ClassStudentListItem>> {
  return http.get<PageData<ClassStudentListItem>>('/api/job/class-student/page', query);
}

/** 可加入班级的候选人 */
export function fetchClassStudentCandidates(params: {
  classId: string;
  studentNo?: string;
  studentName?: string;
  limit?: number;
}): Promise<ClassStudentCandidate[]> {
  return http.get<ClassStudentCandidate[]>('/api/job/class-student/candidates', params);
}

/** 批量加学生进班 */
export function addClassStudents(payload: ClassStudentAddPayload): Promise<{ addedCount: number }> {
  return http.post<{ addedCount: number }>('/api/job/class-student/add', payload);
}

/** 批量移出班级 */
export function removeClassStudents(
  payload: ClassStudentRemovePayload,
): Promise<{ removedCount: number }> {
  return http.post<{ removedCount: number }>('/api/job/class-student/remove', payload);
}

/* ============ 三、出勤管理 ============ */

/** 取考勤登记板（某班某天） */
export function fetchAttendanceBoard(params: {
  classId: string;
  attendDate: string;
}): Promise<AttendanceBoard> {
  return http.get<AttendanceBoard>('/api/job/attendance/board', params);
}

/** ★ 出勤详情（某班某天逐人明细，点「详情」用） */
export function fetchAttendanceDetail(params: {
  classId: string;
  attendDate: string;
}): Promise<AttendanceDetail> {
  return http.get<AttendanceDetail>('/api/job/attendance/detail', params);
}

/** 保存考勤（批量） */
export function saveAttendance(payload: AttendanceSavePayload): Promise<AttendanceSaveResult> {
  return http.post<AttendanceSaveResult>('/api/job/attendance/save', payload);
}

/** 出勤记录列表 */
export function fetchAttendanceList(query: AttendanceQuery): Promise<PageData<Attendance>> {
  return http.get<PageData<Attendance>>('/api/job/attendance/page', query);
}

/** 班级每日出勤汇总 */
export function fetchAttendanceSummary(
  query: AttendanceSummaryQuery,
): Promise<PageData<AttendanceSummary>> {
  return http.get<PageData<AttendanceSummary>>('/api/job/attendance/summary', query);
}

/* ============ 四、班级交接（换班交接） ============ */

/** 交接记录列表 */
export function fetchTransferList(
  query: ClassTransferQuery,
): Promise<PageData<ClassTransferListItem>> {
  return http.get<PageData<ClassTransferListItem>>('/api/job/class-transfer/page', query);
}

/** 交接记录详情（含学生名单快照） */
export function fetchTransferDetail(id: string): Promise<ClassTransfer> {
  return http.get<ClassTransfer>('/api/job/class-transfer/detail', { id });
}

/** 交接预览：看当前负责人 + 在班人数 + 累计出勤率 + 学生名单 */
export function fetchTransferPreview(classId: string): Promise<ClassTransferPreview> {
  return http.get<ClassTransferPreview>('/api/job/class-transfer/preview', { classId });
}

/** 某班交接历史 */
export function fetchTransferHistory(classId: string): Promise<ClassTransfer[]> {
  return http.get<ClassTransfer[]>('/api/job/class-transfer/history', { classId });
}

/** 教师下拉选项（数据将来来自权限管理 8006） */
export function fetchTeacherOptions(role?: string): Promise<TeacherOption[]> {
  return http.get<TeacherOption[]>('/api/job/class-transfer/teacher-options', { role });
}

/** 执行交接 */
export function doTransfer(payload: ClassTransferPayload): Promise<ClassTransferResult> {
  return http.post<ClassTransferResult>('/api/job/class-transfer/do', payload);
}

/** 删除交接记录（逻辑删，不会回滚班级负责人） */
export function deleteTransfer(id: string): Promise<null> {
  return http.delete<null>(`/api/job/class-transfer/delete/${id}`);
}
