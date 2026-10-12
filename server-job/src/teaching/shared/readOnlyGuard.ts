/**
 * 共享：只读管理员闸（/api/teaching/* 专用）
 * ============================================================
 *
 * 【为什么需要】
 *   `/api/job` 下本来就有一道「系统管理员只读」的闸，
 *   但它只挂在 `/api/job` 前缀上 —— **管不到 `/api/teaching`**。
 *   如果新前缀不单独挂，系统管理员（本应只读）就能通过统一接口写数据。
 *
 * 【口径】GET / HEAD / OPTIONS 放行；
 *         其余方法：若账号角色**只有** SYS_ADMIN → 403。
 *   （一个人同时是管理员 + 业务角色时，按业务角色走，不算只读 —— 与全站一致）
 */

import type { NextFunction, Request, Response } from 'express';
import { BizCode, RoleCode } from 'shared-types';

export function denyReadOnlyAdmin(req: Request, res: Response, next: NextFunction): void {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    next();
    return;
  }
  const roles: string[] = req.user?.roles || [];
  const isAdminOnly = roles.length > 0 && roles.every((r) => r === RoleCode.SYS_ADMIN);
  if (isAdminOnly) {
    // ⚠️ 已登录但无操作权 → 403（不是 401！401 会让前端跳登录页，用户会懵）
    res.status(403).json({
      code: BizCode.NO_OPERATION_PERMISSION,
      message: '系统管理员是只读账号，不能执行新增/修改/删除',
      data: null,
    });
    return;
  }
  next();
}
