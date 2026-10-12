/**
 * 学生基础信息接口（信息档案 - 基础信息）
 *
 * ⚠️ 学生列表接口被很多地方复用：信息档案列表、日志/复盘的学生选择器、
 *    宿舍分配的待分配名单。所以查询条件统一放在 StudentQuery 里。
 */

import { http } from './request';
import type {
  PageData,
  StudentListItem,
  Student,
  StudentQuery,
  StudentSavePayload,
} from 'shared-types';

/** 查询学生列表（支持 unassigned：只看未分配宿舍的） */
export function fetchStudentList(query: Partial<StudentQuery>): Promise<PageData<StudentListItem>> {
  return http.get<PageData<StudentListItem>>('/api/job/student/list', query);
}

/** 查询学生详情（含简历内容） */
export function fetchStudentDetail(id: string): Promise<Student> {
  return http.get<Student>('/api/job/student/detail', { id });
}

/** 新增学生 */
export function addStudent(payload: StudentSavePayload): Promise<{ id: string }> {
  return http.post<{ id: string }>('/api/job/student/add', payload);
}

/** 修改学生 */
export function updateStudent(payload: StudentSavePayload & { id: string }): Promise<null> {
  return http.put<null>('/api/job/student/update', payload);
}

/** 删除学生（逻辑删除） */
export function deleteStudent(id: string): Promise<null> {
  return http.delete<null>(`/api/job/student/delete/${id}`);
}

/** 「确认就业」的入参 */
export interface ConfirmEmploymentPayload {
  studentId: string;
  /** 入职日期 YYYY-MM-DD（必填） */
  hireDate: string;
  /** 就业单位 */
  company?: string;
  /** 岗位 */
  position?: string;
  /** 薪资（元/月） */
  salary?: number;
  remark?: string;
}

/**
 * ★ 2026-10-02 新增：确认就业（**待就业(9) → 已就业(10)**）
 *
 * 【为什么需要】
 *   此前**全模块没有任何地方能写入「已就业」**（只有读），
 *   所以「数据统计」里的就业人数 / 就业率**永远是 0**。
 *
 * 【谁会调到它】
 *   ① 学员档案弹窗里的「确认就业」按钮（手工入口）
 *   ② 复盘填写时选了「已签约入职」→ 弹窗确认后调（顺手入口）
 *
 * 【谁能调】就业老师 / 校长 / 学管主任（后端有角色白名单，其它角色返回 40302）
 * 【副作用】后端会顺手写一条就业日志（单位/岗位/薪资/入职日期）
 */
export function confirmEmployment(payload: ConfirmEmploymentPayload): Promise<null> {
  return http.post<null>('/api/job/student/confirm-employment', payload);
}

/**
 * 学生下拉选择器用：按姓名关键字搜，最多 30 条
 * ⚠️ 日志/复盘表单都要选学生，抽一个函数避免每个页面写一遍
 */
export function searchStudents(keyword: string): Promise<PageData<StudentListItem>> {
  return http.get<PageData<StudentListItem>>('/api/job/student/list', {
    page: 1,
    size: 30,
    keyword,
  });
}
