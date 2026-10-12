/**
 * 数据库连接（knex）
 *
 * 用法：import { db } from '../utils/db';
 *      const rows = await db('t_student_base').where({ is_deleted: false });
 */

import knex from 'knex';
import { config } from '../config';

const _knex = knex({
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

/**
 * 校验表名，防止「常量没导出 / 拼错」导致 knex 生成没有 from 的 SQL
 *
 * ⚠️ 踩过的坑：
 *    某次把 `FEE_TABLE` 误从 'shared-types' 里 import（其实它定义在 fee.service.ts），
 *    运行时值是 undefined，于是 knex 生成了
 *        select count(*) as `c` where `is_deleted` = ?
 *    ——没有 from！MySQL 报 ER_BAD_FIELD_ERROR，
 *    但错误信息是「数据库字段不存在」，非常难定位。
 *
 *    这里做一次显式校验：表名不是非空字符串就直接抛，报错信息指出是哪个变量。
 */
function assertTable(table: unknown, hint = ''): asserts table is string {
  if (typeof table !== 'string' || table.trim() === '') {
    throw new Error(
      `数据库表名非法（收到 ${JSON.stringify(table)}）${hint ? ` —— ${hint}` : ''}。` +
        `请检查该表名常量是否从正确的地方导出（表名常量应定义在各自的 service 里，不在 shared-types）。`,
    );
  }
}

/** 带表名校验的查询入口，用法与 knex 完全一致：db('t_finance_fee').where(...) */
export function db(table: string): knex.Knex.QueryBuilder;
export function db<TRecord extends {} = any, TResult = unknown[]>(
  table: string,
): knex.Knex.QueryBuilder<TRecord, TResult>;
export function db(table: string): any {
  assertTable(table, 'db() 的第一参数必须是表名字符串');
  return _knex(table);
}

/** 原始 knex 实例（需要事务、schema builder、fn/raw 等高级用法时用它） */
export const knexRaw = _knex;

/** 事务入口：db.transaction(async (trx) => {...}) */
db.transaction = _knex.transaction.bind(_knex);

/**
 * 常用静态方法透传，避免调用方还要 import knexRaw
 *
 * ⚠️⚠️ 这些方法必须【绑回 _knex 实例】再透传，不能写成 `db.raw = _knex.raw`。
 *
 * 踩过的坑（2026-10-03，做缴费统计接口时踩的）：
 *    写 `db.raw = _knex.raw` 后调 `db.raw('COUNT(*) as total')` 会抛
 *        TypeError: Cannot read properties of undefined (reading 'raw')
 *    因为 knex 把 raw / ref 这类方法定义成了依赖 `this.context` 的 getter
 *    （见 knex/lib/knex-builder/make-knex.js 的 CONTEXT_METHODS），
 *    裸引用脱离了实例，this 变成 undefined，内部 `this.context.raw` 自然炸掉。
 *    绑定 this 后就正常了。
 */
db.fn = _knex.fn;
db.raw = _knex.raw.bind(_knex);
db.schema = _knex.schema;
db.ref = _knex.ref.bind(_knex);
db.client = _knex.client;

/** 优雅关闭（进程退出时释放连接） */
process.on('SIGINT', async () => {
  await _knex.destroy();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await _knex.destroy();
  process.exit(0);
});
