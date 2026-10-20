/**
 * 接口契约：系统设置 / 阶段字典 / 操作日志 / 工作台
 *
 * 路径前缀：/api/class/setting、/api/class/stage、/api/class/opLog、/api/class/dashboard
 */

import { ApiResponse, PageResponse } from '../common';
import { ClassSetting, StageDict, OpLog, DashboardStat } from '../class';

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

/* ★ 2026-10-20：原「阶段方案（StageScheme* ）」一组类型已删除 ——
 *   它描述的是 /api/class-jh/stage-scheme/* 那套实现（t_class_stage_scheme，
 *   表从未建过）。现在全系统只有一套阶段方案：t_class_stage_plan + t_class_stage，
 *   前端类型见 web-job/src/class-jh/api/setting.ts 的 StagePlan / StagePlanSavePayload。 */

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
