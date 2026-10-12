/**
 * 学生管理接口调用（示例 —— 各模块照着这个改）
 *
 * ⚠️ 要点：
 *   1. 路径和《接口契约规范》完全一致
 *   2. 返回类型从 shared-types 里引，这样字段写错会编译报错
 *   3. 返回类型写的是「data 里的类型」（因为 http.xxx 已经帮你解包了）
 *      例：列表接口返回 { total, page, size, list }，所以写 PageData<StudentListItem>
 */

import { http, raw } from '../request';
import type {
  ApiResponse,
  PageData,
  StudentListItem,
  Student,
  StudentQuery,
  StudentSavePayload,
  StudentStats,
} from 'shared-types/edu';

/** 查询学生列表 */
export function fetchStudentList(query: StudentQuery): Promise<PageData<StudentListItem>> {
  return http.get<PageData<StudentListItem>>('/api/edu/student/list', query);
}

/** 查询统计卡数据（总人数 / 在读 / 试学中 / 休学退学） */
export function fetchStudentStats(deptCode?: number): Promise<StudentStats> {
  return http.get<StudentStats>('/api/edu/student/stats', { deptCode });
}

/**
 * 班级下拉选项（★ 2026-10-04 新增，替掉前端写死的 Q16~Q23）
 *
 * 后端把三个来源（教务 / 大学 sms_class / 实训 sms_job）的班级名合并去重，
 * 所以新建班、改阶段后刷新页面就能选到，不用改代码。
 */
export function fetchStudentClassOptions(deptCode?: number): Promise<string[]> {
  return http.get<string[]>('/api/edu/student/class-options', { deptCode });
}

/** 查询学生详情 */
export function fetchStudentDetail(id: string): Promise<Student> {
  return http.get<Student>('/api/edu/student/detail', { id });
}

/** 新增学生 */
export function addStudent(payload: StudentSavePayload): Promise<{ id: string }> {
  return http.post<{ id: string }>('/api/edu/student/add', payload);
}

/** 修改学生 */
/**
 * 修改学生
 *
 * ⚠️ 这里返回后端 message 而不是 data —— 改成休学/退学时，后端会在 message 里带上
 *    「已同步冻结 N 条缴费记录」，所以要用 raw 拿完整响应（http.put 会把外层剥掉）。
 */
export async function updateStudent(payload: StudentSavePayload & { id: string }): Promise<string> {
  const res = await raw.put<ApiResponse<null>>('/api/edu/student/update', payload);
  return res.data.message || '修改成功';
}

/** 删除学生（逻辑删除） */
export function deleteStudent(id: string): Promise<null> {
  return http.delete<null>(`/api/edu/student/delete/${id}`);
}

/* ============================================================
 * 导入
 * ============================================================ */

/** 导入结果里，失败行的明细 */
export interface ImportFailure {
  row: number;
  studentNo: string;
  reason: string;
}

export interface ImportResult {
  successCount: number;
  failCount: number;
  failures: ImportFailure[];
}

/** 上传 Excel/CSV 批量导入学生 */
export function importStudents(file: File): Promise<ImportResult> {
  const form = new FormData();
  form.append('file', file);
  return http.post<ImportResult>('/api/edu/student/import', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000, // 大文件解析慢，单给 60 秒
  });
}

/**
 * 导入模板下载地址
 *
 * ⚠️ 这里用直接的链接而不是 axios —— 模板接口返回的是二进制 xlsx，
 *    走 axios 会被响应拦截器当成 JSON 解析而报错。
 */
export const IMPORT_TEMPLATE_URL = '/api/edu/student/import-template';
