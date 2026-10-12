import { Response } from 'express';
import { ApiResponse, BizCode, PageData } from 'shared-types/class';

/**
 * 统一响应封装
 *
 * 铁律（《02-接口契约规范》2.1）：
 *  1. data 字段永远存在；没有数据返回 null，不省略、不返回 {}
 *  2. code 是业务码不是 HTTP 状态码；HTTP 一律 200（除非服务真的挂了）
 *  3. message 必须是中文，且能直接给用户看
 */

export function ok<T>(res: Response, data: T, message = '操作成功'): Response {
  const body: ApiResponse<T> = { code: BizCode.SUCCESS, message, data };
  return res.status(200).json(body);
}

export function okNull(res: Response, message = '操作成功'): Response {
  return ok<null>(res, null, message);
}

export function page<T>(res: Response, data: PageData<T>, message = '查询成功'): Response {
  return ok(res, data, message);
}

/** 分页数据的标准构造 */
export function pageData<T>(total: number, page1: number, size: number, list: T[]): PageData<T> {
  return { total, page: page1, size, list: list ?? [] };
}

/** 业务错误（由错误中间件统一转成响应体） */
export class BizError extends Error {
  code: number;
  /** 对应 HTTP 状态码，默认 200（业务码走 body） */
  httpStatus: number;

  constructor(code: number, message: string, httpStatus = 200) {
    super(message);
    this.name = 'BizError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/** 常用错误快捷构造 */
export const Errors = {
  param: (msg: string) => new BizError(BizCode.PARAM_ERROR, msg),
  required: (msg: string) => new BizError(BizCode.REQUIRED_FIELD_MISSING, msg),
  format: (msg: string) => new BizError(BizCode.FORMAT_ERROR, msg),
  studentNoExists: (studentNo: string) =>
    new BizError(BizCode.STUDENT_NO_EXISTS, `学号 ${studentNo} 已存在，请勿重复添加`),
  /**
   * 401：没带门禁卡 → 前端跳登录页
   *
   * ⚠️ 注意 httpStatus 仍为 **200**：规范 2.1 明确「HTTP 一律返回 200，
   *    业务码走 body」。前端判断「要跳登录页」的依据是 `code` ∈ {40101, 40102}，
   *    不是 HTTP 状态码——这样 401 / 403 / 404xx 的处理方式完全统一。
   */
  unauthorized: (msg = '您尚未登录，请先登录') => new BizError(BizCode.UNAUTHORIZED, msg),
  tokenExpired: () => new BizError(BizCode.TOKEN_EXPIRED, '登录已过期，请重新登录'),
  /** 403：带了卡但没这个权限 → 只弹提示，不跳登录页（依据同样是 body 里的 code = 403xx） */
  noMenuPermission: (msg = '您无权访问此菜单') => new BizError(BizCode.NO_MENU_PERMISSION, msg),
  noOperationPermission: (msg = '您无权执行此操作') => new BizError(BizCode.NO_OPERATION_PERMISSION, msg),
  studentNotFound: (msg = '学生不存在') => new BizError(BizCode.STUDENT_NOT_FOUND, msg),
  classNotFound: (msg = '班级不存在') => new BizError(BizCode.CLASS_NOT_FOUND, msg),
  applyNotFound: (msg = '申请单不存在') => new BizError(BizCode.APPLY_NOT_FOUND, msg),
  notifyNotFound: (msg = '通知不存在') => new BizError(BizCode.NOTIFY_NOT_FOUND, msg),
  /** 500xx：这才是「服务真的挂了」，HTTP 一并返回 500 便于网关/监控识别 */
  internal: (msg = '系统内部错误，请联系管理员') => new BizError(BizCode.INTERNAL_ERROR, msg, 500),
  db: (msg = '数据库操作失败，请稍后重试') => new BizError(BizCode.DB_ERROR, msg, 500),
};
