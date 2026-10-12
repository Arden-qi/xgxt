/**
 * 工作台统计接口调用
 */

import { http } from './request';
import type { DashboardStat } from 'shared-types/class-jh';

/** 工作台 KPI + 待办 */
export function fetchDashboardStat(): Promise<DashboardStat> {
  return http.get<DashboardStat>('/api/class-jh/dashboard/stat');
}
