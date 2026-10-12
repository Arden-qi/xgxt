/**
 * knex 配置（建表 / 迁移脚本用）
 *
 * ⚠️ 这里也【不给库名设默认值】。原因同 src/config.ts：
 *    默认值会让"忘改配置"变成一个静默错误 —— 跑到别人的库上去建表。
 */

require('dotenv').config();

/** 读必填环境变量，读不到就报错停下 */
function requireEnv(key, hint) {
  const value = process.env[key];
  if (!value || !String(value).trim()) {
    throw new Error(
      [
        '',
        '══════════════════════════════════════════════',
        `  ❌ 数据库配置缺失：${key}`,
        '',
        `  怎么修：打开本目录下的 .env 文件，补上这一行：`,
        `      ${key}=${hint}`,
        '',
        '  ⚠️ 报 Unknown database 也是这里的问题：',
        '     .env 里的 DB_NAME 必须和你在 MySQL 里建的库名【完全一致】。',
        '══════════════════════════════════════════════',
        '',
      ].join('\n'),
    );
  }
  return String(value).trim();
}

const baseConnection = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  charset: 'utf8mb4',        // ⚠️ 不是 utf8！utf8 存不了 emoji 和生僻字
  timezone: '+08:00',        // ⚠️ 必须设，否则时间差 8 小时
};

module.exports = {
  // 本地开发（各模块用自己的库）
  development: {
    client: 'mysql2',
    connection: {
      ...baseConnection,
      database: requireEnv('DB_NAME', 'sms_job'),
    },
    migrations: {
      directory: './migrations',
      tableName: 'knex_migrations',
    },
  },

  // 联调环境（用公共库，由环境变量指定）
  staging: {
    client: 'mysql2',
    connection: {
      ...baseConnection,
      database: requireEnv('DB_NAME', 'sms_common'),
    },
    migrations: {
      directory: './migrations',
      tableName: 'knex_migrations',
    },
  },

  // 生产环境
  production: {
    client: 'mysql2',
    connection: {
      ...baseConnection,
      database: requireEnv('DB_NAME', 'sms_job'),
    },
    migrations: {
      directory: './migrations',
      tableName: 'knex_migrations',
    },
  },

  // ============================================================
  // 教务库（2026-10-03 合并教务模块时加）
  //
  // ⚠️ 教务的表仍在【独立的 sms_edu 库】，但由本包统一管理迁移。
  //    所以单开一个 env + 单开一个迁移目录（migrations-edu），
  //    和主库的 migrations 分开 —— 两边的迁移编号互不干扰（历史上撞过号）。
  //
  //    跑法：npm run migrate:edu
  //    （npm run migrate 已自动连带跑这个）
  // ============================================================
  edu: {
    client: 'mysql2',
    connection: {
      ...baseConnection,
      database: requireEnv('DB_NAME_EDU', 'sms_edu'),
    },
    migrations: {
      directory: './migrations-edu',
      tableName: 'knex_migrations',
    },
  },

  // ============================================================
  // ★ 2026-10-04 班级模块（8003）并入
  //
  //   它也用【两个库】：
  //     sms_class  —— 本模块自己的业务表（t_class_*）
  //     sms_common —— 外部模块同步过来的只读副本
  //
  //   各自单开迁移目录，和主库/教务库互不干扰。
  //   跑法：npm run migrate:class（npm run migrate 已自动连带跑）
  // ============================================================
  class: {
    client: 'mysql2',
    connection: {
      ...baseConnection,
      database: requireEnv('DB_NAME_CLASS', 'sms_class'),
    },
    migrations: {
      directory: './migrations-class',
      tableName: 'knex_migrations',
    },
  },
  'class-common': {
    client: 'mysql2',
    connection: {
      ...baseConnection,
      database: requireEnv('DB_NAME_COMMON', 'sms_common'),
    },
    migrations: {
      directory: './migrations-class-common',
      tableName: 'knex_migrations',
    },
  },

  // ============================================================
  // ★ 2026-10-05 教学管理（初高）模块并入
  //
  //   和上面的 `class`（大学部）是两套模块、两个库：
  //     sms_class     —— 大学部（Q1~Q6，阶段 201~206）
  //     sms_class_jh  —— 初高部（J/G 班，预科 + 初中 1~3 期 / 高中 1~2 期）
  //
  //   ⚠️ 两套的表名高度重合（t_class_info / t_class_student / …），
  //      所以【必须分库】，并且各自单开迁移目录 ——
  //      共用一个目录的话，两边的迁移编号会互相顶掉、表也建串。
  //
  //   跑法：npm run migrate:class-jh（npm run migrate 已自动连带跑）
  // ============================================================
  'class-jh': {
    client: 'mysql2',
    connection: {
      ...baseConnection,
      database: requireEnv('DB_NAME_CLASS_JH', 'sms_class_jh'),
    },
    migrations: {
      directory: './migrations-class-jh',
      tableName: 'knex_migrations',
    },
  },
};
