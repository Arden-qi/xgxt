/**
 * 门户鉴权中间件
 *
 * ⚠️ 门户是自己签发 token 的（它是全系统登录入口），
 *    所以这里做的是【完整校验】：验签 + 回查账号是否仍有效。
 */

import { Request, Response, NextFunction } from 'express';
import { BizCode, ApiResponse } from 'shared-types/portal';
import { db } from '../utils/db';
import { verifyToken, looksLikeJwt } from '../utils/jwt';
import type { JwtPayload } from '../utils/jwt';
import { ACCOUNT_TABLE, toAccountView } from '../services/account.service';
import type { SysAccount } from 'shared-types/portal';

export interface PortalUser extends SysAccount {
  userId: string;
  roles: string[];
  permissions: string[];
  dataScope: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: any;
    }
  }
}

/**
 * ★ 2026-10-05 合并：DEV_MODE 关闭。
 *   门户已是全系统唯一登录入口，不带 token 的请求必须被拒绝，
 *   不能再给「假管理员」——否则未登录也能读到账号/权限数据。
 */
const DEV_MODE = false;

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization || '';

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    if (DEV_MODE) {
      // 假管理员：全模块
      const fake = await db(ACCOUNT_TABLE).where({ account: 'admin', is_deleted: false }).first();
      if (fake) {
        const v = toAccountView(fake, false);
        req.user = {
          ...v,
          userId: v.accountId,
          roles: ['SYS_ADMIN'],
          permissions: ['*'],
          dataScope: 4,
        };
        next();
        return;
      }
    }
    deny(res, BizCode.UNAUTHORIZED, '请先登录', 401);
    return;
  }

  const token = authHeader.slice(7).trim();
  if (!looksLikeJwt(token)) {
    deny(res, BizCode.UNAUTHORIZED, '登录已过期，请重新登录', 401);
    return;
  }

  const payload = verifyToken(token);
  if (!payload) {
    deny(res, BizCode.UNAUTHORIZED, '登录已过期，请重新登录', 401);
    return;
  }

  try {
    // ⚠️ token 有效 ≠ 账号仍可用：管理员可能在有效期内把人停用了
    const row = payload.accountId
      ? await db(ACCOUNT_TABLE).where({ id: payload.accountId, is_deleted: false }).first()
      : null;

    if (!row) {
      deny(res, BizCode.UNAUTHORIZED, '登录已过期，请重新登录', 401);
      return;
    }
    if (!row.active) {
      deny(res, BizCode.ACCOUNT_DISABLED, '该账号已停用，请联系系统管理员', 401);
      return;
    }

    const v = toAccountView(row, false);
    req.user = {
      ...v,
      userId: payload.userId || v.accountId,
      roles: payload.roles || [],
      permissions: payload.permissions || [],
      dataScope: payload.dataScope ?? 4,
    };
    next();
  } catch (err) {
    next(err);
  }
}

function deny(res: Response, code: BizCode, message: string, status: number): void {
  const body: ApiResponse<null> = { code, message, data: null };
  res.status(status).json(body);
}

/** 必须是系统管理员 */
export function requireSysAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    deny(res, BizCode.UNAUTHORIZED, '请先登录', 401);
    return;
  }
  if (req.user.kind === 'sys_admin') {
    next();
    return;
  }
  deny(res, BizCode.NO_OPERATION_PERMISSION, '该操作仅限「系统管理员」执行', 403);
}

export { JwtPayload };
