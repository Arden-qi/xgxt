/**
 * 枚举中文名兜底助手（教学管理初高）
 *
 * 用法：
 *   import { nameOf, namesOf } from '../utils/enumName';
 *   nameOf(STUDENT_STATUS_NAME, row.student_status);      // → '正式在读'
 *   namesOf(EXAM_CONTENT_TYPE_NAME, [1, 2, 3]);           // → '笔试/机试/面试'
 *
 * ⚠️ 与 shared-types 的 nameOf 保持一致：未知值兜底为 ''（不显示数字）。
 */

/** 单个枚举名（未知值返回空串） */
export function nameOf(
  map: Record<number, string>,
  value: number | string | null | undefined,
): string {
  if (value === undefined || value === null || value === '') return '';
  return map[Number(value)] || '';
}

/** 多个枚举名（用间隔符拼接，用于内容项数组等） */
export function namesOf(
  map: Record<number, string>,
  values: Array<number | string> | null | undefined,
  sep = '/',
): string {
  if (!values || !values.length) return '';
  return values.map((v) => nameOf(map, v)).filter(Boolean).join(sep);
}
