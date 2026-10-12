import type { AuthUser } from '../lib/authUser';

declare global {
  namespace Express {
    interface Request {
      /**
       * ★ 2026-10-04 并入主包：`req.user` 的类型由【主包】的
       *   `server-job/src/middleware/auth.ts` 统一声明（那边已补上
       *   `classIds` / `token` 字段，与本模块用法兼容）。
       *
       *   这里**不再重复声明** —— 否则两个文件对同一属性给出不同类型，
       *   TS 的接口合并会直接报错。
       *
       *   （本文件仅保留辅助字段）
       */
      /** 请求开始时间，用于日志 */
      startedAt?: number;
    }
  }
}

export {};
