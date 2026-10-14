import dotenv from 'dotenv';
import path from 'path';

// ★ 2026-10-04 并入主包后，.env 挪到了 server-job/ 根目录（不再在 src/ 下）
//   源码运行时：src/class/  → ../../ = server-job/
//   编译后运行：dist/class/ → ../../ = server-job/
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const num = (v: string | undefined, def: number) => (v === undefined || v === '' ? def : Number(v));

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: num(process.env.PORT, 8003),

  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: num(process.env.DB_PORT, 3306),
    user: process.env.DB_USER || 'root',
    // ★ 2026-10-14：去掉 `|| '123456'` 兜底。公开仓库里写死一个可用密码，
    //   等于「本机漏配 .env 时自动用公开密码连库」。改成空串，
    //   与其他模块（src/config.ts / portal / finance / consult / perm）保持一致，
    //   漏配时连接会被明确拒绝，而不是静默用一个公开密码连上。
    password: process.env.DB_PASSWORD || '',
    /** 业务库：本模块自己的表 */
    nameClass: process.env.DB_NAME_CLASS || 'sms_class',
    /** 共享库：同步自外部模块的只读副本 */
    nameCommon: process.env.DB_NAME_COMMON || 'sms_common',
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'liangzhi-sms-dev-secret-please-change-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  },

  /** 其他模块地址（走环境变量，不硬编码） */
  services: {
    auth: process.env.AUTH_URL || 'http://127.0.0.1:8001',
    consult: process.env.CONSULT_URL || 'http://127.0.0.1:8001',
    edu: process.env.EDU_URL || 'http://127.0.0.1:8002',
    job: process.env.JOB_URL || 'http://127.0.0.1:8004',
    finance: process.env.FINANCE_URL || 'http://127.0.0.1:8005',
    perm: process.env.PERM_URL || 'http://127.0.0.1:8006',
    stat: process.env.STAT_URL || 'http://127.0.0.1:8007',
    class: process.env.CLASS_URL || 'http://127.0.0.1:8003',
  },

  crossModuleTimeout: num(process.env.CROSS_MODULE_TIMEOUT, 5000),

  /**
   * ⭐ 内部服务令牌（模块间同步接口的凭证）
   *
   * ★ 2026-10-05 合并：与 src/config.ts、consult/config.ts 用同一个默认值。
   *   原来本模块是「读 process.env.INTERNAL_TOKEN，**没配就跳过校验**」——
   *   一台机器漏配 .env 就等于 /sync 接口对外完全免鉴权。
   *   现在默认值非空 → 校验永远生效、且与调用方一致。
   *
   * ★ 2026-10-14：默认值由 `'sms-internal-token'` 改成 `'CHANGE_ME_INTERNAL_TOKEN'`，
   *   原因见 src/config.ts 同名处注释（公开仓库不该写死真实令牌的默认值）。
   */
  internalToken: process.env.INTERNAL_TOKEN || 'CHANGE_ME_INTERNAL_TOKEN',

  business: {
    /**
     * 退费需校长审批的金额阈值（单位：分）
     * 0 = 所有退费都需校长审批（当前需求）
     */
    refundPrincipalThreshold: num(process.env.REFUND_PRINCIPAL_THRESHOLD, 0),
  },
} as const;

export type AppConfig = typeof config;
