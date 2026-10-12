import { randomUUID } from 'crypto';

/** 主键：UUID v4（数据字典：所有表主键为 36 位 UUID 字符串） */
export function uuid(): string {
  return randomUUID();
}

/** 当前时间字符串：YYYY-MM-DD HH:mm:ss（库连接已设 dateStrings + timezone +08:00） */
export function now(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    ` ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

/** 今天：YYYY-MM-DD */
export function today(): string {
  return now().slice(0, 10);
}

/** 申请单号前缀：休学 XG / 退学 TG / 退费 TF / 升学 SX / 换宿 HS / 退宿 TS */
export const APPLY_NO_PREFIX: Record<string, string> = {
  SUSPEND: 'XG',
  QUIT: 'TG',
  REFUND: 'TF',
  UPGRADE: 'SX',
  DORM_SWAP: 'HS',
  DORM_OUT: 'TS',
};

/**
 * 生成申请单号：前缀 + yyyyMMdd + 4 位当天序号
 *
 * ⚠️ 序号由调用方传入（一般取当天最大序号 +1），本函数只负责拼装，
 *    保证同一前缀同一天的格式稳定，便于人工/接口检索。
 */
export function buildApplyNo(prefixKey: string, seq: number, date = new Date()): string {
  const prefix = APPLY_NO_PREFIX[prefixKey] ?? 'SQ';
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  const ymd = `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}`;
  return `${prefix}${ymd}${String(seq).padStart(4, '0')}`;
}

/** 从「已存在的最大单号」里取出末 4 位序号，用于递增 */
export function seqOfApplyNo(maxApplyNo: string | null | undefined): number {
  if (!maxApplyNo) return 0;
  const m = /(\d{4})$/.exec(maxApplyNo);
  return m ? Number(m[1]) : 0;
}

/** 学号自动生成：S + 4 位年份 + 4 位序号（字典规定格式） */
export function buildStudentNo(seq: number, date = new Date()): string {
  return `S${date.getFullYear()}${String(seq).padStart(4, '0')}`;
}

/** 从学号取末 4 位序号 */
export function seqOfStudentNo(maxStudentNo: string | null | undefined): number {
  if (!maxStudentNo) return 0;
  const m = /(\d{4})$/.exec(maxStudentNo);
  return m ? Number(m[1]) : 0;
}
