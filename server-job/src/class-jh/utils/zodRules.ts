/**
 * zod 格式校验规则（复用 shared-types 的纯函数）
 *
 * ⚠️ 为什么单独抽出来？
 *    手机号 / 身份证 / 日期 的格式规则写一次，所有路由共用；
 *    规则本体在 shared-types，前端也能引同一份。
 *
 * 用法：phone: mobile.optional()、idCardNo: idCard.optional()、birthDate: dateOnly.optional()
 */

import { z } from 'zod';
import { isMobileCN, isIdCardCN, isDateOnly } from 'shared-types/class-jh';

/** 手机号（中国大陆） */
export const mobile = z
  .string()
  .max(20)
  .refine((v) => isMobileCN(v), { message: '手机号格式不正确（应为 11 位大陆手机号）' });

/** 身份证号（18 位，含校验码） */
export const idCard = z
  .string()
  .max(32)
  .refine((v) => isIdCardCN(v), { message: '身份证号格式不正确（应为 18 位合法身份证号）' });

/** 日期（YYYY-MM-DD，且为真实存在的日期） */
export const dateOnly = z
  .string()
  .refine((v) => isDateOnly(v), { message: '日期格式应为 YYYY-MM-DD' });

/** 必填日期（YYYY-MM-DD） */
export const dateOnlyRequired = z
  .string()
  .min(1, '日期必填')
  .refine((v) => isDateOnly(v), { message: '日期格式应为 YYYY-MM-DD' });

/** 日期时间（YYYY-MM-DD 或 YYYY-MM-DD HH:mm:ss） */
export const dateTimeLike = z
  .string()
  .refine((v) => isDateOnly(v) || /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(String(v).trim()), {
    message: '日期时间格式不正确',
  });
