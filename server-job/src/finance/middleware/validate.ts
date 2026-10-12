/**
 * 参数校验中间件（用 zod）
 *
 * ⚠️ 为什么需要？
 *    前端传上来的东西不可信。如果不校验，脏数据会直接进数据库，
 *    出了事只能一条条手工修。
 *
 * 用法：
 *   import { z } from 'zod';
 *   import { validate } from '../middleware/validate';
 *
 *   const schema = z.object({
 *     page: z.coerce.number().int().min(1),
 *     size: z.coerce.number().int().min(1).max(100),
 *     classId: z.string().optional(),
 *   });
 *
 *   router.get('/list', validate(schema), wrap(async (req, res) => {
 *     // 到这里 req.query 已经是校验并转换过的了
 *   }));
 */

import { Request, Response, NextFunction, RequestHandler } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { BizCode, ApiResponse } from 'shared-types/finance';

export function validate(schema: ZodSchema): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      // query / body / params 合并校验，校验结果写回 req
      const parsed = schema.parse({
        ...req.query,
        ...req.body,
        ...req.params,
      });
      // 只把解析后的 query 写回（避免污染 body）
      (req as any).validated = parsed;
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const body: ApiResponse<null> = {
          code: BizCode.PARAM_ERROR,
          message: toChineseMessage(err),
          data: null,
        };
        res.status(200).json(body);
        return;
      }
      next(err);
    }
  };
}

/**
 * 把 zod 的报错翻译成「人话」
 *
 * ⚠️ 优先用 schema 里我们手写的 message（如 '打回原因必填'），
 *    只有在没写 message 时才回退到按错误类型翻译。
 *    这样前端弹出来的提示才不会是「参数『rejectReason』太小或为空」这种机翻腔。
 */
function toChineseMessage(err: ZodError): string {
  const first = err.errors[0];
  const field = first.path.join('.');

  // ---- 情况一：schema 里自定义了中文 message（不是 zod 的默认英文）----
  const raw = first.message || '';
  const ZOD_DEFAULT_HINTS = ['Required', 'Expected', 'String must', 'Number must', 'Array must', 'Invalid'];
  const isCustom = raw && !ZOD_DEFAULT_HINTS.some((h) => raw.startsWith(h)) && /[\u4e00-\u9fa5]/.test(raw);

  if (isCustom) {
    // 自定义 message 通常已经说清了「哪个字段、错在哪」，直接用
    return raw;
  }

  // ---- 情况二：回退到按错误类型翻译 ----
  const typeMap: Record<string, string> = {
    invalid_type: '类型不正确',
    invalid_string: '格式不正确',
    invalid_enum_value: '取值不在允许范围内',
    unrecognized_keys: '包含多余的字段',
    invalid_union: '格式不正确',
  };

  if (typeMap[first.code]) {
    return `${field ? `参数「${field}」` : '参数'}${typeMap[first.code]}`;
  }

  // too_small / too_big 带上具体边界，提示更有用
  if (first.code === 'too_small') {
    const min: any = (first as any).minimum;
    if (min === 1) return `${field ? `「${field}」` : '参数'}不能为空`;
    return `${field ? `「${field}」` : '参数'}不能小于 ${min}`;
  }
  if (first.code === 'too_big') {
    const max: any = (first as any).maximum;
    return `${field ? `「${field}」` : '参数'}不能大于 ${max}`;
  }

  return `${field ? `参数「${field}」` : '参数'}不合法`;
}
