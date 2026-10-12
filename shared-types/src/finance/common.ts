/**
 * 通用响应与分页类型
 *
 * ⚠️ 必须与《02-接口契约规范.md》完全一致
 */

/** 统一响应格式 */
export interface ApiResponse<T = any> {
  /** 业务状态码，200 表示成功 */
  code: number;
  /** 中文提示信息，可直接展示给用户 */
  message: string;
  /** 业务数据，没有数据时为 null，但字段必须存在 */
  data: T;
}

/** 分页响应数据 */
export interface PageData<T> {
  total: number;
  page: number;
  size: number;
  list: T[];
}

/** 分页响应（完整） */
export type PageResponse<T> = ApiResponse<PageData<T>>;

/** 分页请求参数 */
export interface PageQuery {
  /** 页码，从 1 开始 */
  page: number;
  /** 每页条数 */
  size: number;
}

/** 业务状态码 */
export enum BizCode {
  SUCCESS = 200,

  // ---- 400xx 参数错误 ----
  PARAM_ERROR = 40000,
  STUDENT_NO_EXISTS = 40001,
  REQUIRED_FIELD_MISSING = 40002,
  FORMAT_ERROR = 40003,
  /** 费用来源模块与费用类型不匹配（如学费标成了教务来源） */
  SOURCE_MODULE_MISMATCH = 40004,
  /** 凭证重复使用：非餐费类型的同一张凭证只能用于一条单据 */
  VOUCHER_DUPLICATED = 40005,
  /** 单据状态不允许当前操作（如重复核对、重复出款） */
  INVALID_STATUS = 40006,

  // ---- 401xx 未登录 ----
  UNAUTHORIZED = 40101,
  TOKEN_EXPIRED = 40102,
  /** 登录失败：账号或密码错误 */
  LOGIN_FAILED = 40103,
  /** 账号已停用（区别于「账号密码错」，提示文案不同） */
  ACCOUNT_DISABLED = 40104,

  // ---- 403xx 无权限 ----
  NO_MENU_PERMISSION = 40301,
  NO_OPERATION_PERMISSION = 40302,

  // ---- 404xx 数据不存在 ----
  STUDENT_NOT_FOUND = 40401,
  CLASS_NOT_FOUND = 40402,
  /** 缴费单不存在 */
  FEE_NOT_FOUND = 40403,
  /** 费用标准未配置或已停用 */
  FEE_STANDARD_NOT_FOUND = 40404,
  /** 退费单不存在 */
  REFUND_NOT_FOUND = 40405,

  // ---- 500xx 系统错误 ----
  INTERNAL_ERROR = 50001,
  DB_ERROR = 50002,
}

/** 全局实体基础字段（所有表都有） */
export interface BaseEntity {
  id: string;
  /** YYYY-MM-DD HH:mm:ss */
  createTime: string;
  createBy: string;
  updateTime?: string;
  updateBy?: string;
  isDeleted: boolean;
}

/** 通用查询参数（列表接口都用这套） */
export interface CommonQuery extends PageQuery {
  /** YYYY-MM-DD */
  startDate?: string;
  /** YYYY-MM-DD */
  endDate?: string;
  keyword?: string;
  classId?: string;
  deptCode?: number;
}
