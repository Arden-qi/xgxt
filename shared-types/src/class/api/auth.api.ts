import { ApiResponse } from '../common';
import { LoginPayload, LoginResult, MenuItem, Role, UserPerm } from '../perm';

/**
 * 登录 / 认证（8001，前缀 /api/auth/**）
 * 本模块按此契约调用；当前由 server-auth 桩服务实现，等真服务就绪后只换地址。
 */

/** 登录 POST /api/auth/login */
export type LoginResponse = ApiResponse<LoginResult>;
export type LoginPayloadType = LoginPayload;

/** 当前用户信息 GET /api/auth/user/info */
export type UserInfoResponse = ApiResponse<LoginResult>;

/** 校验 token（供其他服务调用）POST /api/auth/token/verify */
export interface TokenVerifyPayload {
  token: string;
}
export interface TokenVerifyData {
  valid: boolean;
  user?: LoginResult;
}
export type TokenVerifyResponse = ApiResponse<TokenVerifyData>;
