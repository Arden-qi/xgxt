/**
 * 服务配置（统一门户）
 *
 * ⚠️ 所有配置从环境变量读，不硬编码。
 * ⚠️ 已合并进 server-job：DB_NAME 改为按模块命名空间读取 —— 宁可起不来，也不要连错库。
 */

import * as dotenv from 'dotenv';
dotenv.config();

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
        '══════════════════════════════════════════════',
        '',
      ].join('\n'),
    );
  }
  return value.trim();
}

export const config = {
  /** 门户端口（统一入口） */
  port: Number(String(process.env.PORT || 8004)),

  env: process.env.NODE_ENV || 'development',

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD ?? '',
    /** 统一账号库 */
    database: requireEnv('DB_NAME_PORTAL', 'sms_portal'),
    charset: 'utf8mb4',
    /** ⚠️ 必须设，否则时间差 8 小时 */
    timezone: '+08:00',
  },

  jwt: {
    /**
     * ⚠️⚠️ 必须与咨询(8001)/财务(8005) 一致！
     * 门户签发的 token 要给各业务模块验签，secret 不同就全 401。
     */
    secret: process.env.JWT_SECRET || 'sms-dev-secret-change-me',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },

  /** 各子模块前端入口 */
  modules: {
    consult: process.env.CONSULT_URL || 'http://127.0.0.1:5173',
    finance: process.env.FINANCE_URL || 'http://127.0.0.1:5174',
  },
};
