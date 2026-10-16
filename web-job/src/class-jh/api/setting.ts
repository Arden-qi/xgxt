/**
 * 系统设置 / 阶段字典 / 操作日志 接口调用
 */

import { http } from './request';
import type {
  PageData,
  ClassSetting,
  StageDict,
  StageListQuery,
  StageSavePayload,
  StagePlan,
  StagePlanListQuery,
  StagePlanSavePayload,
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

/* ---------------- ★ 阶段方案（一个方案含多个阶段） ---------------- */

/** 方案列表（含阶段明细） */
export function fetchStagePlanList(query?: StagePlanListQuery): Promise<StagePlan[]> {
  return http.get<StagePlan[]>('/api/class-jh/stage/plan/list', query);
}

/** 方案新增 */
export function addStagePlan(payload: StagePlanSavePayload): Promise<{ id: string }> {
  return http.post<{ id: string }>('/api/class-jh/stage/plan/add', payload);
}

/** 方案编辑 */
export function updateStagePlan(payload: StagePlanSavePayload): Promise<null> {
  return http.put<null>('/api/class-jh/stage/plan/update', payload);
}

/** 方案删除 */
export function deleteStagePlan(id: string): Promise<null> {
  return http.delete<null>(`/api/class-jh/stage/plan/delete/${id}`);
}

/* ---------------- 操作日志 ---------------- */

/** 操作日志列表 */
export function fetchOpLogList(query: OpLogListQuery): Promise<PageData<OpLog>> {
  return http.get<PageData<OpLog>>('/api/class-jh/opLog/list', query);
}
