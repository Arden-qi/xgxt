/**
 * 催费管理 接口响应类型
 */

import type {
  FeeCallListItem,
  FeeCallDetail,
  FeeCallSummary,
  FeeCallStudentOption,
} from '../feeCall.js';

/** 列表响应 */
export interface FeeCallListResp {
  list: FeeCallListItem[];
  total: number;
  page: number;
  size: number;
}

/** 详情响应 */
export type FeeCallDetailResp = FeeCallDetail;

/** 新建响应 */
export interface FeeCallSaveResp {
  id: string;
  callNo: string;
}

/** 统计卡片 */
export type FeeCallSummaryResp = FeeCallSummary;

/** 可选学生 */
export type FeeCallStudentOptionResp = FeeCallStudentOption;
