import { ApiResponse } from '../common';
import { MenuItem, Role, UserPerm } from '../perm';

/**
 * 权限管理（8006，前缀 /api/perm/**）
 * 本模块按此契约调用；当前由 server-perm 桩服务实现。
 */

/** 当前用户权限 GET /api/perm/user/perm */
export type UserPermResponse = ApiResponse<UserPerm>;

/** 角色列表 GET /api/perm/role/list */
export type RoleListResponse = ApiResponse<{ total: number; page: number; size: number; list: Role[] }>;

/** 菜单树 GET /api/perm/menu/list */
export type MenuListResponse = ApiResponse<MenuItem[]>;

/** 用户-角色绑定（校长/学管分配权限用） */
export interface UserRoleBindPayload {
  userId: string;
  roleCodes: string[];
  /** 数据范围，账号级属性 */
  dataScope?: number;
  /** dataScope = 本班级时必填 */
  classIds?: string[];
}
export type UserRoleBindResponse = ApiResponse<{ userId: string }>;
