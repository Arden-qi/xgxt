/**
 * 财务 · 催费提醒接口（2026-10-26）
 * ============================================================
 *
 * 【规则】只催「餐费 / 住宿费 / 保险费」三类有到期概念的费，
 *   判定依据是**财务账单的到期日**，提前 N 天（默认 15，可在费用标准页改）进催费名单。
 *
 * 接口：
 *   GET  /api/finance/urge/ahead-days        读提前天数
 *   POST /api/finance/urge/ahead-days        改提前天数（需 finance:standard:manage）
 *   GET  /api/finance/urge/list              催费名单（按到期日）
 */

import { Router } from 'express';
import { z } from 'zod';
import { ok } from '../utils/response';
import { wrap } from '../utils/wrap';
import { validate } from '../middleware/validate';
import { checkPermission } from '../middleware/auth';
import { getUrgeAheadDays, saveUrgeAheadDays, listUrgeByExpire } from '../services/urge.service';

const urgeRouter = Router();

/* ---------------- 提前天数 ---------------- */

urgeRouter.get(
  '/ahead-days',
  wrap(async (_req, res) => {
    res.json(ok({ days: await getUrgeAheadDays() }));
  }),
);

const aheadSchema = z.object({
  days: z.coerce.number().int('只能是整数').min(0, '不能小于 0').max(365, '不能大于 365'),
});

urgeRouter.post(
  '/ahead-days',
  checkPermission('finance:standard:manage'),
  validate(aheadSchema),
  wrap(async (req, res) => {
    const { days } = (req as any).validated as z.infer<typeof aheadSchema>;
    const saved = await saveUrgeAheadDays(days, (req as any).user?.userName);
    res.json(ok({ days: saved }, `催费提前天数已设为 ${saved} 天`));
  }),
);

/* ---------------- 催费名单 ---------------- */

const listSchema = z.object({
  className: z.string().optional(),
  keyword: z.string().optional(),
  feeType: z.coerce.number().int().optional(),
  deptCode: z.coerce.number().int().optional(),
});

urgeRouter.get(
  '/list',
  validate(listSchema),
  wrap(async (req, res) => {
    const q = (req as any).validated as z.infer<typeof listSchema>;
    const ahead = await getUrgeAheadDays();
    const r = await listUrgeByExpire(ahead, q);
    res.json(ok(r));
  }),
);

export default urgeRouter;
