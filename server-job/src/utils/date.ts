/**
 * 日期工具
 *
 * ⚠️ 为什么需要它？
 *   数据库里 DATE 字段读出来是 JS Date 对象，直接 JSON 序列化会变成
 *   ISO 字符串 `2026-08-31T16:00:00.000Z` —— 这是 UTC 时间，
 *   在东八区会【差 8 小时】，9月1日 会被显示成 8月31日。
 *
 *   所以所有 DATE 字段往外返回前，必须过一遍 fmtDate()。
 */

/** 取今天的日期字符串 YYYY-MM-DD（本地时间） */
export function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 把 Date / 字符串格式化成 YYYY-MM-DD（本地时间）
 * 空值原样返回，避免 undefined/null 变成 'NaN-NaN-NaN'
 */
export function fmtDate(v: any): any {
  if (v === null || v === undefined || v === '') return v ?? null;
  if (typeof v === 'string') return v.length >= 10 ? v.slice(0, 10) : v;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 把 Date 格式化成 YYYY-MM-DD HH:mm:ss（本地时间）
 * 用于 datetime 字段
 */
export function fmtDateTime(v: any): any {
  if (v === null || v === undefined || v === '') return v ?? null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
