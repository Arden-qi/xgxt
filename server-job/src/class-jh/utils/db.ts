/**
 * 数据库连接（knex）· 教学管理（初高）
 *
 * 用法：import { db } from '../utils/db';
 *      const rows = await db('t_student_base').where({ is_deleted: false });
 *
 * ★ 2026-10-05 并入统一门户版时改写：
 *   1. 只连【一个库】sms_class_jh（原包也是单库，这里只是把库名换成初高部的库）
 *   2. 关掉 `debug: true` —— 合并后 8004 是单进程，本模块的每条 SQL 都打到主控制台，
 *      会把主工程的日志淹没（原来独立部署时无所谓）
 *   3. 去掉进程级 SIGINT/SIGTERM 钩子 —— 主工程已统一管理优雅退出，
 *      这里再注册一次会让 `npm run dev` 热重载时反复销毁连接池
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
    // ⚠️ 统一日期/时间返回格式（设计规范）：
    //    date     → 'YYYY-MM-DD'
    //    datetime → 'YYYY-MM-DD HH:mm:ss'
    //    不设该选项会返回 JS Date，经 JSON 序列化变成带时区的 ISO 串，前端展示会差 8 小时。
    dateStrings: true,
  },
  pool: { min: 0, max: 10 },
});
