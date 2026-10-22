/**
 * 班级状态（开放 / 封班）查询
 * ============================================================
 *
 * 宿舍分派要按班级状态决定「这间房还能不能动」：
 *   · 开放(1)  → 分派给该班的房间**锁定**，不能分给别的班；
 *   · 封班(2)  → 空床位分配权交回教务，可以继续调配给别的班。
 *
 * 班级状态存在三学段班级表里（字段 `class_status`），且**要跨学段查**：
 * 大学部班主任可能带初高班（张海涛带 Q30），宿舍又是合并页。
 * 找不到班级记录时返回 undefined —— 调用方按「开放」处理（宁可不让人抢）。
 */

import { db } from '../../utils/db';

const CLASS_SOURCES = [
  'sms_class_jh.t_class_info',
  'sms_class.t_class_info',
  'sms_job.t_job_class',
];

export const CLASS_STATUS_OPEN = 1;
export const CLASS_STATUS_CLOSED = 2;

export const CLASS_STATUS_NAME: Record<number, string> = {
  [CLASS_STATUS_OPEN]: '开放',
  [CLASS_STATUS_CLOSED]: '封班',
};

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/** 批量取班级状态：class_name → class_status（跨三学段班级表，先命中先算） */
export async function loadClassStatuses(names: string[]): Promise<Map<string, number>> {
  const wanted = [...new Set(names.map((n) => str(n).trim()).filter(Boolean))];
  const out = new Map<string, number>();
  if (!wanted.length) return out;

  for (const table of CLASS_SOURCES) {
    try {
      const rows = (await db(table)
        .whereIn('class_name', wanted)
        .where({ is_deleted: false })
        .select('class_name', 'class_status')) as any[];
      for (const r of rows) {
        const name = str(r.class_name);
        if (!name || out.has(name)) continue;
        const st = Number(r.class_status);
        if (Number.isFinite(st) && st > 0) out.set(name, st);
      }
    } catch {
      /* 表不存在 → 跳过 */
    }
  }
  return out;
}

/** 单个班级状态（找不到返回 undefined） */
export async function loadClassStatus(name: string): Promise<number | undefined> {
  if (!str(name).trim()) return undefined;
  const m = await loadClassStatuses([name]);
  return m.get(str(name).trim());
}

/**
 * 房间是否被「开放班」锁定。
 * 只有明确是封班(2)才算解锁；查不到状态按开放处理（保守）。
 */
export function isLockedByClassStatus(status?: number | null): boolean {
  return Number(status) !== CLASS_STATUS_CLOSED;
}
