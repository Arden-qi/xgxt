/**
 * ⭐ 极简 JWT（HS256）—— 零依赖，用 Node 内置 crypto 实现
 *
 * ⚠️ 为什么要自己写？
 *    标准做法是 `npm i jsonwebtoken`，但本项目是「11 人 6 模块并行」的联调环境，
 *    每多一个依赖就多一份「我这边装不上」的风险。JWT 的 HS256 格式本身极简单，
 *    用内置 crypto 三十行就能实现，且【完全兼容】其他模块用 jsonwebtoken 验签。
 *
 * ⚠️ 兼容性说明：
 *    标准 jsonwebtoken 库能正常解析本文件签出的 token，反之亦然。
 *    因为下列三点严格对齐了 RFC 7519：
 *      ① header = { alg: 'HS256', typ: 'JWT' }，base64url 编码
 *      ② 签名 = HMAC-SHA256(base64url(header) + '.' + base64url(payload), secret)
 *      ③ base64url 编码去掉 '=' 填充，并把 '+'→'-'、'/'→'_'
 *
 * ⚠️ 三方清单第三节要求：token 里必须能解出 userId / roles / permissions / dataScope。
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { config } from '../config';

/** JWT 载荷（按三方清单定的 4 个核心字段 + 本模块补充字段） */
export interface JwtPayload {
  /* ---- ⭐ 三方清单要求各模块能解出的 4 个字段 ---- */
  userId: string;
  roles: string[];
  permissions: string[];
  /** 数据范围：1 本人 / 2 本班 / 3 本部门 / 4 全部 */
  dataScope: number;

  /* ---- 本模块补充（不影响别人，多带字段是无害的）---- */
  /** 姓名，方便日志与前端显示 */
  userName?: string;
  /** 本模块账号表主键，中间件回查账号用 */
  accountId?: string;
  /** 登录账号（如 wangjl） */
  account?: string;
  /** 本模块岗位角色（admin/manager/consult/finance），用于本模块菜单与操作判断 */
  consultRole?: string;
  /** 是否用「本地兜底权限」签发的（权限模块没连上时为 true） */
  degraded?: boolean;

  /* ---- ⭐ 统一门户扩展（2026-10-02）---- */
  /**
   * 该账号可访问的模块 key 列表，如 ['consult','finance']
   *
   * ⚠️ 门户签发的 token 会带这个字段；本模块签服务 token 时也带。
   */
  modules?: string[];
  /**
   * 主身份：
   *   · 'sys_admin' / 'module_owner' —— 门户按人签发的
   *   · 'service'                     —— 服务间调用（跨模块 HTTP）
   */
  kind?: string;

  /* ---- 标准声明 ---- */
  /** 签发时间（秒） */
  iat?: number;
  /** 过期时间（秒） */
  exp?: number;
}

/* ============================================================
 * base64url 编解码（JWT 专用，不是普通 base64）
 * ============================================================ */

function b64urlEncode(input: string | Buffer): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(input: string): string {
  // 补回被去掉的 '=' 填充
  let s = input.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64').toString('utf8');
}

/** 解析 '7d' / '12h' / '30m' / '3600s' / 纯数字秒 → 秒数 */
function parseExpiresIn(v: string): number {
  const m = /^(\d+)\s*([smhd])?$/.exec(String(v).trim());
  if (!m) return 7 * 24 * 3600; // 兜底 7 天
  const n = Number(m[1]);
  const unit = m[2] || 's';
  const factor: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return n * (factor[unit] ?? 1);
}

/* ============================================================
 * 签发 / 校验
 * ============================================================ */

/** 签发 token */
export function signToken(payload: JwtPayload): string {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + parseExpiresIn(config.jwt.expiresIn);

  const header = { alg: 'HS256', typ: 'JWT' };
  const body: JwtPayload = { ...payload, iat: now, exp };

  const h = b64urlEncode(JSON.stringify(header));
  const p = b64urlEncode(JSON.stringify(body));
  const data = `${h}.${p}`;
  const sig = b64urlEncode(createHmac('sha256', config.jwt.secret).update(data).digest());

  return `${data}.${sig}`;
}

/**
 * 校验并解析 token
 *
 * @returns 合法 → payload；非法/过期/格式错 → null
 *
 * ⚠️ 本函数【不抛错】，把判断交给调用方（中间件要区分 401 的各种原因）。
 */
export function verifyToken(token: string): JwtPayload | null {
  if (!token || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [h, p, sig] = parts;
  const expected = b64urlEncode(
    createHmac('sha256', config.jwt.secret).update(`${h}.${p}`).digest(),
  );

  // ---- 用 timingSafeEqual 防时序攻击（长度不等直接判负）----
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: JwtPayload;
  try {
    payload = JSON.parse(b64urlDecode(p)) as JwtPayload;
  } catch {
    return null;
  }

  // ---- 过期校验 ----
  if (typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }

  return payload;
}

/** 标识：本模块用它快速判断「这串 token 是不是 JWT」（老 token 是裸 accountId） */
export function looksLikeJwt(token: string): boolean {
  return typeof token === 'string' && token.split('.').length === 3;
}
