/**
 * 宿舍分配接口（信息档案 - 宿舍分配）
 */

import { http } from './request';
import type { PageData, Dorm, DormMember, EmpDormQuery, DormSavePayload, StudentListItem } from 'shared-types';

/** 宿舍列表 */
export function fetchDormList(query: Partial<EmpDormQuery>): Promise<PageData<Dorm>> {
  return http.get<PageData<Dorm>>('/api/job/emp-dorm/list', query);
}

/** 宿舍详情 */
export function fetchDormDetail(id: string): Promise<Dorm> {
  return http.get<Dorm>('/api/job/emp-dorm/detail', { id });
}

/** 宿舍成员 */
export function fetchDormMembers(dormId: string): Promise<DormMember[]> {
  return http.get<DormMember[]>('/api/job/emp-dorm/members', { dormId });
}

/** 待分配宿舍的学生 */
export function fetchUnassignedStudents(params: {
  page?: number;
  size?: number;
  studentName?: string;
  gender?: number;
}): Promise<PageData<StudentListItem & { gender: number }>> {
  return http.get<PageData<any>>('/api/job/emp-dorm/unassigned-students', params) as any;
}

/** 新增宿舍 */
export function addDorm(payload: DormSavePayload): Promise<{ id: string }> {
  return http.post<{ id: string }>('/api/job/emp-dorm/add', payload);
}

/** 修改宿舍 */
export function updateDorm(payload: DormSavePayload & { id: string }): Promise<null> {
  return http.put<null>('/api/job/emp-dorm/update', payload);
}

/** 删除宿舍 */
export function deleteDorm(id: string): Promise<null> {
  return http.delete<null>(`/api/job/dorm/delete/${id}`);
}

/** 分配宿舍（也用于调整宿舍） */
export function assignDorm(studentId: string, dormId: string): Promise<null> {
  return http.post<null>('/api/job/emp-dorm/assign', { studentId, dormId });
}

/** 退宿 */
export function checkoutDorm(studentId: string): Promise<null> {
  return http.post<null>('/api/job/emp-dorm/checkout', { studentId });
}
