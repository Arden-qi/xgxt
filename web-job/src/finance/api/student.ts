/**
 * 学生管理接口调用（示例 —— 各模块照着这个改）
 *
 * ⚠️ 要点：
 *   1. 路径和《接口契约规范》完全一致
 *   2. 返回类型从 shared-types 里引，这样字段写错会编译报错
 *   3. 返回类型写的是「data 里的类型」（因为 http.xxx 已经帮你解包了）
 *      例：列表接口返回 { total, page, size, list }，所以写 PageData<StudentListItem>
 */

import { http } from './request';
import type {
  PageData,
  StudentListItem,
  Student,
  StudentQuery,
  StudentSavePayload,
} from 'shared-types/finance';

/** 查询学生列表 */
export function fetchStudentList(query: StudentQuery): Promise<PageData<StudentListItem>> {
  return http.get<PageData<StudentListItem>>('/api/finance/student/list', query);
}

/** 查询学生详情 */
export function fetchStudentDetail(id: string): Promise<Student> {
  return http.get<Student>('/api/finance/student/detail', { id });
}

/** 新增学生 */
export function addStudent(payload: StudentSavePayload): Promise<{ id: string }> {
  return http.post<{ id: string }>('/api/finance/student/add', payload);
}

/** 修改学生 */
export function updateStudent(payload: StudentSavePayload & { id: string }): Promise<null> {
  return http.put<null>('/api/finance/student/update', payload);
}

/** 删除学生（逻辑删除） */
export function deleteStudent(id: string): Promise<null> {
  return http.delete<null>(`/api/finance/student/delete/${id}`);
}
