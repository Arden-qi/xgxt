/**
 * ⭐ 统一账号服务（门户）
 *
 * ⚠️⚠️ 2026-10-02：全系统「一个账号表管跨模块角色」
 *
 * 设计：
 *    t_sys_account —— 统一账号表
 *      一个账号通过 modules 字段声明「能进哪些模块」
 *        系统管理员 → ['consult','finance']（全部）
 *        咨询负责人 → ['consult']
 *        财务负责人 → ['finance']
 *
 *    登录后签发含 modules 的 JWT，门户据此渲染目录树，
 *    各业务模块据此判断「这人能不能进我这儿」。
 *
 * ⚠️ 密码：演示环境明文存。正式环境必须换 bcrypt。
 */

import { randomUUID } from 'crypto';
import {
  BizCode,
  ModuleKey,
  MODULES,
  AccountKind,
  ModuleDef,
} from 'shared-types/portal';
import type { SysAccount, PortalLoginResult } from 'shared-types/portal';
import { db } from '../utils/db';
import { BizError } from '../middleware/errorHandler';
import { signToken } from '../utils/jwt';
import type { JwtPayload } from '../utils/jwt';

export const ACCOUNT_TABLE = 't_sys_account';

/* ============================================================
 * 行 → 视图
 * ============================================================ */

/** 解析 modules 列（库里存 JSON 字符串或逗号分隔） */
function parseModules(raw: any): ModuleKey[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as ModuleKey[];
  try {
    const arr = JSON.parse(String(raw));
    if (Array.isArray(arr)) return arr as ModuleKey[];
  } catch {
    // 退回逗号分隔
  }
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean) as ModuleKey[];
}

export function toAccountView(row: any, withPassword = false): SysAccount {
  return {
    accountId: row.id,
    account: row.account,
    userName: row.user_name,
    // ⚠️ 演示环境才返回密码。正式环境必须传 false。
    password: withPassword ? row.password : undefined,
    kind: row.kind as AccountKind,
    title: row.title || undefined,
    dept: row.dept || undefined,
    phone: row.phone || undefined,
    modules: parseModules(row.modules),
    active: !!row.active,
    lastLogin: row.last_login ? fmt(row.last_login) : undefined,
    createTime: row.create_time ? fmt(row.create_time) : undefined,
  };
}

function fmt(d: any): string {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())} ${p(dt.getHours())}:${p(dt.getMinutes())}:${p(dt.getSeconds())}`;
}

/* ============================================================
 * 可见模块
 * ============================================================ */

/**
 * ⭐ 取该账号可见的模块（含各自页面）
 *
 * ⚠️ 系统管理员 = 全部模块；模块负责人 = 只看 modules 里声明的。
 *    这里统一按 modules 字段过滤，管理员在数据层就存了全部模块，
 *    所以不需要额外特判 —— 规则单一，少一处出错的地方。
 */
export function visibleModulesOf(account: SysAccount): ModuleDef[] {
  return MODULES.filter((m) => account.modules.includes(m.key));
}

/** 建议落地路径（第一个可见模块的第一页） */
export function landingPathOf(account: SysAccount): string {
  // ★ 2026-10-05 合并：legacy 模块（就业/教务/班级）的路由不带模块前缀，
  //   页面清单也不在注册表里（由角色页面权限算），所以这里跳过它们。
  //   只有 legacy 模块的账号返回空串 —— 前端会兜底到
  //   /api/job/auth/my-pages 里的第一个页面（见 web-job 路由守卫 step 3）。
  const first = visibleModulesOf(account).find((m) => !m.legacy);
  if (!first) return '';
  const firstMenu = first.menus[0];
  if (!firstMenu) return '';
  return `${first.key}${firstMenu.path}`;
}

/* ============================================================
 * 登录
 * ============================================================ */

export async function login(account: string, password: string): Promise<PortalLoginResult> {
  const row = await db(ACCOUNT_TABLE).where({ account, is_deleted: false }).first();

  if (!row) throw new BizError(BizCode.LOGIN_FAILED, '账号或密码错误');
  if (row.password !== password) throw new BizError(BizCode.LOGIN_FAILED, '账号或密码错误');
  if (!row.active) {
    throw new BizError(
      BizCode.ACCOUNT_DISABLED,
      '该账号已停用，无法登录。请联系系统管理员恢复。',
    );
  }

  await db(ACCOUNT_TABLE).where({ id: row.id }).update({ last_login: new Date() });

  const view = toAccountView(row, false);
  const visibleModules = visibleModulesOf(view);

  if (visibleModules.length === 0) {
    throw new BizError(BizCode.NO_MENU_PERMISSION, '该账号未分配任何模块权限，请联系系统管理员');
  }

  // ⭐ 签发含 modules 的 JWT —— 各业务模块验签后可解出「这人能进哪些模块」
  const payload: JwtPayload = {
    userId: row.id,
    // 三方清单口径：角色用统一新编码
    roles: [view.kind === AccountKind.SYS_ADMIN ? 'SYS_ADMIN' : 'SYS_STAFF'],
    permissions: view.kind === AccountKind.SYS_ADMIN ? ['*'] : [`module:${view.modules.join(',')}`],
    dataScope: view.kind === AccountKind.SYS_ADMIN ? 4 : 3,
    // ⭐ 门户扩展
    modules: view.modules,
    kind: view.kind,
    userName: view.userName,
    accountId: row.id,
    account: row.account,
    degraded: false,
  };

  return {
    token: signToken(payload),
    account: view,
    visibleModules,
    landingPath: landingPathOf(view),
  };
}

/** 按 token（accountId）取账号 —— 中间件用 */
export async function findById(id: string): Promise<any | null> {
  if (!id) return null;
  return db(ACCOUNT_TABLE).where({ id, is_deleted: false }).first();
}
