/**
 * 服务配置
 *
 * ⚠️ 所有配置从环境变量读，不要硬编码！
 *    本地开发和联调时地址不一样，硬编码会导致每个人都要改代码。
 *
 * ⚠️⚠️ 这里故意【不给 PORT 和 DB_NAME 设默认值】。原因：
 *    如果给了默认值，有人忘改 .env 时程序不会报错，
 *    而是悄悄用默认值启动 —— 结果连到了【别人的库】，改错了别人的数据。
 *    这种错误在联调时极难排查，所以我们宁可让它启动失败，也不让它跑错。
 */

import * as dotenv from 'dotenv';
dotenv.config();

/**
 * 读一个"必须存在"的环境变量。
 * 读不到就直接抛错，让服务起不来 —— 起不来比跑错强。
 */
function requireEnv(key: string, hint: string): string {
  const value = process.env[key];
  if (!value || !value.trim()) {
    throw new Error(
      [
        '',
        '══════════════════════════════════════════════',
        `  ❌ 启动失败：缺少环境变量 ${key}`,
        '',
        `  怎么修：打开本目录下的 .env 文件，补上这一行：`,
        `      ${key}=${hint}`,
        '',
        '  如果你还没有 .env 文件：',
        '      复制 .env.example 改名为 .env',
        '',
        '  ⚠️ 注意：.env 要和 package.json 在同一个目录里。',
        '══════════════════════════════════════════════',
        '',
      ].join('\n'),
    );
  }
  return value.trim();
}

export const config = {
  /** 本服务端口（必填，无默认值） */
  port: Number(String(process.env.PORT || 8004)),

  /** 运行环境 */
  env: process.env.NODE_ENV || 'development',

  /** 数据库配置 */
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD ?? '',
    /** 本模块自己的库名（必填，无默认值 —— 防止连错库） */
    database: requireEnv('DB_NAME_FINANCE', 'sms_finance'),
    charset: 'utf8mb4',
    /** ⚠️ 必须设，否则时间差 8 小时 */
    timezone: '+08:00',
  },

  /** JWT 配置（登录模块用） */
  jwt: {
    secret: process.env.JWT_SECRET || 'sms-dev-secret-change-me',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },

  /**
   * 其他服务的地址（跨模块调用用）
   *
   * ⚠️ 本地开发时，把同事的机器 IP 填进去就能互相调
   *    例：AUTH_URL=http://<your-host>:8001
   */
  services: {
    auth: process.env.AUTH_URL || 'http://localhost:8001',
    edu: process.env.EDU_URL || 'http://localhost:8002',
    class: process.env.CLASS_URL || 'http://localhost:8003',
    job: process.env.JOB_URL || 'http://localhost:8004',
    finance: process.env.FINANCE_URL || 'http://localhost:8005',
    perm: process.env.PERM_URL || 'http://localhost:8006',
    stat: process.env.STAT_URL || 'http://localhost:8007',
    /**
     * ⭐ 统一门户后端（2026-10-02 新增）
     *
     * 门户是【全系统唯一登录入口】，签发含 modules 的 JWT。
     * 财务模块用同一个 JWT_SECRET 本地验签即可，无需回调门户接口 ——
     * 这样门户挂了也不会拖垮财务模块（可用性更好）。
     */
    portal: process.env.PORTAL_URL || 'http://localhost:8000',
  },
};
