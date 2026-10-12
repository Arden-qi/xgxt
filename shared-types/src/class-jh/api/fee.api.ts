/**
 * 接口契约：催费管理
 *
 * 路径前缀：/api/class/fee
 */

import { ApiResponse, PageResponse } from '../common';
import { FeeRecord, FeeNotify } from '../class';
import { FeeType, PayStatus, ShareChannel } from '../enums';

/* ---------------- 缴费台账 ---------------- */

/** 催费列表查询参数 */
export interface FeeListQuery {
  page?: number;
  size?: number;
  classId?: string;
  feeType?: FeeType;
  payStatus?: PayStatus;
  startDate?: string;
  endDate?: string;
  isUrgent?: boolean;
  keyword?: string;
}

/** 催费列表响应 */
export type FeeListResponse = PageResponse<FeeRecord>;

/** 催费导出响应 */
export type FeeExportResponse = ApiResponse<FeeRecord[]>;

/* ---------------- 催费推送 ---------------- */

/** 催费分享入参 */
export interface FeeSharePayload {
  studentId: string;
  feeType: FeeType;
  shareChannel: ShareChannel;
  remark?: string;
}

/** 催费分享响应（含可复制文案） */
export interface FeeShareData {
  notifyId: string;
  shareText: string;
}
export type FeeShareResponse = ApiResponse<FeeShareData>;

/* ---------------- 催费记录 ---------------- */

/** 催费记录列表查询参数 */
export interface FeeNotifyListQuery {
  page?: number;
  size?: number;
  studentId?: string;
}

/** 催费记录列表响应 */
export type FeeNotifyListResponse = PageResponse<FeeNotify>;
