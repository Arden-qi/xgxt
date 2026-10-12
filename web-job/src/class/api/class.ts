import { get, post } from './request';
import type { PageData, StageAdvanceResult, StageLogRow, TrainingRow, TrainingUpgradeResult } from './types';

/** 班级管理扩展接口（前缀 /api/class/info）：阶段推进、阶段日志、升实训交接 */

/** 推进阶段：已是最后阶段后端会返回业务错误（message 含「不能再推进」） */
export function stageAdvance(payload: { classId: string; reason?: string }) {
  return post<StageAdvanceResult>('/api/class/info/stage/advance', payload);
}

/** 阶段推进记录 */
export function stageLogList(params: { classId: string }) {
  return get<StageLogRow[]>('/api/class/info/stage/log', params as Record<string, unknown>);
}

/**
 * 升实训：非六阶段后端会返回业务错误（message 含「仅处于第六阶段」）
 *
 * ★ 2026-10-06：升实训弹窗要现选「项目经理 / 就业指导老师」，
 *   确认后班级会交接到【就业管理 → 班级信息管理】。
 */
export function trainingUpgrade(payload: {
  classId: string;
  remark?: string;
  projectManagerId?: string | null;
  projectManagerName?: string | null;
  employmentTeacherId?: string | null;
  employmentTeacherName?: string | null;
}) {
  return post<TrainingUpgradeResult>('/api/class/info/training/upgrade', payload);
}

/** 升实训交接记录（分页） */
export function trainingList(params: { page?: number; size?: number; classId?: string }) {
  return get<PageData<TrainingRow>>('/api/class/info/training/list', params as Record<string, unknown>);
}
