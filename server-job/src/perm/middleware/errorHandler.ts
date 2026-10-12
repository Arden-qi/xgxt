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
import { BizCode, ApiResponse } from 'shared-types/perm';
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

  // ---- 请求体 / 请求格式错误：属于「调用方用错了」，要给 400 级提示 ----
  // ⚠️ 为什么单独处理：body-parser 解析失败抛出的错**不是** BizError，
  //    如果不拦，就会掉进下面的兜底分支变成 50001「服务器开小差了」——
  //    前端拿到这个提示完全不知道是自己 JSON 写错了，排查成本很高。
  const badReqMessage = translateBadRequest(err);
  if (badReqMessage) {
    console.warn('[BAD REQUEST]', req.method, req.url, err.type || err.statusCode);
    const body: ApiResponse<null> = {
      code: BizCode.PARAM_ERROR,
      message: badReqMessage,
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

/**
 * 把「请求本身就不合法」的错误翻译成人话
 *
 * 覆盖三类：
 *   - body-parser 解析失败（JSON 有语法错误）→ err.type === 'entity.parse.failed'
 *   - 请求体超过上限 → err.type === 'entity.too.large'
 *   - 其他 Node/Express 标了 400 且允许暴露的错误（如 URL 编码非法）
 *
 * 命中返回提示文案，否则返回 null（交给后续兜底分支）。
 */
function translateBadRequest(err: any): string | null {
  if (!err) return null;

  const type: string = err.type || '';

  if (type === 'entity.parse.failed') {
    return '请求体不是合法的 JSON，请检查 Content-Type 和 JSON 格式';
  }
  if (type === 'entity.too.large') {
    return '请求体过大，请减少提交的数据量';
  }
  if (type === 'charset.unsupported' || type === 'encoding.unsupported') {
    return '请求体字符集不支持，请使用 UTF-8';
  }

  // body-parser / Node 抛出的 400 级错误（expose=true 才对外说细节）
  const status = err.statusCode ?? err.status;
  if (status === 400 && err.expose) {
    return '请求格式不正确，请检查提交的参数';
  }

  return null;
}

