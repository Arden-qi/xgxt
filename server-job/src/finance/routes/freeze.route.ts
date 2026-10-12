/**
 * 冻结名单 · 路由
 * 接口前缀：/api/finance/freeze
 *
 * 接口清单：
 *   GET    /list       冻结名单（分页 + 筛选，含餐费/住宿费剩余天数）
 *   POST   /unfreeze   解冻
 *   POST   /manual     手工冻结（兜底）
 *   POST   /sync       ⭐ 学籍状态同步（供教务/市场咨询模块调用）
 */

import { Router } from 'express';
import { z } from 'zod';
import { ok, page } from '../utils/response';
import { wrap } from '../utils/wrap';
import { validate } from '../middleware/validate';
import { checkPermission } from '../middleware/auth';
import {
  toFreezeListItem,
  buildFreezeQuery,
  unfreeze,
  manualFreeze,
  syncStudentStatus,
} from '../services/freeze.service';

export const freezeRouter = Router();

function operatorOf(req: any): { userId: string; userName: string } {
  return {
    userId: req.user?.userId || 'system',
    userName: req.user?.userName || '系统',
  };
}

/* ============================================================
 * 1. 冻结名单
 *    GET /api/finance/freeze/list?page=1&size=20&onlyFrozen=true
 * ============================================================ */

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(100).default(20),
  studentNo: z.string().optional(),
  studentName: z.string().optional(),
  classId: z.string().optional(),
  deptCode: z.coerce.number().int().optional(),
  freezeSource: z.coerce.number().int().optional(),
  // ⚠️ query 里的布尔是字符串，要显式转换，否则 'false' 会被当成 true
  onlyFrozen: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  keyword: z.string().optional(),
});

freezeRouter.get(
  '/list',
  validate(listSchema),
  wrap(async (req, res) => {
    const q = (req as any).validated as z.infer<typeof listSchema>;
    const query = buildFreezeQuery(q);

    const [{ total }] = await query.clone().count({ total: '*' });
    const rows = await query
      .clone()
      .select('*')
      .orderBy('freeze_date', 'desc')
      .limit(q.size)
      .offset((q.page - 1) * q.size);

    res.json(page(rows.map(toFreezeListItem), Number(total), q));
  }),
);

/* ============================================================
 * 2. 解冻
 *    POST /api/finance/freeze/unfreeze
 * ============================================================ */

const unfreezeSchema = z.object({
  id: z.string().min(1, '必须传 id'),
  unfreezeReason: z.string().min(1, '解冻原因必填').max(255),
});

freezeRouter.post(
  '/unfreeze',
  checkPermission('finance:freeze:manage'),
  validate(unfreezeSchema),
  wrap(async (req, res) => {
    const body = (req as any).validated as z.infer<typeof unfreezeSchema>;
    await unfreeze(body.id, body.unfreezeReason, operatorOf(req));
    res.json(ok(null, '已解冻'));
  }),
);

/* ============================================================
 * 3. 手工冻结（兜底）
 *    POST /api/finance/freeze/manual
 * ============================================================ */

const manualSchema = z.object({
  studentId: z.string().min(1, '学生ID必填'),
  freezeScope: z.string().max(64).optional(),
  freezeReason: z.string().max(64).optional(),
});

freezeRouter.post(
  '/manual',
  checkPermission('finance:freeze:manage'),
  validate(manualSchema),
  wrap(async (req, res) => {
    const body = (req as any).validated as z.infer<typeof manualSchema>;
    const r = await manualFreeze(body, operatorOf(req));
    res.json(ok(r, '已冻结'));
  }),
);

/* ============================================================
 * 4. ⭐ 学籍状态同步（跨模块联动接口）
 *    POST /api/finance/freeze/sync
 *
 * 调用方：教务管理 / 市场咨询 模块
 *   学生学籍变成「休学」→ 自动冻结餐费、住宿费
 *   学生复学 → 自动解冻
 *
 * ⚠️ 跨模块三铁律（见《接口契约规范》第 6 节）：
 *    ① 不直接读别人表（所以由对方调我，不是我读对方）
 *    ② 设超时
 *    ③ 失败要有兜底（本接口永远返回 200 + 中文 message，不抛 500 给对方）
 * ============================================================ */

const syncSchema = z.object({
  studentId: z.string().min(1, '学生ID必填'),
  studentStatus: z.coerce.number().int().min(1).max(11, '学生状态取值 1~11'),
  changeTime: z.string().optional(),
  // 以下为兜底字段：拿不到学生表数据时，调用方可直接带过来
  studentNo: z.string().optional(),
  studentName: z.string().optional(),
  classId: z.string().optional(),
  className: z.string().optional(),
  deptCode: z.coerce.number().int().optional(),
});

freezeRouter.post(
  '/sync',
  // ⚠️ 这里不挂 checkPermission：跨模块机器调用，靠服务间鉴权（后续接网关）
  validate(syncSchema),
  wrap(async (req, res) => {
    const body = (req as any).validated as z.infer<typeof syncSchema>;
    const result = await syncStudentStatus(body, {
      userId: 'system',
      userName: '学籍同步',
    });
    res.json(ok(result, result.message));
  }),
);

export default freezeRouter;
