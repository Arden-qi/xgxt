import knex, { Knex } from 'knex';
import { config } from './config';

/**
 * 两个数据库连接
 *
 *  - db        业务库 sms_class   —— 本模块拥有，可读写
 *  - commonDb  共享库 sms_common  —— 存外部模块同步来的只读副本
 *
 * ⚠️ 铁律：不许直接读别人的数据库表。commonDb 里只放「别人推给我」的副本，
 *         需要别人的实时数据一律走 HTTP 接口。
 */
function create(connectionDatabase: string): Knex {
  return knex({
    client: 'mysql2',
    connection: {
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      database: connectionDatabase,
      charset: 'utf8mb4',
      timezone: '+08:00',
      dateStrings: true,
    },
    pool: { min: 0, max: 10 },
  });
}

export const db: Knex = create(config.db.nameClass);
export const commonDb: Knex = create(config.db.nameCommon);

export async function pingAll(): Promise<{ class: string; common: string }> {
  const out = { class: 'unknown', common: 'unknown' };
  try {
    await db.raw('select 1');
    out.class = 'ok';
  } catch (e) {
    out.class = `fail: ${(e as Error).message}`;
  }
  try {
    await commonDb.raw('select 1');
    out.common = 'ok';
  } catch (e) {
    out.common = `fail: ${(e as Error).message}`;
  }
  return out;
}

export async function closeAll(): Promise<void> {
  await db.destroy();
  await commonDb.destroy();
}
