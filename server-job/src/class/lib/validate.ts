import { z, ZodTypeAny } from 'zod';
import { NextFunction, Request, Response } from 'express';
import { Errors } from '../http/response';

/**
 * 参数校验（zod）
 *
 * 用法：router.post('/xxx/list', validate({ query: XxxQuerySchema }), handler)
 * 校验失败会抛 ZodError，由全局错误中间件统一转成 400xx 中文提示。
 */
export interface ValidateSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

export function validate(schemas: ValidateSchemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.params) req.params = schemas.params.parse(req.params);
      if (schemas.query) {
        const parsed = schemas.query.parse(req.query);
        // Express 5 起 req.query 是只读的，这里挂到 validated 上更安全
        (req as Request & { validatedQuery?: unknown }).validatedQuery = parsed;
      }
      if (schemas.body) req.body = schemas.body.parse(req.body);
      next();
    } catch (e) {
      next(e);
    }
  };
}

/** 取校验后的 query（拿不到就退回原始 req.query） */
export function q<T>(req: Request): T {
  const vq = (req as Request & { validatedQuery?: unknown }).validatedQuery;
  return (vq ?? req.query) as T;
}

/** 分页参数的公共片段 */
export const pageQuerySchema = z.object({
  page: z.coerce.number().int('页码必须是整数').min(1, '页码从 1 开始').default(1),
  size: z.coerce.number().int('每页条数必须是整数').min(1, '每页至少 1 条').max(200, '每页最多 200 条').default(20),
});

export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD');

/** 学号：S + 4 位年份 + 4 位序号 */
export const studentNoSchema = z
  .string()
  .regex(/^S\d{8}$/, '学号格式应为 S + 年份 + 4 位序号，如 S20260001');

export const uuidSchema = z.string().min(1, '缺少必要参数').max(36, 'ID 长度超出限制');

/** 业务断言：为空则抛 40002 */
export function required<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
    throw Errors.required(`${label}不能为空`);
  }
  return value;
}
