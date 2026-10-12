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
import { BizCode, ApiResponse } from 'shared-types/class-jh';

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
        // refine(...) 产生的校验失败（自定义规则/格式校验）→ 用 FORMAT_ERROR(40003)，
        // 其余基础类型/范围错误仍归为 PARAM_ERROR(40000)。
        const code = first.code === 'custom' ? BizCode.FORMAT_ERROR : BizCode.PARAM_ERROR;
        const msg = first.code === 'custom'
          ? (field ? `参数「${field}」：${first.message}` : first.message)
          : `${field ? `参数「${field}」` : '参数'}${translateError(first.message, first.code)}`;

        const body: ApiResponse<null> = {
          code,
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

/** 把 zod 的英文报错翻译成中文 */
function translateError(message: string, code: string): string {
  const map: Record<string, string> = {
    invalid_type: ' 类型不正确',
    too_small: ' 太小或为空',
    too_big: ' 太大或超出范围',
    invalid_string: ' 格式不正确',
    invalid_enum_value: ' 取值不在允许范围内',
  };
  return map[code] || ` ${message}`;
}
