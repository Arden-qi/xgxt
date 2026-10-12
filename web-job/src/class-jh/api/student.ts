/**
 * 学生主档接口调用（教学管理初高）
 *
 * 约定：http.xxx 已自动解包 data，故返回类型写「data 里的类型」。
 * 类型全部从 shared-types 引入（编译期即可发现字段写错）。
 */

import { http } from './request';
import type {
  PageData,
  StudentListItem,
  StudentDetail,
  StudentListQuery,
  StudentSavePayload,
  StudentSuspendPayload,
  StudentResumePayload,
  StudentQuitPayload,
  StudentRepeatPayload,
  StudentTransferPayload,
} from 'shared-types/class-jh';

/** 查询学生列表 */
export function fetchStudentList(query: StudentListQuery): Promise<PageData<StudentListItem>> {
  return http.get<PageData<StudentListItem>>('/api/class-jh/student/list', query);
}

/** 查询学生详情（含 7 页签） */
export function fetchStudentDetail(id: string): Promise<StudentDetail> {
  return http.get<StudentDetail>('/api/class-jh/student/detail', { id });
}

/** 导出学生（不分页，前端转 CSV） */
export function fetchStudentExport(query: StudentListQuery): Promise<StudentListItem[]> {
  return http.get<StudentListItem[]>('/api/class-jh/student/export', query);
}

/** 学生新增/编辑入参超集（新增时 id 可空、学号可由后端生成） */
type StudentSavePayloadSuperset = StudentSavePayload & {
  id: string;
  studentNo?: string;
  deptCode?: number;
  classId?: string;
  stage?: number;
  studentStatus?: number;
};

/** 新增学生（学号可由后端生成） */
export function addStudent(payload: StudentSavePayloadSuperset): Promise<{ id: string }> {
  return http.post<{ id: string }>('/api/class-jh/student/add', payload);
}

/** 修改学生 */
export function updateStudent(payload: StudentSavePayloadSuperset): Promise<null> {
  return http.put<null>('/api/class-jh/student/update', payload);
}

/** 删除学生（逻辑删除） */
export function deleteStudent(id: string): Promise<null> {
  return http.delete<null>(`/api/class-jh/student/delete/${id}`);
}

/** 休学申请 */
export function suspendStudent(payload: StudentSuspendPayload): Promise<{ flowId: string }> {
  return http.post<{ flowId: string }>('/api/class-jh/student/suspend', payload);
}

/** 复学申请 */
export function resumeStudent(payload: StudentResumePayload): Promise<{ flowId: string }> {
  return http.post<{ flowId: string }>('/api/class-jh/student/resume', payload);
}

/** 退学申请 */
export function quitStudent(payload: StudentQuitPayload): Promise<{ flowId: string }> {
  return http.post<{ flowId: string }>('/api/class-jh/student/quit', payload);
}

/** 末班申请（改走审批流：创建流程，审批通过后生效） */
export function repeatStudent(payload: StudentRepeatPayload): Promise<{ flowId: string }> {
  return http.post<{ flowId: string }>('/api/class-jh/student/repeat', payload);
}

/** 转班申请 */
export function transferStudent(payload: StudentTransferPayload): Promise<{ flowId: string }> {
  return http.post<{ flowId: string }>('/api/class-jh/student/transfer', payload);
}

/* ============================================================
 * ★ 2026-10-05 升学（基础数据操作流程）
 *   在读学生 → 升入大学部指定开放班级的「待接收学员」，
 *   大学部班主任「同意接收」后学生信息进入对应班级。
 * ============================================================ */

/** 升学：推送到大学部「待接收学员」（幂等：按初高学号去重） */
export function promoteStudent(
  id: string,
  targetClassId: string,
  remark?: string,
): Promise<{ inserted: number; skipped: number }> {
  return http.post<{ inserted: number; skipped: number }>('/api/class-jh/student/promote', {
    id,
    targetClassId,
    remark,
  });
}
