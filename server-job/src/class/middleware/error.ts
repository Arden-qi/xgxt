import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { ApiResponse, BizCode } from 'shared-types/class';
import { BizError } from '../http/response';

/** 404 */
export function notFound(req: Request, res: Response): void {
  const body: ApiResponse<null> = {
    code: BizCode.PARAM_ERROR,
    message: `接口不存在：${req.method} ${req.path}`,
    data: null,
  };
  res.status(200).json(body);
}

/**
 * 全局错误处理
 *  - BizError      → 按其 code / httpStatus 返回
 *  - ZodError      → 400xx 参数错误，把第一条校验失败的中文提示直接抛给用户
 *  - 其他          → 50001 系统内部错误（日志里留完整堆栈，响应里不暴露）
 */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  let httpStatus = 200;
  let code: number = BizCode.INTERNAL_ERROR;
  let message = '系统内部错误，请联系管理员';

  if (err instanceof BizError) {
    httpStatus = err.httpStatus;
    code = err.code;
    message = err.message;
  } else if (err instanceof ZodError) {
    code = BizCode.PARAM_ERROR;
    const first = err.errors[0];
    const path = first?.path?.length ? `${first.path.join('.')}：` : '';
    message = `${path}${first?.message || '参数校验失败'}`;
  } else if (err instanceof Error) {
    message = '系统内部错误，请联系管理员';
    // eslint-disable-next-line no-console
    console.error('[UNHANDLED]', err.stack || err.message);
  }

  const body: ApiResponse<null> = { code, message, data: null };
  res.status(httpStatus).json(body);
}

/** 包裹 async 路由，免写 try/catch（Express 4 不会自动捕获 async 抛错） */
export function wrap(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
