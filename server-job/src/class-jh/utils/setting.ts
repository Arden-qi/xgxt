/**
 * 系统设置读取助手（教学管理初高）
 *
 * 阈值一律不写死，从 t_class_setting 读取；缺失时用默认值兜底。
 *
 * 预置键：attendanceTargetRate(90)、attendanceScope(JSON)、feeRemindDays(7)、
 *        refundThresholdAmount(500000)、closedClassIntakeTypes([1,2])、allowStudentAdd(false)。
 */

import { db } from './db';
// ★ P4 切读层：`t_class_setting`（sms_class_jh）**已归一** → 读走 tbl()。
//   开关关时 `tbl()` 退化为 `db('t_class_setting')`，SQL 一字不差。
import { tbl } from '../../teaching/shared/uniTable';

/** 设置表 */
const SETTING_TABLE = 't_class_setting';
/** 初高库 + 学段取值 */
const DB = 'sms_class_jh';
const STAGE = 'jh' as const;

/** 默认值（与种子/ARCH 一致） */
export const SETTING_DEFAULTS: Record<string, string> = {
  attendanceTargetRate: '90',
  attendanceScope: JSON.stringify({ shouldStatuses: [3, 4, 5], presentStatuses: [1, 2] }),
  feeRemindDays: '7',
  refundThresholdAmount: '500000',
  closedClassIntakeTypes: JSON.stringify([1, 2]),
  allowStudentAdd: 'false',
};

/** 读取全部设置（KV 映射） */
export async function getAllSettings(): Promise<Record<string, string>> {
  const rows = await tbl(db, DB, SETTING_TABLE, STAGE).where('is_deleted', false).select('setting_key', 'setting_value');
  const map: Record<string, string> = { ...SETTING_DEFAULTS };
  for (const r of rows) {
    if (r.setting_value !== null && r.setting_value !== undefined) {
      map[r.setting_key] = String(r.setting_value);
    }
  }
  return map;
}

/** 读取单个设置字符串值 */
export async function getSetting(key: string): Promise<string> {
  const row = await tbl(db, DB, SETTING_TABLE, STAGE).where({ setting_key: key, is_deleted: false }).first();
  if (row && row.setting_value !== null && row.setting_value !== undefined) {
    return String(row.setting_value);
  }
  return SETTING_DEFAULTS[key] ?? '';
}

/** 读取单个设置数字值 */
export async function getNumberSetting(key: string): Promise<number> {
  const raw = await getSetting(key);
  const n = Number(raw);
  return Number.isNaN(n) ? Number(SETTING_DEFAULTS[key] ?? 0) : n;
}

/** 读取单个设置 JSON 值 */
export async function getJsonSetting<T>(key: string): Promise<T> {
  const raw = await getSetting(key);
  try {
    return JSON.parse(raw) as T;
  } catch {
    return JSON.parse(SETTING_DEFAULTS[key] ?? '{}') as T;
  }
}
