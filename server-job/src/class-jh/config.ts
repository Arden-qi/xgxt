/**
 * 教学管理（初高）· 服务配置
 *
 * ★ 2026-10-05 并入统一门户版（8004 单进程）时改写。
 *
 * 原包（独立 8003 服务）的约定是「PORT / DB_NAME 不给默认值，读不到就直接抛错」——
 * 单进程合并后这套不能再用：**一个模块配置缺失不能让整个 8004 起不来**，
 * 那会连带把就业/教务/班级/咨询/财务/权限全拖死。
 * 所以这里改成「读不到就用默认值」，默认值就是本模块该连的那个库。
 *
 * ⚠️ 但「不给默认值」防的那个坑依然存在（连错库=改错别人的数据）：
 *    本模块连的是 sms_class_jh（初高部），
 *    和大学部的 sms_class 是【两个库】，别混。
 */

import dotenv from 'dotenv';
import path from 'path';

// ★ 并入主包后 .env 挪到 server-job/ 根目录（不在 src/ 下）
//   源码运行时：src/class-jh/  → ../../ = server-job/
//   编译后运行：dist/class-jh/ → ../../ = server-job/
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const num = (v: string | undefined, def: number) => (v === undefined || v === '' ? def : Number(v));

export const config = {
  env: process.env.NODE_ENV || 'development',

  /** 合并后本模块不再自己监听端口（挂在主服务 8004 上）。保留字段只为兼容老代码引用。 */
  port: num(process.env.PORT, 8004),

  /** 监听地址（同上，仅为兼容保留） */
  host: process.env.HOST || '0.0.0.0',

  /**
   * 开发模式鉴权开关
   *
   * ⚠️ 并入后**默认关闭**：走真实 JWT（门户签发的 token）。
   *    开启后会放行「不带 token」的请求 → 门户的登录态就形同虚设，别在生产开。
   */
  authDevMode: process.env.AUTH_DEV_MODE === 'true',

  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: num(process.env.DB_PORT, 3306),
    user: process.env.DB_USER || 'root',
    // ★ 2026-10-14：去掉 `?? '123456'` 兜底（公开仓库不写死可用密码），
    //   与其他模块统一为 `|| ''`。详见 src/class/config.ts 同名处注释。
    password: process.env.DB_PASSWORD ?? '',
    /** ⭐ 本模块自己的库（初高部），与大学部的 sms_class 分开 */
    database: process.env.DB_NAME_CLASS_JH || 'sms_class_jh',
    charset: 'utf8mb4',
    /** ⚠️ 必须设，否则时间差 8 小时 */
    timezone: '+08:00',
  },

  jwt: {
    /**
     * ⚠️ 必须与门户/主工程同一个 secret —— 门户签发的 token 由本模块验签。
     *    取自 server-job/.env 的 JWT_SECRET。
     */
    secret: process.env.JWT_SECRET || 'sms-dev-secret-change-me',
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  },

  /** 其他模块地址（本模块当前不跨模块调用，保留以备后用） */
  services: {
    auth: process.env.AUTH_URL || 'http://127.0.0.1:8001',
    edu: process.env.EDU_URL || 'http://127.0.0.1:8002',
    class: process.env.CLASS_URL || 'http://127.0.0.1:8003',
    job: process.env.JOB_URL || 'http://127.0.0.1:8004',
    finance: process.env.FINANCE_URL || 'http://127.0.0.1:8005',
    perm: process.env.PERM_URL || 'http://127.0.0.1:8006',
    stat: process.env.STAT_URL || 'http://127.0.0.1:8007',
  },

  crossModuleTimeout: num(process.env.CROSS_MODULE_TIMEOUT, 5000),

  /** 内部服务令牌（与主工程同默认值；★ 2026-10-14 默认值改为占位符，见 src/config.ts） */
  internalToken: process.env.INTERNAL_TOKEN || 'CHANGE_ME_INTERNAL_TOKEN',
} as const;

export type AppConfig = typeof config;
