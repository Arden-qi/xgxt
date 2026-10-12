/**
 * 统一错误处理中间件
 *
 * ⚠️ 作用：
 *   1. 把所有异常统一成 {code, message, data} 格式
 *   2. 把技术错误翻译成人话，不让用户看到堆栈
 *
 * 必须在 app.ts 里最后注册：app.use(errorHandler)
 */

import { Request, Response, NextFunction } from 'express';
import { BizCode, ApiResponse } from 'shared-types/portal';
import { config } from '../config';

/** 业务异常（在代码里 throw new BizError(...) 即可） */
export class BizError extends Error {
  code: BizCode;
  httpStatus: number;

  constructor(code: BizCode, message: string, httpStatus = 200) {
    super(message);
    // ★ 2026-10-06：必须打上 name 标记 —— 单体合并后异常由主 errorHandler 统一处理，
    //   它靠 err.name === 'BizError' 识别业务异常；不打标记会被兜底成 50001「服务器错误」。
    this.name = 'BizError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // ---- 业务异常：直接返回约定好的码和提示 ----
  if (err instanceof BizError) {
    const body: ApiResponse<null> = { code: err.code, message: err.message, data: null };
    res.status(err.httpStatus).json(body);
    return;
  }

  // ---- 数据库常见错误：翻译成人话 ----
  const dbMessage = translateDbError(err);
  if (dbMessage) {
    console.error('[DB ERROR]', req.method, req.url, err.code);
    const body: ApiResponse<null> = {
      code: BizCode.DB_ERROR,
      message: dbMessage,
      data: null,
    };
    res.status(200).json(body);
    return;
  }

  // ---- 其他未知错误 ----
  console.error('[UNHANDLED ERROR]', req.method, req.url, err);

  const body: ApiResponse<null> = {
    code: BizCode.INTERNAL_ERROR,
    message: config.env === 'development'
      ? `服务器错误：${err.message}`   // 开发环境给详细信息，方便排查
      : '服务器开小差了，请稍后重试',      // 生产环境不暴露细节
    data: null,
  };
  res.status(200).json(body);
}

/** 把 MySQL 的错误码翻译成中文提示 */
function translateDbError(err: any): string | null {
  if (!err || !err.code) return null;

  const map: Record<string, string> = {
    ER_DUP_ENTRY: '数据已存在，请勿重复添加',
    ER_NO_REFERENCED_ROW_2: '关联的数据不存在',
    ER_ROW_IS_REFERENCED_2: '该数据被其他记录引用，无法删除',
    ER_ACCESS_DENIED_ERROR: '数据库账号或密码错误',
    ECONNREFUSED: '无法连接数据库，请检查数据库是否启动',
    ER_BAD_FIELD_ERROR: '数据库字段不存在（可能是迁移脚本没跑）',
    ER_NO_SUCH_TABLE: '数据表不存在（请先执行 npm run migrate）',
    ER_DATA_TOO_LONG: '输入的内容太长了',
  };

  return map[err.code] || null;
}
