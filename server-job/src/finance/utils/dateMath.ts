/**
 * 财务模块 · 日期计算（2026-10-26）
 *
 * 只做一件事：按「月份」往后推日期，供「餐费/住宿费/保险费的到期日」使用。
 *
 * ⚠️ 为什么不用 `new Date(y, m + n, d)` 直接算：
 *    JS 的 Date 在「1-31 + 1 个月」时会溢出到 3-03（2 月没有 31 日），
 *    而业务上应该是 2-28/2-29（月末对齐）。这里显式取当月最后一天兜住。
 */

/** 把 YYYY-MM-DD 往后推 N 个月，月末对齐（1-31 + 1 月 → 2-28/29） */
export function addMonths(dateStr: string, months: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').slice(0, 10));
  if (!m) return String(dateStr || '').slice(0, 10);
  const y = Number(m[1]);
  const mon = Number(m[2]);
  const day = Number(m[3]);

  // 目标月份的第一天，用来拿到正确的年月
  const base = new Date(y, mon - 1 + months, 1);
  const targetYear = base.getFullYear();
  const targetMonth = base.getMonth() + 1;
  // 目标月份的最后一天
  const lastDay = new Date(targetYear, targetMonth, 0).getDate();

  const d = Math.min(day, lastDay);
  return `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** 两个 YYYY-MM-DD 之间的天数（to - from），用于剩余天数展示 */
export function daysBetween(from: string, to: string): number {
  const a = new Date(String(from).slice(0, 10) + 'T00:00:00');
  const b = new Date(String(to).slice(0, 10) + 'T00:00:00');
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}
