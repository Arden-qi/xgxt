/**
 * 费用标准 · 业务层
 *
 * 业务定位（用户定的规则2）：
 *   财务在这里维护「各类费用多少钱」的唯一标准。
 *   上游模块（咨询、教务）产生费用单时从这儿取金额，不许自己写死。
 *
 * 关键约束：
 *   ① 同一 【费用类型 + 部门】 只能有一条有效标准
 *   ② 改标准金额只影响之后新建的单据，历史单据金额不变（财务留痕）
 *   ③ 取数接口是跨模块调用，必须「永远返回 200 + 中文提示」，不能抛 500 给对方
 */

import { randomUUID } from 'crypto';
import {
  FeeType,
  FEE_TYPE_NAME,
  DeptCode,
  DEPT_NAME,
  SourceModule,
  SOURCE_MODULE_NAME,
  FEE_SOURCE_MODULE,
  VOUCHER_REUSABLE_FEE_TYPES,
  BizCode,
} from 'shared-types/finance';
import { db } from '../utils/db';
import { BizError } from '../middleware/errorHandler';
import { toTimeStr } from './fee.service';

export const STANDARD_TABLE = 't_finance_fee_standard';

/** 该费用类型是否允许「多人共用一张凭证」（餐费为 true） */
export function isVoucherReusable(feeType: number): boolean {
  return VOUCHER_REUSABLE_FEE_TYPES.includes(Number(feeType));
}

/** 该费用类型应由哪个模块发起 */
export function expectedSourceOf(feeType: number): SourceModule | undefined {
  return FEE_SOURCE_MODULE[Number(feeType)];
}

/* ============================================================
 * 列表
 * ============================================================ */

export function toStandardItem(r: any) {
  return {
    id: r.id,
    feeType: r.fee_type,
    feeTypeName: FEE_TYPE_NAME[r.fee_type] || '',
    deptCode: r.dept_code,
    deptName: DEPT_NAME[r.dept_code] || '',
    amount: Number(r.amount),
    isEnabled: !!r.is_enabled,
    remark: r.remark ?? undefined,
    updateByName: r.update_by_name ?? undefined,
    updateTime: toTimeStr(r.update_time),
  };
}

export function buildStandardQuery(q: any) {
  const query = db(STANDARD_TABLE).where('is_deleted', false);
  if (q.feeType) query.where('fee_type', q.feeType);
  if (q.deptCode) query.where('dept_code', q.deptCode);
  if (q.onlyEnabled) query.where('is_enabled', true);
  return query;
}

/* ============================================================
 * 取标准金额（⭐ 跨模块调用）
 *
 * 返回结果里带上 voucherReusable 和 sourceModule，
 * 让上游模块一次拿到「多少钱 + 谁该发起 + 凭证能不能共用」三个信息，
 * 不用再引一遍枚举做判断。
 * ============================================================ */

export async function getStandard(
  feeType: number,
  deptCode: number,
): Promise<{
  feeType: number;
  feeTypeName: string;
  deptCode: number;
  deptName: string;
  amount: number;
  voucherReusable: boolean;
  sourceModule?: number;
  sourceModuleName?: string;
}> {
  const row = await db(STANDARD_TABLE)
    .where({ fee_type: feeType, dept_code: deptCode, is_deleted: false })
    .first();

  const sourceModule = expectedSourceOf(feeType);

  if (!row) {
    // ⚠️ 这里不抛错，返回 code 让调用方自己判断 —— 跨模块接口不抛 500
    throw new BizError(
      BizCode.FEE_STANDARD_NOT_FOUND,
      `财务模块未配置该费用标准：${FEE_TYPE_NAME[feeType] || '未知费用'} / ${DEPT_NAME[deptCode] || '未知部门'}，请先让财务在「费用标准」里配置`,
    );
  }
  if (!row.is_enabled) {
    throw new BizError(
      BizCode.FEE_STANDARD_NOT_FOUND,
      `该费用标准已停用：${FEE_TYPE_NAME[feeType]} / ${DEPT_NAME[deptCode]}，请联系财务启用`,
    );
  }

  return {
    feeType: Number(row.fee_type),
    feeTypeName: FEE_TYPE_NAME[row.fee_type] || '',
    deptCode: Number(row.dept_code),
    deptName: DEPT_NAME[row.dept_code] || '',
    amount: Number(row.amount),
    voucherReusable: isVoucherReusable(row.fee_type),
    sourceModule,
    sourceModuleName: sourceModule ? SOURCE_MODULE_NAME[sourceModule] : undefined,
  };
}

/* ============================================================
 * 保存（新增或更新）
 *
 * 按 【费用类型 + 部门】 做 upsert：
 *   传了 id → 更新那条
 *   没传 id → 查有没有同 type+dept 的，有就更新，没有就新增
 * ============================================================ */

export async function saveStandard(
  body: any,
  operator: { userId: string; userName: string },
): Promise<{ id: string; created: boolean; oldAmount?: number }> {
  if (body.amount == null || Number(body.amount) < 0) {
    throw new BizError(BizCode.PARAM_ERROR, '标准金额必须大于等于 0（单位：分）');
  }

  const now = new Date();
  const amount = Math.round(Number(body.amount));

  // 找已存在的（优先按 id，其次按 类型+部门）
  let existing: any = null;
  if (body.id) {
    existing = await db(STANDARD_TABLE)
      .where({ id: body.id, is_deleted: false })
      .first();
    if (!existing) {
      throw new BizError(BizCode.FEE_STANDARD_NOT_FOUND, '该费用标准不存在或已被删除');
    }
  } else {
    existing = await db(STANDARD_TABLE)
      .where({
        fee_type: body.feeType,
        dept_code: body.deptCode,
        is_deleted: false,
      })
      .first();
  }

  /* ---------- 更新 ---------- */
  if (existing) {
    const oldAmount = Number(existing.amount);
    await db(STANDARD_TABLE)
      .where('id', existing.id)
      .update({
        amount,
        is_enabled: body.isEnabled ?? existing.is_enabled,
        remark: body.remark ?? existing.remark,
        update_time: now,
        update_by: operator.userId,
      });
    return { id: existing.id, created: false, oldAmount };
  }

  /* ---------- 新增 ---------- */
  const id = randomUUID();
  await db(STANDARD_TABLE).insert({
    id,
    create_time: now,
    create_by: operator.userId,
    is_deleted: false,
    fee_type: body.feeType,
    dept_code: body.deptCode,
    amount,
    is_enabled: body.isEnabled ?? true,
    remark: body.remark ?? null,
  });
  return { id, created: true };
}

/* ============================================================
 * 逻辑删除
 *
 * ⚠️ 铁律：一律逻辑删除，绝不物理删。
 *   唯一索引带了 is_deleted，所以删掉后可以再建同 type+dept 的新标准。
 * ============================================================ */

export async function removeStandard(
  id: string,
  operator: { userId: string; userName: string },
): Promise<void> {
  const row = await db(STANDARD_TABLE)
    .where({ id, is_deleted: false })
    .first();
  if (!row) {
    throw new BizError(BizCode.FEE_STANDARD_NOT_FOUND, '该费用标准不存在或已被删除');
  }

  await db(STANDARD_TABLE).where('id', id).update({
    is_deleted: true,
    update_time: new Date(),
    update_by: operator.userId,
  });
}

/** 给列表用的：把 update_by 换成姓名（后端不预知权限模块，先原样返回） */
export async function attachUpdaterNames(rows: any[]): Promise<any[]> {
  return rows;
}

export { FeeType, DeptCode };
