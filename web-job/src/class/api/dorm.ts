import { get, post } from './request';
import type { BedListResult } from './types';

/** 宿舍床位接口（前缀 /api/class/dorm） */

/** 床位明细：某宿舍全部床位 + 未分配学员 */
export function bedList(params: { dormId: string }) {
  return get<BedListResult>('/api/class/dorm/bed/list', params as Record<string, unknown>);
}

/** 退宿：释放该学员床位 */
export function bedOut(payload: { studentId: string }) {
  return post<{ studentId: string }>('/api/class/dorm/bed/out', payload);
}
