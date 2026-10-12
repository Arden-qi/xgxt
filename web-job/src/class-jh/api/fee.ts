/**
 * 催费管理接口调用
 */

import { http } from './request';
import type {
  PageData,
  FeeRecord,
  FeeListQuery,
  FeeSharePayload,
  FeeShareData,
  FeeNotify,
  FeeNotifyListQuery,
} from 'shared-types/class-jh';

/** 催费列表（含 remainDays/isUrgent） */
export function fetchFeeList(query: FeeListQuery): Promise<PageData<FeeRecord>> {
  return http.get<PageData<FeeRecord>>('/api/class-jh/fee/list', query);
}

/** 催费导出 */
export function exportFee(query: FeeListQuery): Promise<FeeRecord[]> {
  return http.get<FeeRecord[]>('/api/class-jh/fee/export', query);
}

/** 催费推送（生成可复制文案） */
export function shareFee(payload: FeeSharePayload): Promise<FeeShareData> {
  return http.post<FeeShareData>('/api/class-jh/fee/share', payload);
}

/** 催费记录列表 */
export function fetchFeeNotifyList(query: FeeNotifyListQuery): Promise<PageData<FeeNotify>> {
  return http.get<PageData<FeeNotify>>('/api/class-jh/fee/notify/list', query);
}
