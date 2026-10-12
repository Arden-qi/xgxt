/**
 * 公共格式校验（前后端共用）
 *
 * ⚠️ 为什么放这里？
 *    手机号 / 身份证 / 日期 这类格式规则前后端都要用。
 *    只写在后端 → 前端体验差；只写在前端 → 后端能被绕过。
 *    放在 shared-types 里一份，两边引用同一个函数，规则永远一致。
 *
 * 约定：返回 true = 合法；空值（undefined/null/''）由调用方决定是否必填，
 *       本文件只负责「有值时的格式判断」。
 */

/** 中国大陆手机号：1 开头，第二位 3~9，共 11 位 */
export function isMobileCN(value?: string | null): boolean {
  if (value === undefined || value === null || value === '') return true;
  return /^1[3-9]\d{9}$/.test(String(value).trim());
}

/**
 * 中国大陆二代身份证（18 位，末位可为 X）
 * 校验：位数 + 出生日期合法 + 末位校验码（GB 11643-1999）
 */
export function isIdCardCN(value?: string | null): boolean {
  if (value === undefined || value === null || value === '') return true;
  const id = String(value).trim().toUpperCase();
  if (!/^\d{17}[\dX]$/.test(id)) return false;

  // 出生日期合法性
  const y = Number(id.slice(6, 10));
  const m = Number(id.slice(10, 12));
  const d = Number(id.slice(12, 14));
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return false;
  if (y < 1900 || date.getTime() > Date.now()) return false;

  // 校验码
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const checkChars = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += Number(id[i]) * weights[i];
  return checkChars[sum % 11] === id[17];
}

/** 日期字符串：必须是 YYYY-MM-DD，且是一个真实存在的日期（拒绝 2026-02-30） */
export function isDateOnly(value?: string | null): boolean {
  if (value === undefined || value === null || value === '') return true;
  const s = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}
