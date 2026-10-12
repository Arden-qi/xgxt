/**
 * 班级信息管理 —— 本班学生详细名单（斌哥 2026-09-30 大改）
 *
 * ⚠️ 路径与后端 /api/job/class-info 完全一致
 */
import { http } from './request';
import type {
  PageData,
  ClassInfoStudent,
  ClassInfoStudentQuery,
  ClassInfoSummary,
  MyClassItem,
  ClassInfoFeeRecords,
  ClassInfoDetail,
  ClassInfoUpdatePayload,
} from 'shared-types';

/** 我带的班（正常 0 或 1 条） */
export function fetchMyClasses(): Promise<MyClassItem[]> {
  return http.get<MyClassItem[]>('/api/job/class-info/my-class');
}

/** 本班学生详细名单 */
export function fetchClassInfoStudents(
  params?: ClassInfoStudentQuery,
): Promise<PageData<ClassInfoStudent>> {
  return http.get<PageData<ClassInfoStudent>>('/api/job/class-info/students', params);
}

/** 顶部 4 个统计卡片 */
export function fetchClassInfoSummary(classId?: string): Promise<ClassInfoSummary> {
  return http.get<ClassInfoSummary>('/api/job/class-info/summary', { classId });
}

/** 缴费记录（跨模块调财务 8005；未接入时 available=false，前端显示提示） */
export function fetchFeeRecords(studentId: string): Promise<ClassInfoFeeRecords> {
  return http.get<ClassInfoFeeRecords>('/api/job/class-info/fee-records', { studentId });
}

/**
 * 学生档案详情（「详情」弹窗的 6 个 Tab 一次拉全）
 *
 * 返回：基础信息 / 市场信息 / 末班 / 宿舍 / 考试信息 / 班级信息
 */
export function fetchClassInfoDetail(studentId: string): Promise<ClassInfoDetail> {
  return http.get<ClassInfoDetail>('/api/job/class-info/detail', { studentId });
}

/**
 * 修改学生
 *
 * ⚠️ 学号 / 学生状态 / 宿舍 / 班级 / 入学日期 / 末班次数 都不走这里 —— 各有各的流程
 *    （学号=入学定，状态=休退学审批，宿舍=宿舍模块，班级=交接，末班次数=成绩管理）
 */
export function updateClassInfoStudent(payload: ClassInfoUpdatePayload): Promise<null> {
  return http.post<null>('/api/job/class-info/update-student', payload);
}
