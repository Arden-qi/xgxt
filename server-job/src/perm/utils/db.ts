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
    /**
     * ⚠️ 必须开：让 DATETIME 以字符串返回（'YYYY-MM-DD HH:mm:ss'）。
     *    不开的话 mysql2 会给 JS Date，JSON 序列化后变成
     *    '2026-09-29T07:00:00.000Z'（ISO + UTC），
     *    既不符合《02-接口契约规范》要求的 'YYYY-MM-DD HH:mm:ss'，
     *    前端还要自己补时区转换，两边都容易出错。
     */
    dateStrings: true,
  },
  pool: { min: 2, max: 10 },
  // 开发环境打印 SQL，方便排查问题（DB_DEBUG=1 才开，默认关闭以免刷屏）
  debug: process.env.DB_DEBUG === '1',
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
