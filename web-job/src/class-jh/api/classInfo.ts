/**
 * 班级管理接口调用（班级主档 / 师资交接 / 学期）
 */

import { http } from './request';
import type {
  PageData,
  ClassInfo,
  ClassInfoDetail,
  ClassInfoListQuery,
  ClassInfoSavePayload,
  ClassInfoOptionsQuery,
  ClassHandover,
  HandoverListQuery,
  HandoverSavePayload,
  ClassTerm,
  ClassTermSavePayload,
} from 'shared-types/class-jh';

/* ---------------- 班级主档 ---------------- */

/** 班级列表 */
export function fetchClassList(query: ClassInfoListQuery): Promise<PageData<ClassInfo>> {
  return http.get<PageData<ClassInfo>>('/api/class-jh/classInfo/list', query);
}

/** 班级详情（含交接历史 + 学期 + 学生） */
export function fetchClassDetail(id: string): Promise<ClassInfoDetail> {
  return http.get<ClassInfoDetail>('/api/class-jh/classInfo/detail', { id });
}

/** 新增班级 */
export function addClass(payload: ClassInfoSavePayload): Promise<{ id: string }> {
  return http.post<{ id: string }>('/api/class-jh/classInfo/add', payload);
}

/** 修改班级（含状态流转） */
export function updateClass(payload: ClassInfoSavePayload & { id: string }): Promise<null> {
  return http.put<null>('/api/class-jh/classInfo/update', payload);
}

/** 删除班级（逻辑删除） */
export function deleteClass(id: string): Promise<null> {
  return http.delete<null>(`/api/class-jh/classInfo/delete/${id}`);
}

/** 班级下拉选项（转班/复学/末班用） */
export function fetchClassOptions(query?: ClassInfoOptionsQuery): Promise<ClassInfo[]> {
  return http.get<ClassInfo[]>('/api/class-jh/classInfo/options', query);
}

/* ============================================================
 * ★ 2026-10-05 升学目标（大学部开放班级）
 *   初高「升学」弹窗选择要升入的大学部班级；后端经内部通道代理拉取。
 * ============================================================ */

export interface UpgradeTargetItem {
  id: string;
  className: string;
  stage?: number;
  stageName?: string;
  classStatusName?: string;
  headTeacherName?: string | null;
  studentCount?: number;
}
export function fetchUpgradeTargets(): Promise<UpgradeTargetItem[]> {
  return http.get<UpgradeTargetItem[]>('/api/class-jh/classInfo/upgrade-targets');
}

/* ---------------- 师资交接 ---------------- */

/** 交接列表 */
export function fetchHandoverList(query: HandoverListQuery): Promise<PageData<ClassHandover>> {
  return http.get<PageData<ClassHandover>>('/api/class-jh/handover/list', query);
}

/** 新增交接 */
export function addHandover(payload: HandoverSavePayload): Promise<{ id: string }> {
  return http.post<{ id: string }>('/api/class-jh/handover/add', payload);
}

/* ---------------- 学期 ---------------- */

/** 学期列表 */
export function fetchTermList(classId: string): Promise<ClassTerm[]> {
  return http.get<ClassTerm[]>('/api/class-jh/term/list', { classId });
}

/** 新增学期 */
export function addTerm(payload: ClassTermSavePayload): Promise<{ id: string }> {
  return http.post<{ id: string }>('/api/class-jh/term/add', payload);
}
