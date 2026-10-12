/**
 * 市场咨询模块 · 接口契约
 *
 * 提供方：登录 + 市场咨询（王寒逸 / 现由周铭代为实现）
 * 端口：8001 ｜ 前缀：/api/consult
 *
 * ⚠️ 联动说明（与财务模块 8005）：
 *    ① 建费用单前，本模块调 财务 GET  /api/finance/standard/get  取金额（规则2）
 *    ② 建费用单，调        财务 POST /api/finance/fee/add        建单（sourceModule=1）
 *    ③ 状态变更，调        财务 POST /api/finance/freeze/sync     同步学籍（规则1）
 *    ④ 退费上报，调        财务 POST /api/finance/refund/apply    上报退费单
 */

import { ApiResponse, PageResponse } from '../common';
import {
  ConsultStudent,
  ConsultStudentListItem,
  ConsultFeeOrder,
  ConsultFeeCreateResult,
  ConsultFeeStats,
  ConsultRefundOrder,
  ConsultRefundStats,
  ConsultRefundCalcResult,
  ConsultAccount,
  ConsultAccountStats,
  ConsultLoginResult,
  ApproveCenterData,
  LossRecordItem,
  LossStats,
  FinanceStandardView,
  FinanceStandardBatchResult,
} from '../consult';

/* ============================================================
 * 一、登录 / 账号
 * ============================================================ */

/** 登录 */
export type ConsultLoginResponse = ApiResponse<ConsultLoginResult>;

/** 当前登录用户信息 */
export type ConsultProfileResponse = ApiResponse<ConsultAccount>;

/** 账号列表 */
export type ConsultAccountListResponse = PageResponse<ConsultAccount>;

/** 账号统计 */
export type ConsultAccountStatsResponse = ApiResponse<ConsultAccountStats>;

/** 账号新增/编辑 */
export type ConsultAccountSaveResponse = ApiResponse<{ accountId: string }>;

/* ============================================================
 * 二、学生管理
 * ============================================================ */

/** 学生列表 */
export type ConsultStudentListResponse = PageResponse<ConsultStudentListItem>;

/** 学生详情 */
export type ConsultStudentDetailResponse = ApiResponse<ConsultStudent>;

/** 新增学生 */
export type ConsultStudentAddResponse = ApiResponse<{ consultStudentId: string }>;

/** 完善档案 */
export type ConsultStudentExtraResponse = ApiResponse<null>;

/** 分配咨询老师 */
export type ConsultAssignResponse = ApiResponse<null>;

/** 面试结果 */
export type ConsultInterviewResponse = ApiResponse<null>;

/** 分配班级 */
export type ConsultAssignClassResponse = ApiResponse<null>;

/** 记录流失 */
export type ConsultLossResponse = ApiResponse<null>;

/* ============================================================
 * 三、收款与缴费
 * ============================================================ */

/** 收款单列表 */
export type ConsultFeeListResponse = PageResponse<ConsultFeeOrder>;

/** 收款单详情 */
export type ConsultFeeDetailResponse = ApiResponse<ConsultFeeOrder>;

/** 发起收费 */
export type ConsultFeeCreateResponse = ApiResponse<ConsultFeeCreateResult>;

/** 收款统计 */
export type ConsultFeeStatsResponse = ApiResponse<ConsultFeeStats>;

/** 上传凭证 */
export type ConsultVoucherUploadResponse = ApiResponse<null>;

/** 重新提交（被驳回后） */
export type ConsultFeeResubmitResponse = ApiResponse<null>;

/* ============================================================
 * 四、退费管理
 * ============================================================ */

/** 退费列表 */
export type ConsultRefundListResponse = PageResponse<ConsultRefundOrder>;

/** 退费详情 */
export type ConsultRefundDetailResponse = ApiResponse<ConsultRefundOrder>;

/** 退费试算 */
export type ConsultRefundCalcResponse = ApiResponse<ConsultRefundCalcResult>;

/** 申请退费 */
export type ConsultRefundApplyResponse = ApiResponse<{ refundId: string; refundNo: string }>;

/** 经理审批通过 */
export type ConsultRefundApproveResponse = ApiResponse<null>;

/** 经理驳回 */
export type ConsultRefundRejectResponse = ApiResponse<null>;

/** 财务打款 */
export type ConsultRefundPayResponse = ApiResponse<{ payRef: string }>;

/** 退费统计 */
export type ConsultRefundStatsResponse = ApiResponse<ConsultRefundStats>;

/* ============================================================
 * 五、审批中心
 * ============================================================ */

/** 审批中心数据（两张表一起返回） */
export type ConsultApproveCenterResponse = ApiResponse<ApproveCenterData>;

/* ============================================================
 * 六、流失记录
 * ============================================================ */

/** 流失记录列表 */
export type ConsultLossListResponse = PageResponse<LossRecordItem>;

/** 流失统计 */
export type ConsultLossStatsResponse = ApiResponse<LossStats>;

/* ============================================================
 * 七、⭐ 跨模块取数（转发财务的费用标准）
 * ============================================================ */

/**
 * 取单个费用标准
 * GET /api/consult/finance/standard?feeType=1&deptCode=1
 *
 * ⚠️ 这是本模块对财务 /api/finance/standard/get 的封装转发。
 *    前端不直接调财务（避免跨域 + 便于统一做超时兜底），
 *    由咨询后端转发，失败时返回明确提示。
 */
export type ConsultFinanceStandardResponse = ApiResponse<FinanceStandardView>;

/**
 * 批量取费用标准（转正式时一次拿全款 4 笔）
 * GET /api/consult/finance/standard-batch?feeTypes=1,2,3,4&deptCode=1
 */
export type ConsultFinanceStandardBatchResponse = ApiResponse<FinanceStandardBatchResult>;
