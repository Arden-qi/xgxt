/**
 * 接口契约：系统设置 / 阶段字典 / 操作日志 / 工作台
 *
 * 路径前缀：/api/class/setting、/api/class/stage、/api/class/opLog、/api/class/dashboard
 */

import { ApiResponse, PageResponse } from '../common';
import { ClassSetting, StageDict, StagePlan, StagePlanPhase, OpLog, DashboardStat } from '../class';

/* ---------------- 系统设置 ---------------- */

/** 设置详情响应 */
export type SettingDetailResponse = ApiResponse<ClassSetting[]>;

/** 设置修改入参（KV 覆盖） */
export type SettingUpdatePayload = Record<string, string | number | boolean>;

/** 设置修改响应 */
export type SettingUpdateResponse = ApiResponse<null>;

/* ---------------- 阶段字典 ---------------- */

/** 阶段列表查询参数 */
export interface StageListQuery {
  deptCode?: number;
}

/** 阶段列表响应 */
export type StageDictListResponse = ApiResponse<StageDict[]>;

/** 阶段新增入参 */
export interface StageSavePayload {
  stageCode: number;
  stageName: string;
  deptCode: number;
  studyMonths?: number;
  sortNo?: number;
}

/** 阶段新增响应 */
export type StageAddResponse = ApiResponse<{ id: string }>;

/** 阶段删除响应 */
export type StageDeleteResponse = ApiResponse<null>;

/* ---------- ★ 2026-10-16 阶段方案（原阶段字典页改版） ---------- */

/** 方案列表查询参数 */
export interface StagePlanListQuery {
  deptCode?: number;
}

/** 方案列表响应（含阶段明细） */
export type StagePlanListResponse = ApiResponse<StagePlan[]>;

/** 方案保存入参（新增 / 编辑共用；编辑时带 id） */
export interface StagePlanSavePayload {
  /** 编辑时必传 */
  id?: string;
  planName: string;
  deptCode: number;
  /** 阶段明细（至少一条） */
  phases: StagePlanPhase[];
}

/** 方案新增响应 */
export type StagePlanAddResponse = ApiResponse<{ id: string }>;

/** 方案编辑响应 */
export type StagePlanUpdateResponse = ApiResponse<null>;

/** 方案删除响应 */
export type StagePlanDeleteResponse = ApiResponse<null>;

/* ---------------- 操作日志 ---------------- */

/** 操作日志列表查询参数 */
export interface OpLogListQuery {
  page?: number;
  size?: number;
  bizType?: string;
  studentId?: string;
  startDate?: string;
  endDate?: string;
}

/** 操作日志列表响应 */
export type OpLogListResponse = PageResponse<OpLog>;

/* ---------------- 工作台 ---------------- */

/** 工作台统计响应 */
export type DashboardStatResponse = ApiResponse<DashboardStat>;
