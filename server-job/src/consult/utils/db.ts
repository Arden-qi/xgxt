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
  pool: { min: 2, max: 10 },
  // 开发环境打印 SQL，方便排查问题
  debug: config.env === 'development',
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
