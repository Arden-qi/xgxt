import { Knex } from 'knex';
import { uuid, now } from './ids';
import { AuthUser } from './authUser';

/**
 * 通用仓储助手
 *
 * 数据字典第三节规定：所有表都有 6 个公共字段
 *   id / create_time / create_by / update_time / update_by / is_deleted
 * ⚠️ 禁止物理删除：一律 `update is_deleted = 1`
 */

/** 只查未删除的数据（所有列表/详情查询都必须带上） */
export function notDeleted<T extends Knex.QueryBuilder>(qb: T): T {
  return qb.where('is_deleted', 0) as T;
}

/** 插入时填充公共字段 */
export function baseInsert(user?: AuthUser, id?: string): Record<string, unknown> {
  const uid = user?.userId ?? 'system';
  const t = now();
  return {
    id: id ?? uuid(),
    create_time: t,
    create_by: uid,
    update_time: t,
    update_by: uid,
    is_deleted: 0,
  };
}

/** 更新时填充公共字段 */
export function baseUpdate(user?: AuthUser): Record<string, unknown> {
  const uid = user?.userId ?? 'system';
  return { update_time: now(), update_by: uid };
}

export interface PageArgs {
  page: number;
  size: number;
}

export interface Paged<T> {
  total: number;
  page: number;
  size: number;
  list: T[];
}

/**
 * 分页查询（用窗口函数之外最朴素的两次查询，MySQL 8 上足够快）
 *
 * ⚠️ 铁律：分页参数只叫 page / size，返回结构固定 { total, page, size, list }
 */
export async function paginate<R>(
  baseQuery: Knex.QueryBuilder,
  args: PageArgs,
  run: (qb: Knex.QueryBuilder) => Promise<R[]>,
): Promise<Paged<R>> {
  const page = Math.max(1, Number(args.page) || 1);
  const size = Math.min(200, Math.max(1, Number(args.size) || 20));

  // 计数：复制一份清掉 select / order / limit
  const countQb = baseQuery.clone().clearSelect().clearOrder().count({ c: '*' }).first();
  const countRow = (await countQb) as unknown as { c?: number | string } | undefined;
  const total = Number(countRow?.c ?? 0);

  const list = await run(baseQuery.clone().limit(size).offset((page - 1) * size));
  return { total, page, size, list };
}

/**
 * 取「今天的最大单号」，用于生成下一个序号（同前缀同天递增）
 *
 * ★ 第 4 期第 2 批改造：`table` 参数从「表名字符串」改成「已路由的 query builder」
 *
 * 【为什么必须改签名 —— 这是最容易漏的隐藏点】
 *   原来签名是 `maxApplyNo(knex, table: string, ...)`，内部 `knex(table)`。
 *   `knex(table)` 是**裸访问**：即使全局切读开关打开，这一句仍然查老表。
 *   而老表一旦被删，单号生成会直接报「数据表不存在」——
 *   **症状是「列表能看，新建就挂」**，极难联想到是删表引起的。
 *   而且它是被 `suspend/refund/upgrade` 三个路由共用的，改漏一个就有一个单号重复。
 *
 * 【改成什么】
 *   入参收query builder，由调用方用 `tbl(db, SRC, 't_class_xxx_apply', STAGE)` 生成。
 *   → 路由决策上移到调用方，本函数只负责「在给定的表上查最大单号」，
 *     不再自己 require连接、也不再关心表名。
 */
export async function maxApplyNo(
  base: Knex.QueryBuilder,
  _legacyTable: string,
  prefix: string,
  ymd: string,
): Promise<string | null> {
  const row = (await base
    .where('apply_no', 'like', `${prefix}${ymd}%`)
    .max({ m: 'apply_no' })
    .first()) as unknown as { m?: string } | undefined;
  return row?.m ?? null;
}

/**
 * 取最大学号（用于自动生成学号）
 *
 * ★★ 第 4 期改动：入参从「表名」改成「已路由好的 QueryBuilder」
 *
 *   原来签名是 `(knex, likePattern)`，内部写死 `knex('t_class_student')` ——
 *   切读统一表时这里**仍是裸访问老表**，老表删掉后症状是
 *   「列表能看，新建时学号不生成（undefined）」。
 *   这和第 2 批 `maxApplyNo` 是同一个坑，属于 `lib/` 下的隐藏点，扫业务目录扫不到。
 *
 *   与 `maxApplyNo` 一致：调用方传 `tbl(db, SRC, 't_class_student', STAGE)`。
 */
export async function maxStudentNo(
  base: Knex.QueryBuilder,
  likePattern: string,
): Promise<string | null> {
  const row = (await base
    .where('student_no', 'like', likePattern)
    .max({ m: 'student_no' })
    .first()) as unknown as { m?: string } | undefined;
  return row?.m ?? null;
}
