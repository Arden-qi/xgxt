/**
 * 通用响应与分页类型
 * ⚠️ 必须与《02-接口契约规范.md》完全一致
 */

/** 统一响应格式 */
export interface ApiResponse<T = any> {
  /** 业务状态码，200 表示成功（不是 HTTP 状态码） */
  code: number;
  /** 中文提示，可直接展示给用户 */
  message: string;
  /** 业务数据；没有数据时为 null，但字段必须存在 */
  data: T;
}

/** 分页数据 */
export interface PageData<T> {
  total: number;
  page: number;
  /** 每页条数 */
  size: number;
  /** 数据数组，空时返回 [] 不是 null */
  list: T[];
}

/** 分页响应（完整） */
export type PageResponse<T> = ApiResponse<PageData<T>>;

/** 分页请求参数（参数名只许叫 page / size） */
export interface PageQuery {
  /** 页码，从 1 开始 */
  page: number;
  size: number;
}

/** 通用查询参数（列表接口都用这套） */
export interface CommonQuery extends PageQuery {
  /** 起始日期 YYYY-MM-DD */
  startDate?: string;
  /** 结束日期 YYYY-MM-DD */
  endDate?: string;
  /** 模糊搜索（学号 / 姓名） */
  keyword?: string;
  classId?: string;
  deptCode?: number;
}

/** 业务状态码（段位划分见接口契约规范 2.3） */
export enum BizCode {
  SUCCESS = 200,
  PARAM_ERROR = 40000,
  STUDENT_NO_EXISTS = 40001,
  REQUIRED_FIELD_MISSING = 40002,
  FORMAT_ERROR = 40003,
  UNAUTHORIZED = 40101,
  TOKEN_EXPIRED = 40102,
  NO_MENU_PERMISSION = 40301,
  NO_OPERATION_PERMISSION = 40302,
  STUDENT_NOT_FOUND = 40401,
  CLASS_NOT_FOUND = 40402,
  APPLY_NOT_FOUND = 40403,
  NOTIFY_NOT_FOUND = 40404,
  INTERNAL_ERROR = 50001,
  DB_ERROR = 50002,
}

/** 全局实体基础字段（所有表都有） */
export interface BaseEntity {
  /** 主键，UUID，字符串 */
  id: string;
  /** 创建时间 YYYY-MM-DD HH:mm:ss */
  createTime: string;
  /** 创建人 ID */
  createBy: string;
  /** 最后修改时间 YYYY-MM-DD HH:mm:ss */
  updateTime?: string;
  /** 最后修改人 ID */
  updateBy?: string;
  /** 逻辑删除标记，默认 false；禁止物理删除 */
  isDeleted: boolean;
}

/** 逻辑删除标记的取值（已写进数据库的字段名） */
export enum DeletedFlag {
  NO = 0,
  YES = 1,
}
