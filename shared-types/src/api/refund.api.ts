/**
 * 退费接口的响应类型
 *
 * 命名约定：xxxResp = 该接口 data 里的类型
 */

import type { PageData } from '../common.js';
import type { Refund, RefundListItem, RefundDetail } from '../refund.js';

/** 退费列表 */
export type RefundListResp = PageData<RefundListItem>;

/** 退费详情（含审批轨迹） */
export type RefundDetailResp = RefundDetail;

/** 新建/编辑退费返回 */
export type RefundSaveResp = Refund;

/** 审批动作（同意/驳回/撤回）返回 */
export interface ApprovalActionResult {
  approvalStatus: number;
  approvalStatusName: string;
  /** 当前处理人提示 */
  currentHandlerHint?: string;
  /** 操作结果提示文字 */
  message?: string;
}
