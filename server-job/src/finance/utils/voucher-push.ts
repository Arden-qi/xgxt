/**
 * 催费侧「登记缴费（上传缴费凭证）」→ 反写财务缴费单
 * ============================================================
 *
 * 【为什么需要这个工具】
 *   催费页的三个部门（初高 / 大学 / 就业）都能在操作列登记缴费：
 *   缴费方式 + 实缴金额 + 缴费日期 + 截图。登记完，催费列表的缴费状态
 *   就从「待缴(1)/逾期(4)」变成「已缴(2)」，等财务核对后再变「已核对(3)」。
 *
 *   但财务那边如果是**财务自建的单**（初始 `pay_status = 1 待缴`），
 *   只改催费侧是不够的：`finance/services/fee.service.ts::verifyFee` 第一步就拦
 *   「该缴费单尚未缴费，无法核对」→ 财务点不了核对 → 催费永远停在「已缴」。
 *
 *   所以登记缴费必须按**财务的口径**把这张单推到「已缴(2)」——
 *   这正是财务自己 `attachVoucher()`（上游回传凭证）在做的：
 *     `pay_status: row.pay_status === 1 ? 2 : row.pay_status`
 *   本工具与它保持同一口径，避免两套规则。
 *
 * 【只做这几件事，绝不越界】
 *   · 凭证 / 缴费日期 / 备注：有值才写（现金无截图时保留原凭证）
 *   · 状态：**仅** `1 待缴 → 2 已缴`；已核对(3) / 冻结(5) 一律不动
 *   · 重新上传视为重新提交 → 清掉 `is_rejected` / `reject_reason`
 *   · 已核对且已有凭证 → 拒绝换图（与 `attachVoucher` 同一保护）
 *
 * 【永不抛错】
 *   反写失败只意味着财务那边要手工补一下，不能因此把「班主任已经登记成功」
 *   这件事回滚掉（钱确实收到了）。调用方按返回值决定要不要提示。
 */

import { PayStatus } from 'shared-types/finance';
import { db } from './db';

/** 财务缴费单表（本文件只碰这一张） */
const FINANCE_FEE_TABLE = 't_finance_fee';

export interface PushVoucherOptions {
  /** 财务缴费单 id（催费台账行上的 `source_id`，`source_system` 必须是 finance） */
  financeFeeId?: string | null;
  /** 本次上传的凭证相对地址；现金登记可为空 */
  voucherUrl?: string | null;
  /** 缴费日期 YYYY-MM-DD */
  payDate?: string | null;
  /** 备注；传 `undefined` 表示「不改」，传 `null` 表示「清空」 */
  remark?: string | null;
  /** 操作人 id（写进 voucher_by / update_by，便于财务溯源） */
  operatorId?: string | null;
}

export type PushVoucherFailReason =
  | 'no-finance-fee' // 这行不是财务推来的，没有对应财务单（演示数据 / 手工建的台账）
  | 'fee-not-found' // 有 source_id 但财务单被删了
  | 'verified-locked' // 已核对且已有凭证 → 不许换图
  | 'error'; // 数据库异常（已吞掉，调用方按「未同步」处理）

export interface PushVoucherResult {
  ok: boolean;
  reason?: PushVoucherFailReason;
  /** 反写后（或未改动时）财务单的缴费状态 */
  payStatus?: number | null;
}

/** 把催费侧的登记信息反写到财务缴费单；永不抛错 */
export async function pushVoucherToFinance(opt: PushVoucherOptions): Promise<PushVoucherResult> {
  const id = String(opt.financeFeeId || '').trim();
  if (!id) return { ok: false, reason: 'no-finance-fee' };

  const operator = String(opt.operatorId || 'urge-backfill');

  try {
    const row = (await db(FINANCE_FEE_TABLE).where({ id, is_deleted: false }).first()) as
      | Record<string, any>
      | undefined;
    if (!row) return { ok: false, reason: 'fee-not-found' };

    const verified = Boolean(row.is_verified);

    // 已核对且已有凭证 → 不允许事后换图（要换先让财务「打回」）
    if (verified && row.voucher_url && opt.voucherUrl) {
      return { ok: false, reason: 'verified-locked', payStatus: Number(row.pay_status ?? 0) };
    }

    const now = new Date();
    const patch: Record<string, any> = { update_time: now, update_by: operator };

    if (opt.payDate) patch.pay_date = opt.payDate;
    if (opt.remark !== undefined) patch.remark = opt.remark ?? null;

    if (opt.voucherUrl) {
      patch.voucher_url = opt.voucherUrl;
      patch.voucher_by = operator;
      patch.voucher_time = now;
      // 重新上传 = 重新提交，把「打回」痕迹清掉
      patch.is_rejected = false;
      patch.reject_reason = null;
    }

    /**
     * 状态推进：只推「待缴(1) → 已缴(2)」，与财务 `attachVoucher()` 同口径。
     *
     * ⚠️ 现金登记没有截图也要推：钱确实收到了，财务必须能核对
     *    （`verifyFee` 已放宽「必须有凭证」的限制，见 2026-10-23 注释）。
     */
    const current = Number(row.pay_status ?? PayStatus.UNPAID);
    if (!verified && current === PayStatus.UNPAID) {
      patch.pay_status = PayStatus.PAID;
    }

    await db(FINANCE_FEE_TABLE).where({ id }).update(patch);

    return {
      ok: true,
      payStatus: Number(patch.pay_status ?? current),
    };
  } catch (e) {
    // 反写失败不影响登记结果：钱已经收到了，财务那边刷新列表也能看到
    // eslint-disable-next-line no-console
    console.warn(
      `[催费→财务] 反写缴费单 ${id} 失败（不影响本次登记）：${(e as Error).message}`,
    );
    return { ok: false, reason: 'error' };
  }
}
