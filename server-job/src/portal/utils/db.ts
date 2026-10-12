/**
 * 数据库连接（knex 单例）
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
  pool: { min: 0, max: 10 },
});
