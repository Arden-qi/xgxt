import { BaseEntity } from './common';
import { DataScope, PermAction, RoleCode } from './enums';

/**
 * 权限相关类型
 *
 * ⚠️ 本轮为「自建 + 额外产出 8001/8006 桩服务」方案：
 *    8006 桩服务先按下述类型提供菜单与按钮权限；
 *    等真正的权限模块就绪后，本模块只替换 HTTP 调用地址，类型不变。
 */

/** 登录用户信息（8001 /api/auth/login 返回） */
export interface LoginUser {
  userId: string;
  userName: string;
  roles: RoleCode[] | string[];
  /** 部门 */
  deptCode: number;
  /** 数据范围 */
  dataScope: DataScope;
  /** 负责的班级 ID 列表（dataScope = CLASS 时用于数据过滤） */
  classIds?: string[];
  /** 手机号 */
  phone?: string;
  /** 头像 */
  avatarUrl?: string;
}

/** 登录响应数据 */
export interface LoginResult extends LoginUser {
  token: string;
  /** token 过期秒数 */
  expiresIn?: number;
}

/** 登录入参 */
export interface LoginPayload {
  username: string;
  password: string;
}

/** 角色 */
export interface Role extends BaseEntity {
  roleCode: string;
  roleName: string;
  /** 是否系统预置（预置角色编码不可改） */
  isSystem: boolean;
  remark?: string;
}

/** 菜单 / 权限项 */
export interface MenuItem extends BaseEntity {
  /** 父级 ID，根为 '0' */
  parentId: string;
  menuName: string;
  /** 前端路由 path */
  path?: string;
  /** 前端路由 name */
  routeName?: string;
  icon?: string;
  sortNo: number;
  /** 权限标识，如 class:student:view */
  permCode?: string;
}

/** 角色-权限（勾选项，动作必须是 6 个之一） */
export interface RolePerm {
  id?: string;
  roleCode: string;
  menuId: string;
  permCode?: string;
  actions: PermAction[];
}

/** 当前用户权限集合（前端按钮级控制用） */
export interface UserPerm {
  roles: string[];
  dataScope: DataScope;
  /** 有权限的 permCode 列表 */
  permCodes: string[];
  /** 菜单树 */
  menus: MenuItem[];
}
