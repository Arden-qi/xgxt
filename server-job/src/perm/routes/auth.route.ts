/**
 * 权限管理模块 · 登录人信息路由
 *
 * ⚠️ 权限模块【不提供登录接口】—— 登录统一由门户负责。
 *    本路由只做一件事：把门户签发的 token 解成前端能直接用的 profile，
 *    让前端知道「我是谁、能看哪些页、能点哪些按钮」。
 *
 * 接口清单：
 *   GET /api/perm/auth/profile    当前登录人 + 可访问页面 + 可用操作码
 *   GET /api/perm/auth/menus      仅菜单（轻量，供侧栏用）
 *
 * ⚠️ 与财务模块的区别：
 *    权限模块不自己定义职位 —— 它本身就是职位表的维护方。
 *    页面可见性按【门户身份】算，见 shared-types/perm-auth.ts 的 permMenusOf()。
 *
 * ★★ 2026-10-22 新增 permissions（本轮用户指令）：
 *    「然后我可以给不同的职位勾选不同的功能、操作等，保存后该职位就保存我给的
 *      权限，没有给到的功能、操作权限就没办法操作或查看。」
 *
 *    以前本接口只下发 menuKeys（页面级），于是页面里的按钮**永远是全亮**的 ——
 *    职位权限分配页把某个动作取消掉，界面上按钮照样在，点了才被后端 403 打回。
 *    现在把「该职位的角色在权限树里被勾上的 perm:* 操作码」一并下发，
 *    前端就能在**渲染阶段**把没授权的按钮直接隐藏（与后端 checkPermission 同一套码）。
 *
 *    数据来源：t_perm_role_perm × PERM_TREE_ACTION_OPS（单一事实来源 = 权限树）
 *    口径：系统管理员（kind=sys_admin）不受限 → 下发通配 `perm:*`。
 */

import { Router } from 'express';
import { ok } from '../utils/response';
import { wrap } from '../utils/wrap';
import { authMiddleware } from '../middleware/auth';
import { buildPermProfile } from 'shared-types/perm';
import { resolveBusinessRoles } from '../../middleware/auth';
import { grantedOpsOfRoles } from '../../utils/roleGrantedOps';

const router = Router();

/** 系统管理员的通配操作码（前端 can() 见到它直接放行） */
const WILDCARD = 'perm:*';

/**
 * 取当前登录人在**权限管理板块**内可用的操作码
 *
 * ⚠️ token 里的 roles 只有门户级编码（SYS_ADMIN / SYS_STAFF），
 *    必须用登录名回查 sms_perm 才能拿到业务角色（校长 / 权限管理员 / …）——
 *    否则这里永远只认得系统管理员一个人。
 */
async function permOpsOf(user: any): Promise<string[]> {
  if (user?.kind === 'sys_admin' || (user?.permissions || []).includes('*')) {
    return [WILDCARD];
  }
  const account = String(user?.account || '');
  if (!account) return [];
  let roles: string[] = Array.isArray(user?.roles) ? user.roles : [];
  try {
    const real = await resolveBusinessRoles(account);
    if (real.length) roles = real;
  } catch {
    /* 查不到业务角色就用 token 里的，最差情况是空权限（按钮全隐藏，但页面还能进） */
  }
  return grantedOpsOfRoles(roles, 'perm:');
}

/* ============================================================
 * GET /api/perm/auth/profile
 * ============================================================ */

router.get(
  '/profile',
  authMiddleware,
  wrap(async (req, res) => {
    const profile = buildPermProfile(req.user);
    const permissions = await permOpsOf(req.user);
    res.json(
      ok({
        profile,
        menuKeys: profile.menuKeys,
        /** ⭐ 权限管理板块内可用的操作码（如 perm:职位权限分配:editPerm） */
        permissions,
      }),
    );
  }),
);

/* ============================================================
 * GET /api/perm/auth/menus
 * ============================================================ */

router.get(
  '/menus',
  authMiddleware,
  wrap(async (req, res) => {
    const profile = buildPermProfile(req.user);
    res.json(ok({ menuKeys: profile.menuKeys }));
  }),
);

export default router;
