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
import { BizCode, ApiResponse } from 'shared-types';

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
        // 把 zod 的报错翻译成中文
        const first = err.errors[0];
        const field = first.path.join('.');
        const msg = `${field ? `参数「${field}」` : '参数'}${translateError(first)}`;

        const body: ApiResponse<null> = {
          code: BizCode.PARAM_ERROR,
          message: msg,
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
 * 把 zod 的英文报错翻译成中文
 *
 * ⚠️ 坑：zod 对「字段缺失」和「类型不对」都报 code = invalid_type，
 *    靠 received 区分：
 *      received === 'undefined' → 字段压根没传 → "不能为空"
 *      received 是别的类型       → 类型传错了     → "类型不正确"
 *    不区分的话，缺个必填字段会提示"类型不正确"，看报错的人会一头雾水。
 */
function translateError(err: any): string {
  const { code, message, received } = err || {};

  if (code === 'invalid_type') {
    if (received === 'undefined') return ' 不能为空';
    if (received === 'null') return ' 不能为空';
    return ' 类型不正确';
  }

  const map: Record<string, string> = {
    too_small: ' 不能为空或数值太小',
    too_big: ' 超出允许范围',
    invalid_string: ' 格式不正确',
    invalid_enum_value: ' 取值不在允许范围内',
    invalid_union: ' 格式不正确',
    unrecognized_keys: ' 含有不支持的字段',
  };
  return map[code] || ` ${message}`;
}
