import jwt, { SignOptions } from 'jsonwebtoken';
import { config } from '../config';
import { AuthUser, resolveDataScope } from './authUser';
import { DataScope, RoleCode } from 'shared-types/class';

/**
 * token 的签发与校验
 *
 * ⚠️ 与 server-auth(8001) 共用同一个 JWT_SECRET。
 *    本模块**统一走一套校验逻辑**，不许各路由自己写（漏写一处就是安全漏洞）。
 *    等 8001 真服务就绪后，本文件的 verify 可以改成调 8001 的 /api/auth/token/verify，
 *    类型与调用方都不用动。
 */

export interface TokenPayload {
  /** 用户 ID */
  sub: string;
  /** 姓名 */
  name: string;
  roles: string[];
  deptCode: number;
  dataScope: number;
  /** 负责的班级 ID 列表 */
  classIds?: string[];
}

export function signToken(payload: TokenPayload): string {
  const opts: SignOptions = { expiresIn: config.jwt.expiresIn as SignOptions['expiresIn'] };
  return jwt.sign(payload, config.jwt.secret, opts);
}

/**
 * 校验结果
 *
 * ★ 2026-10-06：多带回一份**原始 payload**。
 *
 * 【为什么】门户签发的 token 里，业务角色一个字都没有（roles 只有
 *   SYS_ADMIN / SYS_STAFF），真正的角色要去 sms_perm 现查 —— 而「去查谁」
 *   只能从 payload 的 `account` / `kind` 得知。原来这里把 payload 丢掉了，
 *   调用方（middleware/auth.ts）拿不到 account，于是**全系统角色都解析不出来**：
 *   /api/class/me 对所有人返回 roles:['SYS_STAFF']、dataScope:3、deptCode:0
 *   → 校长/学管/班主任打开班级管理全是空列表，按钮也全灰。
 *   所以把 payload 透出去，由调用方决定怎么解析角色。
 */
export type VerifyResult =
  | { ok: true; user: AuthUser; payload?: Record<string, unknown> }
  | { ok: false; reason: 'expired' | 'invalid'; message: string };

/**
 * ★ 旧角色码 → 新角色码 别名表
 *
 *   角色编码 2026-10-04 统一为「无前缀」（校长 = RM_PRINCIPAL，不是 ROLE_PRINCIPAL）。
 *   但演示令牌是人手写/ 从旧文档抄的字符串，里面很可能还留着旧码。
 *
 *   ⚠️ 这张表存在的真正原因：下面 parseDevToken 以前**不校验角色码**，
 *   直接把字符串塞进 `roles`。于是旧码 `ROLE_PRINCIPAL` 原样进了权限判定，
 *   而 `permGuard.FULL_ACCESS_ROLES` 里是新码 `RM_PRINCIPAL` → 比不中
 *   → 校长点升实训报「40302 您无权执行此操作，请联系学管或校长」。
 *   学管的令牌因为是手工按新码写的所以正常，**只有校长坏了** —— 极难定位。
 *
 *   处理方式：认回旧码（不改角色码本身，改了要动 110 处引用），
 *   并且【两套都不认的直接判非法】，不再当什么角色都能进。
 */
const LEGACY_ROLE_ALIAS: Record<string, string> = {
  ROLE_ADMIN: RoleCode.ADMIN,
  ROLE_SYS_ADMIN: RoleCode.ADMIN,
  ROLE_PRINCIPAL: RoleCode.PRINCIPAL,
  ROLE_RECRUIT: RoleCode.RECRUIT,
  ROLE_CONSULT: RoleCode.CONSULT,
  MKT_RECRUIT: RoleCode.RECRUIT,
  MKT_CONSULT: RoleCode.CONSULT,
  ROLE_HEAD_TEACHER: RoleCode.HEAD_TEACHER,
  ROLE_TEACHER: RoleCode.TEACHER,
  ROLE_ASSISTANT: RoleCode.ASSISTANT,
  TEACHER_HEAD: RoleCode.HEAD_TEACHER,
  TEACHER_TUTOR: RoleCode.TEACHER,
  TEACHER_ASSIST: RoleCode.ASSISTANT,
  ROLE_QUALITY_MGR: RoleCode.QUALITY_MGR,
  ROLE_ACADEMIC_MGR: RoleCode.ACADEMIC_MGR,
  ROLE_EDU_ADMIN: RoleCode.EDU_ADMIN,
  ROLE_FINANCE: RoleCode.FINANCE,
  ROLE_EMPLOYMENT: RoleCode.EMPLOYMENT,
  JOB_TEACHER: RoleCode.EMPLOYMENT,
};

/**
 * ★ 2026-10-04 并入主包：兼容主系统的「开发调试 token」
 *
 *   主系统在登录模块（8001）就绪前用假 token 调试，格式：
 *     test                       → 系统管理员（全权限）
 *     test-<ROLE_CODE>           → 该角色（如 test-TEACH_HEAD）
 *     test-<ROLE_CODE>@<真人ID>  → 该角色 + 该真人（如 test-TEACH_HEAD@T007）
 *
 *   ⚠️ 解析出的 roles 一定是**主系统的新编码**（无前缀）——
 *      旧码先过 LEGACY_ROLE_ALIAS 翻译；两套都不认 → 返回 null → 401。
 *      绝不能"原样塞进去"：那样旧码会以"某角色"身份进系统，
 *      权限判定全部落空，表象却是"某人某角色没权限"。
 *
 *   classIds（负责哪些班）这里给空，由 middleware/auth.ts 查库补上。
 */
function parseDevToken(token: string): AuthUser | null {
  if (!token.startsWith('test')) return null;
  // ⚠️ 2026-10-04 修：原来写的是 `slice(4)`，切出来是 **"-SUPER_TEST"**
  //   （带一个前导连字符，因为令牌是 "test-XXX"），
  //   于是下面 `rest === 'SUPER_TEST'` 永远不成立，万能测试号进不来。
  //   统一改成 slice(5) = 跳过 "test-"，跟主包 parseDevRole 口径一致。
  const rest = token.slice(5);

  if (!rest) {
    return {
      userId: 'U001',
      userName: '测试管理员',
      roles: [RoleCode.ADMIN],
      deptCode: 2,
      dataScope: DataScope.ALL,
      classIds: [],
      permissions: [],
      token,
    };
  }

  // ★ 万能测试号（2026-10-04）—— 唯一不走角色码校验的。
  //   跟主包 middleware/auth.ts 的 SUPER_TEST_USER 是同一个号，两边要一起认。
  if (rest.toUpperCase() === 'SUPER_TEST') {
    return {
      userId: 'U_SUPER_TEST',
      userName: '万能测试号',
      roles: ['SUPER_TEST'],
      deptCode: 2,
      dataScope: DataScope.ALL,
      classIds: [],
      // ★ 颗星让本模块的页面闸也直接放行
      permissions: ['*'],
      token,
    };
  }

  // ⚠️ 正则开头那个 `-` 就是为了吃掉「test-」的连字符而写的。
  //   既然上面已改成 slice(5)（干净的角色码），这里必须同步去掉。
  const m = /^([A-Z_]+)(?:@(.+))?$/.exec(rest);
  if (!m) return null;

  const rawRole = m[1];
  const validRoles = Object.values(RoleCode) as string[];
  // ★ 先按新码认，再按旧码别名认；都不认 → 判非法（走 401，不静默放行）
  const role = validRoles.includes(rawRole) ? rawRole : LEGACY_ROLE_ALIAS[rawRole];
  if (!role) return null;

  const userId = m[2] || `U_${role}`;
  const roles = [role];
  return {
    userId,
    userName: userId,
    roles,
    deptCode: 2,
    dataScope: resolveDataScope(roles),
    classIds: [],
    permissions: [],
    token,
  };
}

export function verifyToken(token: string): VerifyResult {
  // ★ 先试主系统的开发 token（正式环境 JWT 才生效）
  const dev = parseDevToken(token);
  if (dev) return { ok: true, user: dev };

  try {
    const raw = jwt.verify(token, config.jwt.secret) as jwt.JwtPayload & Partial<TokenPayload> & {
      userId?: string; accountId?: string; account?: string; userName?: string;
    };
    const roles = Array.isArray(raw.roles) ? raw.roles : [];
    const user: AuthUser = {
      /**
       * ⚠️⚠️ 2026-10-06 关键修复：门户签发的 token **没有标准 `sub` 声明**，
       *   它把主键放在 `userId` / `accountId` 里（见 portal/utils/jwt.ts 的 JwtPayload）。
       *   原来这里只读 `raw.sub` → 门户用户解出来 userId = '' →
       *   middleware 的 fillClassIds() 直接 `if (!user.userId) return` 返回空数组
       *   → **所有班主任的 classIds 永远是 []**，于是：
       *     · 「待接收学员」列表对班主任恒为 0 条（过滤条件 intend_class_id IN ()）
       *     · 本班花名册 / 缴费 / 出勤一律看不到
       *   表象像"权限没配"，实际是主键没取到。三处口径依次兜底。
       */
      userId: String(raw.sub || raw.userId || raw.accountId || ''),
      userName: String(raw.name || raw.userName || raw.account || ''),
      roles,
      deptCode: Number(raw.deptCode || 0),
      dataScope: resolveDataScope(roles, Number(raw.dataScope)),
      classIds: Array.isArray(raw.classIds) ? raw.classIds : [],
      permissions: [],
      token,
    };
    // ★ 2026-10-06：把原始 payload 一并带出（门户 token 的 kind/account/modules 在里面）
    return { ok: true, user, payload: raw as Record<string, unknown> };
  } catch (e) {
    const err = e as Error & { name?: string };
    if (err.name === 'TokenExpiredError') {
      return { ok: false, reason: 'expired', message: '登录已过期，请重新登录' };
    }
    return { ok: false, reason: 'invalid', message: '身份凭证无效，请重新登录' };
  }
}

/** 从 Authorization 头里取出 Bearer token */
export function extractBearer(headerValue: string | undefined): string | null {
  if (!headerValue) return null;
  const m = /^Bearer\s+(.+)$/i.exec(headerValue.trim());
  return m ? m[1].trim() : null;
}
