/**
 * 财务模块 · 接口契约定义
 *
 * 负责人：周铭（财务管理）
 * 模块前缀：/api/finance    端口：8005
 *
 * ⚠️ 本文件是「财务模块的对外契约」，前后端共用。
 *    修改本文件必须遵守《公共数据字典》与《接口契约规范》，
 *    并在群里公告：「finance 模块 xxx 接口的 yyy 字段改了」，
 *    所有人 npm install + npm run build 后生效。
 *
 * ⚠️ 约定：
 *    1. 金额字段一律为「分」（整数），字段名以 Amount 结尾
 *    2. 枚举字段一律双返回：xxx + xxxName
 *    3. 时间格式 YYYY-MM-DD HH:mm:ss，日期格式 YYYY-MM-DD
 *    4. 删除一律逻辑删除（isDeleted）
 */

import { ApiResponse, PageResponse, PageQuery } from '../common';
import {
  FeeType,
  PayStatus,
  RefundStatus,
  StudentStatus,
  DeptCode,
  SourceModule,
} from '../enums';

/* ============================================================
 * 公共枚举补充（财务模块专有，取值格式与数据字典一致）
 * ============================================================ */

/** 账单类型 */
export enum BillType {
  PAY = 1,    // 缴费账单
  REFUND = 2, // 退费账单
}

export const BILL_TYPE_NAME: Record<number, string> = {
  [BillType.PAY]: '缴费账单',
  [BillType.REFUND]: '退费账单',
};

/** 冻结来源 */
export enum FreezeSource {
  AUTO = 1,   // 自动冻结（学籍=休学触发）
  MANUAL = 2, // 手动冻结
}

export const FREEZE_SOURCE_NAME: Record<number, string> = {
  [FreezeSource.AUTO]: '自动冻结',
  [FreezeSource.MANUAL]: '手动冻结',
};

/** 退费单据来源 */
export enum RefundSourceType {
  HEAD_TEACHER = 1, // 班主任提交（班级模块发起）
  PRINCIPAL = 2, // 校长审批推送
  /** ★ 2026-10-22 新增：咨询部门发起（试学阶段流失退费） */
  CONSULT = 3, // 咨询部门
}

export const REFUND_SOURCE_NAME: Record<number, string> = {
  [RefundSourceType.HEAD_TEACHER]: '班主任提交',
  [RefundSourceType.PRINCIPAL]: '校长审批推送',
  [RefundSourceType.CONSULT]: '咨询部门',
};

/** 支付方式 */
export enum PayMethod {
  CASH = 1,       // 现金
  TRANSFER = 2,   // 转账
  WECHAT = 3,     // 微信
  ALIPAY = 4,     // 支付宝
}

export const PAY_METHOD_NAME: Record<number, string> = {
  [PayMethod.CASH]: '现金',
  [PayMethod.TRANSFER]: '转账',
  [PayMethod.WECHAT]: '微信',
  [PayMethod.ALIPAY]: '支付宝',
};

/* ============================================================
 * 一、缴费管理  /api/finance/fee
 * ============================================================ */

/** 缴费列表查询参数 */
export interface FeeListQuery extends PageQuery {
  /** 学号（模糊） */
  studentNo?: string;
  /** 姓名（模糊） */
  studentName?: string;
  classId?: string;
  deptCode?: DeptCode;
  /** 缴费类型，取值来自 FeeType */
  feeType?: FeeType;
  /** 来源模块，取值来自 SourceModule */
  sourceModule?: SourceModule;
  /** 缴费状态，取值来自 PayStatus */
  payStatus?: PayStatus;
  /** 缴费日期起 YYYY-MM-DD */
  startDate?: string;
  /** 缴费日期止 YYYY-MM-DD */
  endDate?: string;
  /** 通用模糊搜索：学号 / 姓名 */
  keyword?: string;
}

/** 缴费列表项 */
export interface FeeListItem {
  id: string;
  studentId: string;
  studentNo: string;
  studentName: string;
  classId?: string;
  className?: string;
  deptCode?: DeptCode;
  deptName?: string;
  headTeacherName?: string;
  /** 缴费类型 */
  feeType: FeeType;
  /** 双返回 */
  feeTypeName: string;
  /** 金额（单位：分） */
  amount: number;
  /** 来源模块（谁是这笔费用的发起方） */
  sourceModule?: SourceModule;
  /** 双返回 */
  sourceModuleName?: string;
  /** 该费用类型是否允许「多人共用一张凭证」（餐费为 true） */
  voucherReusable?: boolean;
  /** 缴费状态 */
  payStatus: PayStatus;
  /** 双返回 */
  payStatusName: string;
  payDate?: string;
  expireDate?: string;
  /** 是否已上传凭证 */
  hasVoucher: boolean;
  voucherNo?: string;
  /** 是否可核对（已缴 且 有凭证 且 未核对） */
  canVerify: boolean;
}

export type FeeListResponse = PageResponse<FeeListItem>;

/** 缴费详情 */
export interface FeeDetail extends FeeListItem {
  studentPhone?: string;
  parentPhone?: string;
  voucherUrl?: string;
  voucherTime?: string;
  /** 上传凭证的操作人 ID */
  voucherBy?: string;
  /** 该凭证还被哪些其他缴费单共用（餐费场景下会有值） */
  sharedVoucherBy?: Array<{
    id: string;
    studentName: string;
    studentNo: string;
    /** 费用类型中文名（后端 findVoucherSharers 会返回，前端展示用） */
    feeTypeName?: string;
  }>;
  isVerified: boolean;
  verifiedByName?: string;
  verifiedTime?: string;
  isRejected: boolean;
  rejectReason?: string;
  isInBill: boolean;
  period?: string;
  remark?: string;
  createTime: string;
}

export type FeeDetailResponse = ApiResponse<FeeDetail>;

/** 缴费新增参数 */
export interface FeeSavePayload {
  studentId: string;
  studentNo: string;
  studentName: string;
  classId?: string;
  className?: string;
  deptCode?: DeptCode;
  headTeacherId?: string;
  headTeacherName?: string;
  /** 缴费类型 */
  feeType: FeeType;
  /** 金额（单位：分）。不传则由后端按「费用标准」自动取值 */
  amount?: number;
  /**
   * 来源模块。不传时后端按 FEE_SOURCE_MODULE 自动推断。
   * 传了但和费用类型不匹配会被拒绝（如学费标成教务来源）。
   */
  sourceModule?: SourceModule;
  /** 缴费状态，默认 1 待缴 */
  payStatus?: PayStatus;
  /** 缴费日期 YYYY-MM-DD */
  payDate?: string;
  /** 到期日期 YYYY-MM-DD */
  expireDate?: string;
  /** 费用周期 如 2026-09 */
  period?: string;
  /**
   * 凭证截图相对路径，如 /uploads/voucher/v001.jpg
   * ⚠️ 非餐费类型下，同一张凭证只能用于一条单据，重复会被拒绝（见 VOUCHER_REUSABLE_FEE_TYPES）
   */
  voucherUrl?: string;
  /** 转账单号（凭证上的流水号） */
  voucherNo?: string;
  remark?: string;
}

/** 财务核对通过 */
export interface FeeVerifyPayload {
  /** 缴费单 ID */
  id: string;
  remark?: string;
}

/** 核对返回：包含归集后的账单号 */
export interface FeeVerifyResult {
  /** 生成的账单号 ZD20260001 */
  billNo: string;
}

/** 财务打回 */
export interface FeeRejectPayload {
  id: string;
  /** 打回原因，必填 */
  rejectReason: string;
}

/** 批量核对 */
export interface FeeBatchVerifyPayload {
  ids: string[];
}

export interface FeeBatchVerifyResult {
  /** 成功核对条数 */
  successCount: number;
  /** 生成的账单号列表 */
  billNos: string[];
}

/* ============================================================
 * 一之二、费用标准配置  /api/finance/standard
 *
 * 业务背景（用户定的规则2）：
 *   所有费用（学费/住宿费/餐费…）的金额，由财务模块统一维护一张「费用标准表」。
 *   上游模块（咨询、教务）产生费用单时，**从这里取标准金额**，不要自己写死。
 *   财务改了标准，只影响之后新建的单据，历史单据金额不变（财务留痕）。
 * ============================================================ */

/** 费用标准项 */
export interface FeeStandardItem {
  id: string;
  /** 费用类型 */
  feeType: FeeType;
  /** 双返回 */
  feeTypeName: string;
  /** 适用部门 */
  deptCode: DeptCode;
  /** 双返回 */
  deptName: string;
  /** 标准金额（单位：分） */
  amount: number;
  /** 是否启用（停用后上游取不到，取数接口会返回错误） */
  isEnabled: boolean;
  /** 备注，例如调价说明 */
  remark?: string;
  /** 最后修改人 */
  updateByName?: string;
  /** 最后修改时间 */
  updateTime?: string;
}

/** 费用标准列表查询参数 */
export interface FeeStandardListQuery extends PageQuery {
  feeType?: FeeType;
  deptCode?: DeptCode;
  /** 是否只看启用的 */
  onlyEnabled?: boolean;
}

export type FeeStandardListResponse = PageResponse<FeeStandardItem>;

/** 保存费用标准（新增或更新，按 费用类型+部门 唯一） */
export interface FeeStandardSavePayload {
  /** 不传表示新增，传了表示更新 */
  id?: string;
  feeType: FeeType;
  deptCode: DeptCode;
  /** 标准金额（单位：分） */
  amount: number;
  isEnabled?: boolean;
  remark?: string;
}

/**
 * 取标准金额 —— ⭐ 供咨询(8001)/教务(8002)模块跨模块调用
 *
 * 上游模块建费用单前先调这个接口拿金额，不要在前端写死 ¥12800。
 * 该接口不鉴权、永远返回 HTTP 200，成败看 code。
 */
export interface FeeStandardGetQuery {
  feeType: FeeType;
  deptCode: DeptCode;
}

export interface FeeStandardGetResult {
  feeType: FeeType;
  feeTypeName: string;
  deptCode: DeptCode;
  deptName: string;
  /** 标准金额（单位：分） */
  amount: number;
  /** 是否允许凭证复用（餐费为 true），上游据此决定能否多人共用一张凭证 */
  voucherReusable: boolean;
  /** 该费用单应由哪个模块发起 */
  sourceModule: SourceModule;
  sourceModuleName: string;
}

/* ============================================================
 * 二、退费管理  /api/finance/refund
 * ============================================================ */

/** 退费列表查询参数 */
export interface RefundListQuery extends PageQuery {
  studentNo?: string;
  studentName?: string;
  classId?: string;
  deptCode?: DeptCode;
  /** 退费状态，取值来自 RefundStatus */
  refundStatus?: RefundStatus;
  startDate?: string;
  endDate?: string;
  keyword?: string;
}

/** 退费列表项 */
export interface RefundListItem {
  id: string;
  /** 退费单号 TF20260001 */
  orderNo: string;
  studentId: string;
  studentNo: string;
  studentName: string;
  classId?: string;
  className?: string;
  deptCode?: DeptCode;
  deptName?: string;
  /** 退费项目 */
  refundType: FeeType;
  refundTypeName: string;
  /** 退费金额（单位：分） */
  refundAmount: number;
  refundReason: string;
  /** 退费状态（审批链） */
  refundStatus: RefundStatus;
  /** 双返回 */
  refundStatusName: string;
  /** 单据来源 */
  sourceType: RefundSourceType;
  sourceName: string;
  applicantName?: string;
  applyTime?: string;
  pushedTime?: string;
  /** 是否可标记已退费（仅「待财务出款」状态） */
  canRefund: boolean;
  isInBill: boolean;
}

export type RefundListResponse = PageResponse<RefundListItem>;

/** 退费详情 */
export interface RefundDetail extends RefundListItem {
  managerApproveTime?: string;
  managerApproveBy?: string;
  academicCheckTime?: string;
  academicCheckBy?: string;
  principalApproveTime?: string;
  principalApproveBy?: string;
  financePayTime?: string;
  financePayBy?: string;
  rejectReason?: string;
  attachmentUrl?: string;
  remark?: string;
  createTime: string;
}

export type RefundDetailResponse = ApiResponse<RefundDetail>;

/** 退费申请提交（班主任侧，财务也可代提交） */
export interface RefundApplyPayload {
  studentId: string;
  /** 退费项目，可多选 */
  refundItems: FeeType[];
  /** 退费金额（单位：分） */
  refundAmount: number;
  /** 退费原因，必填 */
  refundReason: string;
  attachmentUrl?: string;
}

/** 确认出款（财务） */
export interface RefundPayPayload {
  id: string;
  /** 支付方式 */
  payMethod?: PayMethod;
  remark?: string;
}

/** 出款返回：账单号 */
export interface RefundPayResult {
  /** 退费账单号 ZT20260001 */
  billNo: string;
}

/* ============================================================
 * 三、冻结名单  /api/finance/freeze
 * ============================================================ */

/** 冻结名单查询参数 */
export interface FreezeListQuery extends PageQuery {
  studentNo?: string;
  studentName?: string;
  classId?: string;
  deptCode?: DeptCode;
  /** 冻结来源 */
  freezeSource?: FreezeSource;
  /** 是否只看生效中 */
  onlyFrozen?: boolean;
  keyword?: string;
}

/** 冻结名单项 */
export interface FreezeListItem {
  id: string;
  studentId: string;
  studentNo: string;
  studentName: string;
  classId?: string;
  className?: string;
  deptCode?: DeptCode;
  deptName?: string;
  /** 冻结时的学生状态（应为「休学」） */
  studentStatus: StudentStatus;
  studentStatusName: string;
  /** 冻结范围 */
  freezeScope: string;
  freezeReason: string;
  freezeDate: string;
  /** 冻结来源 */
  freezeSource: FreezeSource;
  freezeSourceName: string;
  operatorName?: string;
  /** 餐费：起始 / 到期 / 剩余天数 */
  mealFrom?: string;
  mealExpire?: string;
  mealRestDays: number;
  /** 住宿费：起始 / 到期 / 剩余天数 */
  dormFrom?: string;
  dormExpire?: string;
  dormRestDays: number;
  isFrozen: boolean;
}

export type FreezeListResponse = PageResponse<FreezeListItem>;

/** 解冻 */
export interface FreezeUnfreezePayload {
  id: string;
  unfreezeReason: string;
}

/**
 * 学籍状态变更同步（供其他模块调用）
 *
 * ⚠️ 调用方：市场咨询 / 教务模块。学生学籍变为「休学」时调用本接口，
 *    财务模块据此自动冻结其餐费与住宿费；恢复在读时自动解冻。
 */
export interface FreezeSyncPayload {
  studentId: string;
  /** 变更后的学生状态 */
  studentStatus: StudentStatus;
  /** 变更时间 YYYY-MM-DD HH:mm:ss */
  changeTime?: string;
}

export interface FreezeSyncResult {
  /** 本次新冻结条数 */
  freezeCount: number;
  /** 本次解冻条数 */
  unfreezeCount: number;
  message: string;
}

/** 手动冻结（兜底） */
export interface FreezeManualPayload {
  studentId: string;
  /** 冻结范围，默认「餐费、住宿费」 */
  freezeScope?: string;
  freezeReason?: string;
}

/* ============================================================
 * 四、账单明细  /api/finance/bill
 * ============================================================ */

/** 账单明细查询参数 */
export interface BillListQuery extends PageQuery {
  studentNo?: string;
  studentName?: string;
  classId?: string;
  deptCode?: DeptCode;
  /** 账单类型 1缴费账单 2退费账单 */
  billType?: BillType;
  feeType?: FeeType;
  /** 账单日期起止 */
  startDate?: string;
  endDate?: string;
  /** 经办人 */
  operatorName?: string;
  keyword?: string;
}

/** 账单明细项 */
export interface BillListItem {
  id: string;
  /** 账单号 ZD20260001 / ZT20260001 */
  billNo: string;
  billType: BillType;
  billTypeName: string;
  sourceId: string;
  sourceNo?: string;
  studentId: string;
  studentNo: string;
  studentName: string;
  classId?: string;
  className?: string;
  deptCode?: DeptCode;
  deptName?: string;
  headTeacherName?: string;
  feeType: FeeType;
  feeTypeName: string;
  /** 金额（单位：分） */
  amount: number;
  billDate: string;
  operatorName?: string;
  voucherNo?: string;
  remark?: string;
}

export type BillListResponse = PageResponse<BillListItem>;

/** 账单汇总统计 */
export interface BillSummary {
  /** 缴费账单总额（单位：分） */
  payTotalAmount: number;
  /** 缴费账单条数 */
  payCount: number;
  /** 退费账单总额（单位：分） */
  refundTotalAmount: number;
  /** 退费账单条数 */
  refundCount: number;
}

export type BillSummaryResponse = ApiResponse<BillSummary>;

/* ============================================================
 * 五、财务概览  /api/finance/overview
 * ============================================================ */

/** 财务概览统计（首页大屏） */
export interface FinanceOverview {
  /** 学生总数 */
  studentCount: number;
  /** 休学人数 */
  suspendedCount: number;
  /** 已核对缴费单数 */
  verifiedFeeCount: number;
  /** 待核对缴费单数 */
  pendingFeeCount: number;
  /** 待财务出款退费单数 */
  pendingRefundCount: number;
  /** 冻结中人数 */
  frozenCount: number;
  /** 缴费账单总额（单位：分） */
  billPayAmount: number;
  /** 退费账单总额（单位：分） */
  billRefundAmount: number;
}

export type FinanceOverviewResponse = ApiResponse<FinanceOverview>;
