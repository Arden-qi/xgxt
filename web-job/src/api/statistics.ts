/**
 * 数据统计接口（数据统计）
 */

import { http } from './request';
import type { JobOverview, KpiTarget, DistributionItem, TrendItem } from 'shared-types';

/** 核心指标总览：就业人数 / offer / 就业率 / 平均投递 / kpi */
export function fetchOverview(): Promise<JobOverview> {
  return http.get<JobOverview>('/api/job/statistics/overview');
}

/** 月度趋势 */
export function fetchTrend(months = 6): Promise<TrendItem[]> {
  return http.get<TrendItem[]>('/api/job/statistics/trend', { months });
}

/** 部门就业分布 */
export function fetchDeptDistribution(): Promise<DistributionItem[]> {
  return http.get<DistributionItem[]>('/api/job/statistics/dept-distribution');
}

/** 学生状态分布 */
export function fetchStatusDistribution(): Promise<DistributionItem[]> {
  return http.get<DistributionItem[]>('/api/job/statistics/status-distribution');
}

/** 班级就业 TOP */
export function fetchClassTop(limit = 10): Promise<DistributionItem[]> {
  return http.get<DistributionItem[]>('/api/job/statistics/class-top', { limit });
}

/** KPI 目标 */
export function fetchKpiTarget(): Promise<KpiTarget> {
  return http.get<KpiTarget>('/api/job/statistics/kpi-target');
}

/** 保存 KPI 目标 */
export function saveKpiTarget(payload: {
  targetRate: number;
  targetOffer: number;
  targetResume: number;
}): Promise<null> {
  return http.put<null>('/api/job/statistics/kpi-target', payload);
}
