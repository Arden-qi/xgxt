/**
 * 财务模块 接口调用
 * 负责人：周铭（财务管理）
 *
 * ⚠️ 要点（照抄 student.ts 的规范）：
 *   1. 路径和《接口契约规范》完全一致（/api/finance/xxx）
 *   2. 返回类型从 shared-types 里引，字段写错会【编译报错】，不靠人肉记忆
 *   3. 返回类型写的是「data 里的类型」——因为 http.xxx 已经自动解包了 data
 *      例：列表接口返回 { total, page, size, list }，所以写 PageData<FeeListItem>
 *
 * ⚠️ 金额约定：所有 xxxAmount 字段单位都是「分」，前端展示时要 / 100 并加 ¥
 *    统一用 formatAmount() 处理，别在每个页面各写一遍。
 */

import { http } from './request';
import type {
  PageData,
  // 缴费
  FeeListQuery,
  FeeListItem,
  FeeClassOption,
  FeeStats,
  FeeDetail,
  FeeSavePayload,
  FeeVerifyPayload,
  FeeVerifyResult,
  FeeRejectPayload,
  FeeBatchVerifyPayload,
  FeeBatchVerifyResult,
  // 退费
  RefundListQuery,
  RefundListItem,
  RefundDetail,
  RefundApplyPayload,
  RefundPayPayload,
  RefundPayResult,
  // 冻结
  FreezeListQuery,
  FreezeListItem,
  FreezeUnfreezePayload,
  FreezeManualPayload,
  FreezeSyncPayload,
  FreezeSyncResult,
  // 账单 & 概览
  BillListQuery,
  BillListItem,
  BillSummary,
  BillStudentQuery,
  BillStudentRow,
  FinanceOverview,
  // 费用标准
  FeeStandardListQuery,
  FeeStandardItem,
  FeeStandardSavePayload,
  FeeStandardGetQuery,
  FeeStandardGetResult,
} from 'shared-types/finance';

/* ============================================================
 * 一、缴费管理
 * ============================================================ */

/** 缴费列表 */
export function fetchFeeList(query: FeeListQuery): Promise<PageData<FeeListItem>> {
  return http.get<PageData<FeeListItem>>('/api/finance/fee/list', query);
}

/**
 * ⭐ 班级字典 —— 「所有拥有的班级」
 *
 * ⚠️ 不要再用「当前页数据去重」来拼班级下拉了：
 *    那样翻页就变、没缴费记录的班直接看不到。
 *    这个接口从「缴费单 + 学生表」合并出全量班级。
 *
 * @param deptCode 传了就只返回该部门的班级（部门 Tab 联动用）
 */
export function fetchFeeClasses(deptCode?: number): Promise<FeeClassOption[]> {
  return http.get<FeeClassOption[]>('/api/finance/fee/classes', { deptCode });
}

/**
 * 缴费状态统计（全量口径，不是当前页）
 *
 * 用于工具栏「待核对 / 已缴 / 已打回」内联统计。
 * ⚠️ 缴费管理只统计「已上传凭证」的单据（财务核对台口径）。
 */
export function fetchFeeStats(
  query: Omit<FeeListQuery, 'page' | 'size'>,
): Promise<FeeStats> {
  return http.get<FeeStats>('/api/finance/fee/stats', query);
}

/** 缴费详情 */
export function fetchFeeDetail(id: string): Promise<FeeDetail> {
  return http.get<FeeDetail>('/api/finance/fee/detail', { id });
}

/** 新增缴费单 */
export function addFee(payload: FeeSavePayload): Promise<{ id: string }> {
  return http.post<{ id: string }>('/api/finance/fee/add', payload);
}

/** 财务核对通过（会生成账单号） */
export function verifyFee(payload: FeeVerifyPayload): Promise<FeeVerifyResult> {
  return http.post<FeeVerifyResult>('/api/finance/fee/verify', payload);
}

/** 财务打回 */
export function rejectFee(payload: FeeRejectPayload): Promise<null> {
  return http.post<null>('/api/finance/fee/reject', payload);
}

/** 批量核对 */
export function batchVerifyFee(payload: FeeBatchVerifyPayload): Promise<FeeBatchVerifyResult> {
  return http.post<FeeBatchVerifyResult>('/api/finance/fee/batch-verify', payload);
}

/* ============================================================
 * 二、退费管理
 * ============================================================ */

/** 退费列表 */
export function fetchRefundList(query: RefundListQuery): Promise<PageData<RefundListItem>> {
  return http.get<PageData<RefundListItem>>('/api/finance/refund/list', query);
}

/** 退费详情（含审批链） */
export function fetchRefundDetail(id: string): Promise<RefundDetail> {
  return http.get<RefundDetail>('/api/finance/refund/detail', { id });
}

/** 提交退费申请 */
export function applyRefund(payload: RefundApplyPayload & {
  studentNo: string;
  studentName: string;
  classId?: string;
  className?: string;
  deptCode?: number;
}): Promise<{ id: string; orderNo: string }> {
  return http.post<{ id: string; orderNo: string }>('/api/finance/refund/apply', payload);
}

/** 财务确认出款（会生成退费账单号） */
export function payRefund(payload: RefundPayPayload): Promise<RefundPayResult> {
  return http.post<RefundPayResult>('/api/finance/refund/pay', payload);
}

/** 驳回退费单 */
export function rejectRefund(payload: { id: string; rejectReason: string }): Promise<null> {
  return http.post<null>('/api/finance/refund/reject', payload);
}

/* ============================================================
 * 三、冻结名单
 * ============================================================ */

/** 冻结名单 */
export function fetchFreezeList(query: FreezeListQuery): Promise<PageData<FreezeListItem>> {
  return http.get<PageData<FreezeListItem>>('/api/finance/freeze/list', query);
}

/** 解冻 */
export function unfreeze(payload: FreezeUnfreezePayload): Promise<null> {
  return http.post<null>('/api/finance/freeze/unfreeze', payload);
}

/** 手工冻结（兜底） */
export function manualFreeze(payload: FreezeManualPayload): Promise<{ id: string }> {
  return http.post<{ id: string }>('/api/finance/freeze/manual', payload);
}

/** 学籍状态同步（联调自测用；正式由教务/咨询模块调用） */
export function syncStudentStatus(payload: FreezeSyncPayload): Promise<FreezeSyncResult> {
  return http.post<FreezeSyncResult>('/api/finance/freeze/sync', payload);
}

/* ============================================================
 * 四、账单明细
 * ============================================================ */

/** 账单列表 */
export function fetchBillList(query: BillListQuery): Promise<PageData<BillListItem>> {
  return http.get<PageData<BillListItem>>('/api/finance/bill/list', query);
}

/** 账单汇总（缴费/退费总额与条数） */
export function fetchBillSummary(
  query: Omit<BillListQuery, 'page' | 'size'>,
): Promise<BillSummary> {
  return http.get<BillSummary>('/api/finance/bill/summary', query);
}

/**
 * ⭐ 账单明细 · 按学员归集（原型「缴费明细」口径）
 *
 * 一行 = 一个学员，带四类（学费/餐费/住宿费/保险费）的金额、笔数与明细记录。
 * ⚠️ 与 fetchBillList（一行一笔流水）是两个视角，别混用。
 */
export function fetchBillStudents(query: BillStudentQuery): Promise<PageData<BillStudentRow>> {
  return http.get<PageData<BillStudentRow>>('/api/finance/bill/students', query);
}

/** 账单明细 · 可见班级字典（按学员归集页的班级下拉用，与缴费管理同思路） */
export function fetchBillClasses(deptCode?: number): Promise<FeeClassOption[]> {
  return http.get<FeeClassOption[]>('/api/finance/bill/classes', { deptCode });
}

/* ============================================================
 * 五、财务概览
 * ============================================================ */

/** 财务概览（首页大屏） */
export function fetchOverview(): Promise<FinanceOverview> {
  return http.get<FinanceOverview>('/api/finance/overview');
}

/* ============================================================
 * 六、费用标准（规则2：各类费用多少钱，由财务统一维护）
 * ============================================================ */

/** 费用标准列表 */
export function fetchStandardList(
  query: FeeStandardListQuery,
): Promise<PageData<FeeStandardItem>> {
  return http.get<PageData<FeeStandardItem>>('/api/finance/standard/list', query);
}

/** 保存费用标准（新增或更新，按 费用类型+部门 唯一） */
export function saveStandard(
  payload: FeeStandardSavePayload,
): Promise<{ id: string; created: boolean; oldAmount?: number }> {
  return http.post<{ id: string; created: boolean; oldAmount?: number }>(
    '/api/finance/standard/save',
    payload,
  );
}

/** 删除费用标准（逻辑删除） */
export function deleteStandard(id: string): Promise<null> {
  return http.post<null>('/api/finance/standard/delete', { id });
}

/**
 * ⭐ 取标准金额 —— 供其他模块跨模块调用
 *
 * 财务自己的页面一般用列表接口就够了，这个主要给咨询(8001)/教务(8002)用。
 * 留在这里是为了本地自测联调时方便验证。
 */
export function fetchStandardAmount(
  query: FeeStandardGetQuery,
): Promise<FeeStandardGetResult> {
  return http.get<FeeStandardGetResult>('/api/finance/standard/get', query);
}
