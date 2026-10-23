import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db';
import { Errors, ok, pageData } from '../../http/response';
import { pageQuerySchema, q, validate } from '../../lib/validate';
import { baseUpdate, notDeleted } from '../../lib/repo';
import { rowsToCamel } from '../../lib/case';
import { now } from '../../lib/ids';
import { ApplyTypeName, NotifyTypeName } from '../../lib/dict';
import { wrap } from '../../middleware/error';
import { tbl, uniUpdCols } from '../../../teaching/shared/uniTable';
import { actorId, actorIds, isActor } from '../../../utils/actor';

const SRC = 'sms_class';
const STAGE = 'class' as const;

const NOTIFY_T = 't_class_notify';

/** 站内通知：老表 17 列 → 统一表 t_uni_notify 37 列，缺 0 */
const NOTIFY = () => tbl(db, SRC, NOTIFY_T, STAGE);

/**
 * 站内通知（用户确认方案：站内消息 + 未读角标）
 *
 * 通知由系统在流程节点自动生成（见 modules/shared/flow.ts），
 * 这里只负责**查与标记已读**：
 *   - 只能看到发给自己的通知（receiver_id = 当前登录人）
 */
export const notifyRouter = Router();

const listSchema = z.object({
  ...pageQuerySchema.shape,
  notifyType: z.coerce.number().int().optional(),
  applyType: z.coerce.number().int().optional(),
  onlyUnread: z.coerce.boolean().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

function decorate(row: Record<string, unknown>): Record<string, unknown> {
  const c = rowsToCamel<Record<string, unknown>>([row])[0];
  return {
    ...c,
    notifyTypeName: NotifyTypeName[row.notify_type as number] ?? '通知',
    applyTypeName: row.apply_type === null ? null : (ApplyTypeName[row.apply_type as number] ?? null),
  };
}

/**
 * @openapi
 * /api/class/notify/list:
 *   get:
 *     tags: [站内通知]
 *     summary: 6.1 我的通知列表
 *     description: 只返回发给当前登录人的通知；`onlyUnread=true` 只看未读。
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer } }
 *       - { in: query, name: size, schema: { type: integer } }
 *       - { in: query, name: onlyUnread, schema: { type: boolean } }
 *     responses:
 *       200: { description: 分页列表 }
 */
notifyRouter.get(
  '/list',
  validate({ query: listSchema }),
  wrap(async (req, res) => {
    const user = req.user!;
    const query = q<z.infer<typeof listSchema>>(req);

    const base = NOTIFY();
    notDeleted(base);
    base.whereIn('receiver_id', actorIds(user));
    if (query.notifyType) base.where('notify_type', query.notifyType);
    if (query.applyType) base.where('apply_type', query.applyType);
    if (query.onlyUnread) base.where('is_read', 0);
    if (query.startDate) base.where('create_time', '>=', `${query.startDate} 00:00:00`);
    if (query.endDate) base.where('create_time', '<=', `${query.endDate} 23:59:59`);
    base.orderBy('create_time', 'desc');

    const countRow = (await base.clone().clearSelect().clearOrder().count({ c: '*' }).first()) as unknown as {
      c?: number;
    };
    const total = Number(countRow?.c ?? 0);
    const page = Math.max(1, Number(query.page) || 1);
    const size = Math.min(200, Math.max(1, Number(query.size) || 20));
    const rows = (await base.limit(size).offset((page - 1) * size)) as Array<Record<string, unknown>>;

    return ok(res, pageData(total, page, size, rows.map(decorate)), '查询成功');
  }),
);

/**
 * @openapi
 * /api/class/notify/unread:
 *   get:
 *     tags: [站内通知]
 *     summary: 6.2 未读数（顶栏红点）
 *     description: 返回总数与按类型拆分，前端用于「铃铛 + 红点 + 分类角标」。
 *     responses:
 *       200:
 *         description: 未读统计
 */
notifyRouter.get(
  '/unread',
  wrap(async (req, res) => {
    const user = req.user!;
    const rows = (await notDeleted(NOTIFY())
      .whereIn('receiver_id', actorIds(user)).andWhere('is_read', 0)
      .select('notify_type')
      .count({ c: '*' })
      .groupBy('notify_type')) as Array<Record<string, unknown>>;

    const byType = rows.map((r) => ({
      notifyType: r.notify_type as number,
      notifyTypeName: NotifyTypeName[r.notify_type as number] ?? '通知',
      count: Number(r.c ?? 0),
    }));
    const total = byType.reduce((acc, x) => acc + x.count, 0);

    return ok(res, { total, byType }, total > 0 ? `您有 ${total} 条未读通知` : '暂无未读通知');
  }),
);

/**
 * @openapi
 * /api/class/notify/read:
 *   post:
 *     tags: [站内通知]
 *     summary: 6.3 标记通知已读
 *     description: 传 `id` 标记单条；不传则标记全部已读（等价 /readAll）。
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               id: { type: string, description: 不传表示全部已读 }
 *               ids:
 *                 type: array
 *                 items: { type: string }
 *     responses:
 *       200: { description: 已标记条数 }
 */
notifyRouter.post(
  '/read',
  validate({
    body: z.object({
      id: z.string().optional(),
      ids: z.array(z.string()).optional(),
    }),
  }),
  wrap(async (req, res) => {
    const user = req.user!;
    const { id, ids } = req.body as { id?: string; ids?: string[] };

    const qb = NOTIFY().whereIn('receiver_id', actorIds(user)).andWhere('is_read', 0);
    const targets = (ids ?? (id ? [id] : [])).filter(Boolean);
    if (targets.length) qb.whereIn('id', targets);

    const patch = await uniUpdCols(db, SRC, NOTIFY_T, {
      is_read: 1,
      read_time: now(),
      ...baseUpdate(user),
    });
    const affected = await qb.update(patch as never);
    return ok(res, { affected: Number(affected ?? 0) }, targets.length ? '已标记已读' : '已全部标记为已读');
  }),
);

/**
 * @openapi
 * /api/class/notify/detail:
 *   get:
 *     tags: [站内通知]
 *     summary: 6.4 通知详情（点开后自动标记已读）
 *     parameters:
 *       - { in: query, name: id, schema: { type: string }, required: true }
 *     responses:
 *       200: { description: 通知详情 }
 */
notifyRouter.get(
  '/detail',
  validate({ query: z.object({ id: z.string().min(1, '缺少通知ID') }) }),
  wrap(async (req, res) => {
    const user = req.user!;
    const { id } = q<{ id: string }>(req);

    const row = (await notDeleted(NOTIFY()).where({ id }).first()) as
      | Record<string, unknown>
      | undefined;
    if (!row) throw Errors.notifyNotFound();
    if (!isActor(user, row.receiver_id) && !((user.roles || []) as string[]).includes(String(row.receiver_id))) {
      throw Errors.noOperationPermission('只能查看发给自己的通知');
    }
    if (!row.is_read) {
      await NOTIFY().where({ id }).update(
        (await uniUpdCols(db, SRC, NOTIFY_T, {
          is_read: 1,
          read_time: now(),
          ...baseUpdate(user),
        })) as never,
      );
      row.is_read = 1;
    }
    return ok(res, decorate(row), '查询成功');
  }),
);
