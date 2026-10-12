/**
 * 统一响应包装器
 *
 * ⚠️ 作用：把 async 函数里的报错自动接住，返回 500 而不是让服务崩掉。
 *
 * 为什么要这个？
 *   Express 4 不会自动捕获 async 函数里的异常。
 *   如果你写了 async (req,res) => { ...报错了... }，服务会直接崩。
 *
 * 用法：
 *   router.get('/list', wrap(async (req, res) => {
 *     const rows = await db('xxx');
 *     res.json(ok(rows));
 *   }));
 */

import { Request, Response, NextFunction, RequestHandler } from 'express';

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<any>;

export function wrap(fn: AsyncHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
