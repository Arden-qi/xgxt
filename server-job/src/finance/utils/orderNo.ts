/**
 * 单据号生成器
 *
 * ⚠️ 单据号规则（见《财务模块-数据模型设计.md》）：
 *    缴费账单  ZD + 年份 + 4位序号   例：ZD20260001
 *    退费账单  ZT + 年份 + 4位序号   例：ZT20260001
 *    退费单    TF + 年份 + 4位序号   例：TF20260001
 *
 * ⚠️ 并发安全说明：
 *    这里用「查当天最大号 + 1」的方式生成。单机开发足够用。
 *    多实例部署时需改成「先占号再落库」或加分布式锁 —— 已在 code review 里标注。
 *    但因为 bill_no / order_no 都建了【唯一索引】，
 *    万一并发撞号，数据库会直接拒绝（ER_DUP_ENTRY），不会产生脏数据。
 */

import { db } from './db';

/** 单据号前缀 */
export const ORDER_PREFIX = {
  /** 缴费账单 */
  FEE_BILL: 'ZD',
  /** 退费账单 */
  REFUND_BILL: 'ZT',
  /** 退费单 */
  REFUND_ORDER: 'TF',
} as const;

/**
 * 生成下一个单据号
 *
 * @param table  要查的表名（t_finance_bill / t_finance_refund）
 * @param column 单据号所在列名（bill_no / order_no）
 * @param prefix 前缀（ZD / ZT / TF）
 * @param year   年份，默认当前年
 */
export async function nextOrderNo(
  table: string,
  column: string,
  prefix: string,
  year?: number,
): Promise<string> {
  const y = year ?? new Date().getFullYear();
  const head = `${prefix}${y}`;

  // 取同前缀的最大单据号，例如 ZD20260002
  const row = await db(table)
    .where(column, 'like', `${head}%`)
    .where('is_deleted', false)
    .orderBy(column, 'desc')
    .first(column);

  let seq = 1;
  if (row && row[column]) {
    const tail = String(row[column]).slice(head.length);
    const n = parseInt(tail, 10);
    if (!Number.isNaN(n)) seq = n + 1;
  }

  return `${head}${String(seq).padStart(4, '0')}`;
}

/** 生成缴费账单号 ZD20260001 */
export function nextBillNoForPay(): Promise<string> {
  return nextOrderNo('t_finance_bill', 'bill_no', ORDER_PREFIX.FEE_BILL);
}

/** 生成退费账单号 ZT20260001 */
export function nextBillNoForRefund(): Promise<string> {
  return nextOrderNo('t_finance_bill', 'bill_no', ORDER_PREFIX.REFUND_BILL);
}

/** 生成退费单号 TF20260001 */
export function nextRefundOrderNo(): Promise<string> {
  return nextOrderNo('t_finance_refund', 'order_no', ORDER_PREFIX.REFUND_ORDER);
}
