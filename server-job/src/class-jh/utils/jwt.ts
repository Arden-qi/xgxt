/**
 * JWT 工具（HS256，基于 Node 内置 crypto，无第三方依赖）
 *
 * ⚠️ 为什么不用 jsonwebtoken 包？
 *    本模块只需要「验签 + 校验过期」这一件事，用内置 crypto 手写更轻、
 *    不引入额外依赖，符合各模块独立部署的约定。
 *
 * 约定：登录模块（8001）用同一套 secret 签发 token，本模块只负责校验。
 */

import { createHmac, timingSafeEqual } from 'crypto';

/** token 载荷（与登录模块约定一致） */
export interface JwtPayload {
  /** 用户ID */
  userId: string;
  /** 用户姓名 */
  userName: string;
  /** 角色编码数组，如 ['ROLE_ADMIN'] */
  roles: string[];
  /** 部门编码 */
  deptCode?: number;
  /** 数据范围 1本人 2本班级 3本部门 4全部 */
  dataScope: number;
  /** 权限标识数组，['*'] 表示全权限 */
  permissions: string[];
  /**
   * ★ 2026-10-05 并入统一门户后，门户签发的 token 还会带这两个字段：
   *    modules —— 该账号被授权的模块 key 列表（含 'class-jh' 才准进本模块）
   *    kind    —— 主身份（sys_admin / module_owner）
   *  本模块用它做「模块门槛」（见 middleware/auth.ts），
   *  因为本模块与大学部班级模块共用角色码，光靠角色区分不了。
   */
  modules?: string[];
  kind?: string;
  /**
   * ★ 登录名（如 'sunmin'）。业务角色的权威源在 sms_perm，
   *   中间件要拿它去权限模块现有查一次真实角色（见 middleware/auth.ts）。
   */
  account?: string;
  /** 过期时间（秒级 UNIX 时间戳） */
  exp?: number;
  /** 签发时间（秒级 UNIX 时间戳） */
  iat?: number;
}

/** 校验结果 */
export type VerifyResult =
  | { ok: true; payload: JwtPayload }
  | { ok: false; reason: 'expired' | 'invalid' };

function base64UrlEncode(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(input: string): Buffer {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return Buffer.from(b64, 'base64');
}

function sign(data: string, secret: string): string {
  return base64UrlEncode(createHmac('sha256', secret).update(data).digest());
}

/**
 * 签发 token（供本地联调 / 测试使用；生产由登录模块签发）。
 *
 * @param payload      载荷（不含 exp/iat）
 * @param secret       密钥
 * @param expiresInSec 有效期（秒），默认 7 天
 */
export function signToken(
  payload: Omit<JwtPayload, 'exp' | 'iat'>,
  secret: string,
  expiresInSec = 7 * 24 * 60 * 60,
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64UrlEncode(JSON.stringify({ ...payload, iat: now, exp: now + expiresInSec }));
  const signature = sign(`${header}.${body}`, secret);
  return `${header}.${body}.${signature}`;
}

/**
 * 校验 token：格式 + 签名 + 过期。
 * 任何一步不通过都返回 ok:false，调用方据此返回 401。
 */
export function verifyToken(token: string, secret: string): VerifyResult {
  if (!token || typeof token !== 'string') return { ok: false, reason: 'invalid' };
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'invalid' };

  const [header, body, signature] = parts;
  const expected = sign(`${header}.${body}`, secret);

  // 时序安全比较，避免签名被逐字节猜测
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'invalid' };

  let payload: JwtPayload;
  try {
    payload = JSON.parse(base64UrlDecode(body).toString('utf8'));
  } catch {
    return { ok: false, reason: 'invalid' };
  }

  if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) {
    return { ok: false, reason: 'expired' };
  }
  if (!payload.userId) return { ok: false, reason: 'invalid' };

  return { ok: true, payload };
}
