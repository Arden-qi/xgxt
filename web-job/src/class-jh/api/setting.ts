/**
 * 系统设置 / 阶段方案 / 操作日志 接口调用
 *
 * ★ 2026-10-22：删除「阶段字典」三个包装（fetchStageList / addStage / deleteStage）。
 *   「系统设置 → 阶段设置」页签早已撤掉，阶段（名称 / 学制 / 编码）现在统一在
 *   「班级管理 → 阶段方案设计」里维护，对应下面的 stage-scheme 接口；
 *   后端 /api/class-jh/stage/* 也已整套删除。
 */

import { http } from './request';
import type {
  PageData,
  ClassSetting,
  StageScheme,
  StageSchemeListQuery,
  StageSchemeSavePayload,
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

/* ---------------- 阶段方案（方案 + 多阶段，阶段编码由后端分配） ---------------- */

/** 阶段方案列表（含阶段明细） */
export function fetchStageSchemeList(query?: StageSchemeListQuery): Promise<StageScheme[]> {
  return http.get<StageScheme[]>('/api/class-jh/stage-scheme/list', query);
}

/** 阶段方案新增 */
export function addStageScheme(payload: StageSchemeSavePayload): Promise<{ id: string }> {
  return http.post<{ id: string }>('/api/class-jh/stage-scheme/add', payload);
}

/** 阶段方案修改（阶段明细整体覆盖） */
export function updateStageScheme(id: string, payload: StageSchemeSavePayload): Promise<{ id: string }> {
  return http.put<{ id: string }>(`/api/class-jh/stage-scheme/update/${id}`, payload);
}

/** 阶段方案删除（被班级使用时后端会拒绝） */
export function deleteStageScheme(id: string): Promise<null> {
  return http.delete<null>(`/api/class-jh/stage-scheme/delete/${id}`);
}

/* ---------------- 操作日志 ---------------- */

/** 操作日志列表 */
export function fetchOpLogList(query: OpLogListQuery): Promise<PageData<OpLog>> {
  return http.get<PageData<OpLog>>('/api/class-jh/opLog/list', query);
}
