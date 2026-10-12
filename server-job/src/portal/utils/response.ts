/**
 * 统一响应工具
 *
 * ⚠️ 所有接口必须用这里的方法返回，不许自己 res.json({...})
 *    这样才能保证全系统响应格式一致。
 *
 * 正确用法：
 *   import { ok, page, fail } from '../utils/response';
 *   res.json(ok(data));
 *   res.json(page(list, total, query));
 *   res.json(fail(BizCode.STUDENT_NOT_FOUND, '学生不存在'));
 */

import { Response } from 'express';
import { ApiResponse, PageData, PageResponse, BizCode } from 'shared-types/portal';

/**
 * 成功响应（单条数据）
 * @param data 业务数据，没有就传 null
 */
export function ok<T>(data: T, message = '操作成功'): ApiResponse<T> {
  return { code: BizCode.SUCCESS, message, data };
}

/**
 * 分页响应
 * @param list  数据数组
 * @param total 总条数
 * @param query 前端传的分页参数
 */
export function page<T>(
  list: T[],
  total: number,
  query: { page?: number | string; size?: number | string },
): PageResponse<T> {
  return {
    code: BizCode.SUCCESS,
    message: '查询成功',
    data: {
      total,
      page: Number(query.page) || 1,
      size: Number(query.size) || 20,
      list,
    },
  };
}

/**
 * 失败响应
 * @param code    业务错误码（从 BizCode 里取）
 * @param message 中文提示，能直接给用户看
 */
export function fail(code: BizCode, message: string): ApiResponse<null> {
  return { code, message, data: null };
}

/**
 * 直接发送响应（带 HTTP 状态码控制）
 *
 * ⚠️ 注意：401 和 403 的区别
 *    401 = 没登录 → 前端跳登录页
 *    403 = 登录了但没权限 → 前端只弹提示，不跳登录页
 */
export function send(res: Response, body: ApiResponse<any>, httpStatus = 200): void {
  res.status(httpStatus).json(body);
}
