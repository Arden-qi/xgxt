/**
 * 账号路由（统一账号 · 门户）
 *
 *   POST   /api/portal/account/login      登录（公开）
 *   GET    /api/portal/account/profile    当前登录人 + 可见模块
 *   GET    /api/portal/account/modules    全部模块注册表（账号管理页勾选用）
 *   GET    /api/portal/account/list       账号列表（管理员）
 *   GET    /api/portal/account/stats      账号统计（管理员）
 *   POST   /api/portal/account/add        新增账号（管理员）
 *   POST   /api/portal/account/update     编辑账号（管理员）
 *   POST   /api/portal/account/remove     删除账号（管理员）
 *   POST   /api/portal/account/toggle     启用/停用（管理员）
 */

import { Router } from 'express';
import { z } from 'zod';
import { BizCode, ModuleKey, MODULES, AccountKind } from 'shared-types/portal';
import type { SysAccount } from 'shared-types/portal';
import { ok, page } from '../utils/response';
import { validate } from '../middleware/validate';
import { wrap } from '../utils/wrap';
import { db } from '../utils/db';
import { BizError } from '../middleware/errorHandler';
import { requireSysAdmin, authMiddleware } from '../middleware/auth';
import {
  ACCOUNT_TABLE,
  login,
  toAccountView,
  visibleModulesOf,
  landingPathOf,
} from '../services/account.service';

const router = Router();

/* ============================================================
 * 1. 登录（公开）
 * ============================================================ */

router.post(
  '/login',
  validate(
    z.object({
      account: z.string().min(1, '请输入账号').max(50),
      password: z.string().min(1, '请输入密码').max(100),
    }),
  ),
  wrap(async (req, res) => {
    const body = (req as any).validated as { account: string; password: string };
    const result = await login(body.account, body.password);
    res.json(ok(result, `欢迎回来，${result.account.userName}`));
  }),
);

/* ============================================================
 * 2. 当前登录人 + 可见模块
 * ============================================================ */

router.get(
  '/profile',
  authMiddleware,
  wrap(async (req, res) => {
    const u = req.user!;
    const account = { ...u } as SysAccount;
    res.json(
      ok({
        account,
        visibleModules: visibleModulesOf(account),
        landingPath: landingPathOf(account),
      }),
    );
  }),
);

/* ============================================================
 * 3. 全部模块注册表（账号管理页勾选模块用）
 * ============================================================ */

router.get(
  '/modules',
  authMiddleware,
  wrap(async (_req, res) => {
    res.json(ok(MODULES.map((m) => ({ key: m.key, title: m.title, desc: m.desc }))));
  }),
);

/* ============================================================
 * 4. 账号列表 / 统计
 * ============================================================ */

router.get(
  '/list',
  authMiddleware,
  requireSysAdmin,
  wrap(async (req, res) => {
    const q = req.query as any;
    const query = db(ACCOUNT_TABLE).where('is_deleted', false);
    if (q.keyword) {
      query.andWhere((qb: any) => {
        qb.where('user_name', 'like', `%${q.keyword}%`)
          .orWhere('account', 'like', `%${q.keyword}%`)
          .orWhere('phone', 'like', `%${q.keyword}%`);
      });
    }
    if (q.kind) query.andWhere('kind', q.kind);
    if (q.module) query.andWhere('modules', 'like', `%${q.module}%`);

    const totalRow: any = await query.clone().count({ c: '*' }).first();
    const total = Number(totalRow?.c || 0);

    const p = Number(q.page) || 1;
    const size = Number(q.size) || 20;
    const rows: any[] = await query
      .clone()
      .orderBy('create_time', 'asc')
      .limit(size)
      .offset((p - 1) * size);

    res.json(page(rows.map((r) => toAccountView(r, true)), total, { page: p, size }));
  }),
);

router.get(
  '/stats',
  authMiddleware,
  requireSysAdmin,
  wrap(async (_req, res) => {
    const rows: any[] = await db(ACCOUNT_TABLE).where('is_deleted', false).select('kind', 'modules', 'active');
    res.json(
      ok({
        total: rows.length,
        active: rows.filter((r) => r.active).length,
        inactive: rows.filter((r) => !r.active).length,
        sysAdminCount: rows.filter((r) => r.kind === AccountKind.SYS_ADMIN).length,
        consultantCount: rows.filter((r) => String(r.modules || '').includes(ModuleKey.CONSULT)).length,
        financeCount: rows.filter((r) => String(r.modules || '').includes(ModuleKey.FINANCE)).length,
      }),
    );
  }),
);

/* ============================================================
 * 5. 增删改（仅管理员）
 * ============================================================ */

const accountBody = z.object({
  account: z.string().min(1).max(50),
  password: z.string().min(1).max(100).optional(),
  userName: z.string().min(1).max(50),
  kind: z.enum([AccountKind.SYS_ADMIN, AccountKind.MODULE_OWNER]),
  title: z.string().max(50).optional(),
  dept: z.string().max(50).optional(),
  phone: z.string().max(20).optional(),
  /** ⭐ 可访问模块 */
  modules: z.array(z.string()).min(1, '至少要分配一个模块'),
  active: z.boolean().optional(),
});

router.post(
  '/add',
  authMiddleware,
  requireSysAdmin,
  validate(accountBody),
  wrap(async (req, res) => {
    const b = (req as any).validated as z.infer<typeof accountBody>;
    const exists = await db(ACCOUNT_TABLE).where({ account: b.account }).first();
    if (exists) throw new BizError(BizCode.PARAM_ERROR, `账号「${b.account}」已存在`);

    const id = randomId();
    await db(ACCOUNT_TABLE).insert({
      id,
      create_time: new Date(),
      create_by: req.user!.accountId,
      create_by_name: req.user!.userName,
      is_deleted: false,
      account: b.account,
      /**
       * ★ 2026-10-14：新增账号时未填密码的默认值。
       *
       *   这是**演示便利**（管理员建号时可以不填密码），默认值与 README 里
       *   公开的演示账号一致。但它毕竟是个「公开可猜的初始密码」，
       *   所以现在允许用 .env 的 `DEFAULT_ACCOUNT_PASSWORD` 覆盖；
       *   生产环境建议：要么在 .env 里换掉它，要么让前端把密码设为必填。
       */
      password: b.password || process.env.DEFAULT_ACCOUNT_PASSWORD || '123456',
      user_name: b.userName,
      kind: b.kind,
      title: b.title || null,
      dept: b.dept || null,
      phone: b.phone || null,
      modules: JSON.stringify(b.modules),
      active: b.active !== false,
    });

    const row = await db(ACCOUNT_TABLE).where({ id }).first();
    res.json(ok(toAccountView(row, true), `账号「${b.account}」创建成功`));
  }),
);

router.post(
  '/update',
  authMiddleware,
  requireSysAdmin,
  validate(accountBody.partial().extend({ accountId: z.string().min(1) })),
  wrap(async (req, res) => {
    const b = (req as any).validated as any;
    const row = await db(ACCOUNT_TABLE).where({ id: b.accountId, is_deleted: false }).first();
    if (!row) throw new BizError(BizCode.PARAM_ERROR, '账号不存在');

    const patch: any = { update_time: new Date(), update_by: req.user!.accountId };
    if (b.userName !== undefined) patch.user_name = b.userName;
    if (b.password) patch.password = b.password;
    if (b.kind !== undefined) patch.kind = b.kind;
    if (b.title !== undefined) patch.title = b.title || null;
    if (b.dept !== undefined) patch.dept = b.dept || null;
    if (b.phone !== undefined) patch.phone = b.phone || null;
    if (b.modules !== undefined) patch.modules = JSON.stringify(b.modules);
    if (b.active !== undefined) patch.active = b.active;

    await db(ACCOUNT_TABLE).where({ id: b.accountId }).update(patch);
    const updated = await db(ACCOUNT_TABLE).where({ id: b.accountId }).first();
    res.json(ok(toAccountView(updated, true), '已保存'));
  }),
);

router.post(
  '/remove',
  authMiddleware,
  requireSysAdmin,
  validate(z.object({ accountId: z.string().min(1) })),
  wrap(async (req, res) => {
    const { accountId } = (req as any).validated as { accountId: string };
    // ⚠️ 不许删自己，否则一不留神把自己锁在门外
    if (accountId === req.user!.accountId) {
      throw new BizError(BizCode.PARAM_ERROR, '不能删除当前登录的账号');
    }
    await db(ACCOUNT_TABLE)
      .where({ id: accountId })
      .update({ is_deleted: true, active: false, update_time: new Date() });
    res.json(ok(null, '已删除'));
  }),
);

router.post(
  '/toggle',
  authMiddleware,
  requireSysAdmin,
  validate(z.object({ accountId: z.string().min(1), active: z.boolean() })),
  wrap(async (req, res) => {
    const { accountId, active } = (req as any).validated as { accountId: string; active: boolean };
    if (accountId === req.user!.accountId && !active) {
      throw new BizError(BizCode.PARAM_ERROR, '不能停用当前登录的账号');
    }
    await db(ACCOUNT_TABLE).where({ id: accountId }).update({ active, update_time: new Date() });
    res.json(ok(null, active ? '已启用' : '已停用'));
  }),
);

function randomId(): string {
  // 简单 UUID v4 形态
  const s = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).slice(1);
  return `${s()}${s()}-${s()}-${s()}-${s()}-${s()}${s()}${s()}`;
}

export default router;
