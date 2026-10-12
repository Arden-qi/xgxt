import { get } from './request';
import type { MenuItem } from 'shared-types/class';

/**
 * 登录 / 权限相关接口（★ 2026-10-04 班级模块并入时裁剪）
 *
 * ============================================================
 * 【删掉了什么】
 *   原文件有 4 个函数，合并后 3 个都不能用：
 *     · login()          → 8001 登录服务（合并后走统一门户，不再独立部署）
 *     · authUserInfo()   → 同上
 *     · userPerm()       → 8006 权限服务（合并后权限由 /api/job/auth/my-pages 提供）
 *   只保留 me()（8003 自己提供，已随班级后端并入 8004）。
 *
 * 【类型为什么还留着】
 *   LoginResult / MeResult 仍被 class/stores/user.ts 引用，
 *   保留定义省得改引用；LoginResult 只剩 userName/userId 两个字段真被用到。
 * ============================================================
 */

/** 登录结果（合并后只用到 userId / userName，保留结构以免改引用） */
export interface LoginResult {
  userId: string;
  userName: string;
  roles?: string[];
  deptCode?: number;
  dataScope?: number;
  classIds?: string[];
}

/** 权限服务返回（合并后不再调用，保留类型备用） */
export interface PermResult {
  userId: string;
  userName: string;
  roles: string[];
  dataScope: number;
  /** 有权限的菜单树节点（含 parentId / menuName / path / permCode） */
  menus: MenuItem[];
  /** 按钮级权限码，如 class:student:add */
  permCodes: string[];
}

/** 班级的「当前登录人」—— 校验 token 在本模块也有效，并给出数据范围 */
export interface MeResult {
  userId: string;
  userName: string;
  roles: string[];
  deptCode: number;
  dataScope: number;
  classIds: string[];
}

export function me() {
  return get<MeResult>('/api/class/me');
}
