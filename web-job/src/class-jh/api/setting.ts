/**
 * 系统设置 / 阶段字典 / 阶段方案 / 操作日志 接口调用
 */

import { http } from './request';
import type {
  PageData,
  ClassSetting,
  StageDict,
  StageListQuery,
  StageSavePayload,
  OpLog,
  OpLogListQuery,
} from 'shared-types/class-jh';

/* ---------------- 系统设置 ---------------- */

/** 设置详情（KV，缺失补默认） */
export function fetchSettingDetail(): Promise<ClassSetting[]> {
  return http.get<ClassSetting[]>('/api/class-jh/setting/detail');
}

/** 设置修改（KV 覆盖） */
export function updateSetting(payload: Record<string, string | number | boolean>): Promise<null> {
  return http.put<null>('/api/class-jh/setting/update', payload);
}

/* ---------------- 阶段字典 ---------------- */

/** 阶段列表 */
export function fetchStageList(query?: StageListQuery): Promise<StageDict[]> {
  return http.get<StageDict[]>('/api/class-jh/stage/list', query);
}

/** 阶段新增 */
export function addStage(payload: StageSavePayload): Promise<{ id: string }> {
  return http.post<{ id: string }>('/api/class-jh/stage/add', payload);
}

/** 阶段删除 */
export function deleteStage(id: string): Promise<null> {
  return http.delete<null>(`/api/class-jh/stage/delete/${id}`);
}

/* ---------------- 阶段方案 ----------------
 *
 * ★ 2026-10-20 去重：以前这里调 /api/class-jh/stage-scheme/*，那套接口读的是
 *   t_class_stage_scheme / t_class_stage_scheme_stage —— 这两张表从未建过（迁移
 *   未执行），页面一打开就弹「数据表不存在」。
 *   现在统一走 /api/class-jh/stage/plan/*（t_class_stage_plan + t_class_stage），
 *   与班级 / 学生表单用的「阶段方案」是同一份数据。
 */

/** 方案里的一个阶段 */
export interface StagePlanPhase {
  id: string;
  /** 阶段编码（初高 1xx / 大学 2xx / 就业 3xx） */
  stageCode: number;
  stageName: string;
  /** 学制月数 */
  studyMonths: number | null;
  sortNo: number;
}

/** 阶段方案 = 方案名称 + 所属部门 + N 个阶段 */
export interface StagePlan {
  id: string;
  planName: string;
  deptCode: number;
  deptName?: string;
  sortNo?: number;
  phases: StagePlanPhase[];
}

/** 新增 / 修改入参（修改时 id 一起放在 body 里） */
export interface StagePlanSavePayload {
  id?: string;
  planName: string;
  deptCode: number;
  phases: Array<{ id?: string; stageName: string; studyMonths?: number }>;
}

/** 阶段方案列表（含阶段明细） */
export function fetchStagePlanList(): Promise<StagePlan[]> {
  return http.get<StagePlan[]>('/api/class-jh/stage/plan/list');
}

/** 阶段方案新增 */
export function addStagePlan(payload: StagePlanSavePayload): Promise<{ id: string }> {
  return http.post<{ id: string }>('/api/class-jh/stage/plan/add', payload);
}

/** 阶段方案修改（阶段明细整体覆盖；id 在 body 里） */
export function updateStagePlan(payload: StagePlanSavePayload & { id: string }): Promise<{ id: string }> {
  return http.put<{ id: string }>('/api/class-jh/stage/plan/update', payload);
}

/** 阶段方案删除（被班级 / 学生使用时后端会拒绝） */
export function deleteStagePlan(id: string): Promise<null> {
  return http.delete<null>(`/api/class-jh/stage/plan/delete/${id}`);
}

/* ---------------- 操作日志 ---------------- */

/** 操作日志列表 */
export function fetchOpLogList(query: OpLogListQuery): Promise<PageData<OpLog>> {
  return http.get<PageData<OpLog>>('/api/class-jh/opLog/list', query);
}
