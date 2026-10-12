/**
 * 数据库连接（knex）
 *
 * 用法：import { db } from '../utils/db';
 *      const rows = await db('t_student_base').where({ is_deleted: false });
 */

import knex from 'knex';
import { config } from '../config';

export const db = knex({
  client: 'mysql2',
  connection: {
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    charset: config.db.charset,
    timezone: config.db.timezone,
  },
  /**
   * ★ 2026-10-09 修复「请求超时需要重启」：
   *    · max 10 → 20：单体里大量「自调用 HTTP」（changeState → 财务冻结同步等）
   *      每次嵌套都会叠加连接占用，10 在并发刷新时会排队耗尽
   *    · acquireConnectionTimeout 显式给 10s（默认 60s，池紧张时请求会挂 1 分钟，
   *      前端 15s 就超时了，现象就是「请求超时」）
   */
  pool: { min: 2, max: 20 },
  acquireConnectionTimeout: 10000,
  /**
   * SQL 日志默认关闭。
   * ⚠️ 原来 `debug: env === 'development'`：开发模式下每条 SQL 都 console.log，
   *    Windows 控制台同步输出很慢，SQL 一多就把事件循环拖死 ——
   *    这是「后端越跑越卡 / 请求超时」的主要元凶之一。
   *    需要排查时在 .env 加 DEBUG_SQL=1 再启动。
   */
  debug: process.env.DEBUG_SQL === '1',
});

/** 优雅关闭（进程退出时释放连接） */
process.on('SIGINT', async () => {
  await db.destroy();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await db.destroy();
  process.exit(0);
});
