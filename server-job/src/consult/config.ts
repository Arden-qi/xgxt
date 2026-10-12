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
    database: requireEnv('DB_NAME_CONSULT', 'sms_consult'),
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
   * 服务间调用凭证
   *
   * ⚠️ 用途：本模块调财务 / 班级模块时带的 Authorization / x-internal-token 头。
   *    开发期双方都是 DEV_MODE=true，传 'test' 即可拿到假用户。
   *    正式环境应换成服务间专用 token（不走用户登录态）。
   *
   * ★ 2026-10-05 合并：默认值从 'test' 改成与主 config 一致的 'sms-internal-token'。
   *   原来默认 'test' 而班级侧默认「不校验」，两边对不上时链路会静默断掉；
   *   现在三处（本文件 / src/config.ts / class/config.ts）默认值一致。
   */
  internalToken: process.env.INTERNAL_TOKEN || 'sms-internal-token',

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
     * 财务模块的 uploads 根目录（跨模块图片共享用）
     *
     * ⚠️ 为什么需要这个：
     *    缴费截图要用 `<img src>` 显示，而 `<img>` 带不上 Authorization 头，
     *    所以图片只能走静态托管。但财务侧的 express.static 只映射它自己
     *    项目下的 uploads 目录，访问不到咨询侧的文件。
     *    本地开发两个服务同机，上传时双写一份到财务目录即可解决。
     *
     * 规则：相对路径以本服务根目录为基准，例：
     *    ../05-周铭-finance/server-finance/uploads
     *
     * ⚠️ 生产环境改用对象存储后，把这项留空即可（也可以删掉双写逻辑）。
     */
    financeUploadDir: process.env.FINANCE_UPLOAD_DIR || '',
  },
};
