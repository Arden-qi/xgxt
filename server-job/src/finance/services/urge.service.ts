/**
 * 财务 · 催费提醒（2026-10-26）
 * ============================================================
 *
 * 【规则变更】
 *   原来：教学侧按 `t_class_fee.expire_date` + 20 天窗口判断要不要催。
 *   现在（用户口径）：**以财务账单的到期日为准**，只管「餐费 / 住宿费 / 保险费」
 *   这三类有到期概念的费用 —— 学费/押金/校服没有到期日，不催。
 *
 *   到期日从哪来：财务核对入账时按「缴费金额 ÷ 该费用标准」算出来的
 *   （见 fee.service.ts 的 calcExpireDate，续费会自动接续）。
 *
 * 【判定】
 *   · 每个「学生 × 费用类型」只看**最晚的那笔到期日**（= 当前有效期到哪天）
 *   · 剩余天数 = 到期日 - 今天
 *   · 剩余 ≤ urgeAheadDays（默认 15，可在「费用标准 → 催费设置」里改）→ 进催费名单
 *   · 已逾期（剩余 < 0）照常进，越逾期越该催
 *
 * 【为什么实时查】
 *   用户明确要求「实时查财务库」。财务核对后到期日立刻可见，不需要等同步任务。
 */

import { db } from '../utils/db';
import { FeeType, FEE_TYPE_NAME } from 'shared-types/finance';
import { toDateStr } from './fee.service';

/** 财务配置表（KV） */
const SETTING_TABLE = 't_finance_setting';
const BILL_TABLE = 't_finance_bill';

/** 参与催费提醒的费用类型：餐费 / 住宿费 / 保险费 */
export const URGE_FEE_TYPES: number[] = [FeeType.MEAL, FeeType.ACCOMMODATION, FeeType.INSURANCE];

/** 默认提前天数 */
export const DEFAULT_AHEAD_DAYS = 15;

/** 读催费提前天数（缺失/非法 → 默认 15） */
export async function getUrgeAheadDays(): Promise<number> {
  try {
    const row = await db(SETTING_TABLE).where({ setting_key: 'urgeAheadDays' }).first();
    const n = Number(row?.setting_value);
    return Number.isFinite(n) && n >= 0 ? n : DEFAULT_AHEAD_DAYS;
  } catch {
    return DEFAULT_AHEAD_DAYS;
  }
}

/** 写催费提前天数（0~365） */
export async function saveUrgeAheadDays(days: number, operatorName?: string): Promise<number> {
  const n = Math.max(0, Math.min(365, Math.round(Number(days) || 0)));
  const exist = await db(SETTING_TABLE).where({ setting_key: 'urgeAheadDays' }).first();
  const payload = {
    setting_value: String(n),
    update_time: new Date(),
    update_by: operatorName ?? null,
  };
  if (exist) {
    await db(SETTING_TABLE).where({ setting_key: 'urgeAheadDays' }).update(payload);
  } else {
    await db(SETTING_TABLE).insert({ setting_key: 'urgeAheadDays', ...payload });
  }
  return n;
}

/** 今天零点的时间戳 */
function todayStart(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 两个 YYYY-MM-DD 之间的天数差（to - from，按自然日） */
function diffDays(fromMs: number, toStr: string): number {
  const d = new Date(String(toStr).slice(0, 10) + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return 0;
  return Math.round((d.getTime() - fromMs) / 86400000);
}

export interface UrgeRow {
  studentId: string;
  studentNo: string;
  studentName: string;
  classId?: string;
  className?: string;
  deptCode?: number;
  deptName?: string;
  feeType: number;
  feeTypeName: string;
  /** 当前有效期截止日（该生该费用最晚的一笔） */
  expireDate: string;
  /** 剩余天数（负数=已逾期） */
  remainDays: number;
  /** 建议续费金额（该部门该费用标准价，分） */
  suggestAmount?: number;
  /** 最近一次缴费日期 */
  latestPayDate?: string;
}

/**
 * 催费名单：按账单到期日筛出「快到期 / 已逾期」的学生
 *
 * @param aheadDays 提前天数（默认取配置）
 * @param q         可选筛选（班级/关键字/费用类型）
 */
export async function listUrgeByExpire(
  aheadDays: number,
  q: { className?: string; keyword?: string; feeType?: number; deptCode?: number } = {},
): Promise<{ rows: UrgeRow[]; total: number; aheadDays: number }> {
  const base = db(BILL_TABLE)
    .where({ bill_type: 1, is_deleted: false })
    .whereIn('fee_type', URGE_FEE_TYPES)
    .whereNotNull('expire_date');

  if (q.feeType) base.where('fee_type', Number(q.feeType));
  if (q.deptCode) base.where('dept_code', Number(q.deptCode));
  if (q.className) base.where('class_name', q.className);
  if (q.keyword) {
    const kw = `%${q.keyword}%`;
    base.andWhere((b) => {
      b.where('student_name', 'like', kw).orWhere('student_no', 'like', kw);
    });
  }

  // 每个「学生 × 费用类型」取最晚到期日 + 最近缴费日
  const grouped = await base
    .groupBy('student_id', 'fee_type')
    .select('student_id', 'fee_type')
    .max({ expire_date: 'expire_date', bill_date: 'bill_date' })
    .select(
      db.raw('MAX(student_no) as student_no'),
      db.raw('MAX(student_name) as student_name'),
      db.raw('MAX(class_id) as class_id'),
      db.raw('MAX(class_name) as class_name'),
      db.raw('MAX(dept_code) as dept_code'),
    );

  const t0 = todayStart();
  const rows: UrgeRow[] = [];
  for (const g of grouped as any[]) {
    const exp = toDateStr(g.expire_date);
    if (!exp) continue;
    const remain = diffDays(t0, exp);
    // 只保留「剩余 ≤ 提前天数」的（含负数=逾期）
    if (remain > aheadDays) continue;
    const feeType = Number(g.fee_type);
    rows.push({
      studentId: String(g.student_id),
      studentNo: String(g.student_no ?? ''),
      studentName: String(g.student_name ?? ''),
      classId: g.class_id ?? undefined,
      className: g.class_name ?? undefined,
      deptCode: g.dept_code ?? undefined,
      feeType,
      feeTypeName: FEE_TYPE_NAME[feeType] || '',
      expireDate: exp,
      remainDays: remain,
      latestPayDate: g.bill_date ? toDateStr(g.bill_date) : undefined,
    });
  }

  // 排序：逾期最久 → 快到期
  rows.sort((a, b) => a.remainDays - b.remainDays);

  // 建议续费金额：按部门+类型取标准价（一次性查完，逐行填）
  try {
    const standards = await db('t_finance_fee_standard')
      .where({ is_deleted: false })
      .whereIn('fee_type', URGE_FEE_TYPES)
      .select('fee_type', 'dept_code', 'amount');
    const key = (t: number, d?: number | null) => `${t}-${d ?? ''}`;
    const map = new Map<string, number>();
    for (const s of standards as any[]) {
      map.set(key(Number(s.fee_type), s.dept_code), Number(s.amount) || 0);
    }
    for (const r of rows) {
      r.suggestAmount = map.get(key(r.feeType, r.deptCode)) ?? undefined;
    }
  } catch {
    /* 标准取不到不影响名单本身 */
  }

  return { rows, total: rows.length, aheadDays };
}
