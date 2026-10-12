/**
 * 财务管理模块 · 登录人信息路由
 *
 * ⚠️ 财务模块【不提供登录接口】—— 登录统一由门户（8000）负责。
 *    本路由只做一件事：把门户签发的 token 解成前端能直接用的 profile，
 *    让前端知道「我是谁、我在财务模块里是什么角色、能看哪些页」。
 *
 * 接口清单：
 *   GET /api/finance/auth/profile    当前登录人 + 财务角色 + 可访问页面
 *   GET /api/finance/auth/menus      仅菜单（轻量，供侧栏用）
 *
 * ⚠️⚠️ 2026-10-03 用户指令（本轮核心改造）：
 *   「权限管理内的权限分配和财务市场咨询联调一下，
 *     让权限管理内的权限可以正常分配。」
 *
 *   改造前：meuKeys 一律由 resolveFinanceRole() + FINANCE_ROLE_MENUS 硬算
 *           → 权限分配页改什么都影响不到财务，分配等于没做。
 *   改造后：菜单【优先按权限模块的权限分配结果】来算：
 *           ① 调权限模块 /api/perm/remote/account-profile 取账号的功能点清单
 *           ② 用 financeMenusFromPerm() 换算成财务 menuKeys
 *           ③ 拿到结果才算「权限分配真的生效了」
 *           ④ 权限模块不可用 / 账号没配过 → 回退到按岗位的兜底菜单，
 *              并返回 permDegraded=true 让前端提示（绝不让用户进不来）
 *
 *   ⚠️ 系统管理员（sys_admin）不受权限分配限制，始终全量菜单 ——
 *      这是 2026-10-03 早些时候定下的口径，本次保留。
 */

import { Router } from 'express';
import { ok } from '../utils/response';
import { wrap } from '../utils/wrap';
import { authMiddleware } from '../middleware/auth';
import {
  FINANCE_ROLE_NAME,
  FINANCE_ROLE_MENUS,
  FinanceRole,
  financeMenusFromPerm,
} from 'shared-types/finance';
import type { FinanceProfile } from 'shared-types/finance';
import { fetchPermProfile } from '../services/perm.client';

const router = Router();

/**
 * 由 token 里的信息推断「财务模块内角色」
 *
 * ⚠️ 规则（按用户口径「管理员全开 + 各岗按职责」）：
 *    ① 统一门户的系统管理员（kind=sys_admin）→ 财务负责人（模块内全开）
 *    ② 其余被授权进财务模块的账号 → 财务负责人
 *       （当前财务模块只有「负责人」这一档实际在用；
 *       会计/出纳是预留档位，等实际分岗后在此细化）
 *
 * ⚠️⚠️ 2026-10-03 用户指令：
 *    「将系统管理员的权限设置为最高，所有页面都可以访问」
 *    这里显式保证：系统管理员（kind=sys_admin 或 permissions 含 '*'）
 *    一定拿到 ALL_MENUS 全量页面，不依赖角色档位表，避免后续细化分岗时
 *    把管理员的某页误关掉。
 */
function resolveFinanceRole(user: any): FinanceRole {
  if (isSysAdmin(user)) return FinanceRole.FINANCE_ADMIN;
  return FinanceRole.FINANCE_ADMIN;
}

/** 是否系统管理员（最高权限） */
function isSysAdmin(user: any): boolean {
  return (
    user?.kind === 'sys_admin' ||
    (user?.permissions || []).includes('*') ||
    (user?.roles || []).includes('SYS_ADMIN')
  );
}

/** 组装 profile */
function buildProfile(user: any): FinanceProfile {
  const financeRole = resolveFinanceRole(user);
  // ⭐ 系统管理员 → 强制全量菜单（不只是角色档位表里那一份）
  const menuKeys = isSysAdmin(user)
    ? Object.values(FINANCE_ROLE_MENUS).reduce<string[]>(
        (all, keys) => Array.from(new Set([...all, ...keys])),
        [],
      )
    : FINANCE_ROLE_MENUS[financeRole] || [];
  return {
    accountId: user.userId,
    account: user.account || '',
    userName: user.userName || '',
    kind: user.kind || 'module_owner',
    financeRole,
    financeRoleName: FINANCE_ROLE_NAME[financeRole] || '财务人员',
    menuKeys,
    canManageStandard: menuKeys.includes('standard'),
  };
}

/* ============================================================
 * GET /api/finance/auth/profile
 *
 * ⭐ 菜单来源（2026-10-03 改造后的优先级）：
 *    ① 系统管理员 → 全量菜单（不受权限分配限制）
 *    ② 普通账号   → 权限模块的「权限分配」结果（真正的联调）
 *    ③ 权限模块不可用 / 账号没在权限库配过 → 按岗位角色的兜底菜单
 * ============================================================ */

router.get(
  '/profile',
  authMiddleware,
  wrap(async (req, res) => {
    const user = req.user as any;
    const profile = buildProfile(user);

    // ---- 系统管理员：全开，不查权限库（少一次网络调用）----
    if (isSysAdmin(user)) {
      res.json(ok({ profile, menuKeys: profile.menuKeys, menuSource: 'sys_admin', permDegraded: false }));
      return;
    }

    // ---- 普通账号：按「权限分配」的结果算菜单 ----
    const perm = await fetchPermProfile(profile.account);

    if (perm.profile) {
      const menuKeys = financeMenusFromPerm(perm.profile);
      // ⚠️ 权限库里确实有这个人，但一个财务功能点都没勾 →
      //    说明权限分配页还没给它的角色配财务权限。
      //    这时仍给首页兜底，否则进来是全白页 + 路由守卫死循环。
      const finalKeys = menuKeys.length ? menuKeys : ['finance'];
      res.json(
        ok({
          profile: { ...profile, menuKeys: finalKeys, canManageStandard: finalKeys.includes('standard') },
          menuKeys: finalKeys,
          menuSource: 'perm_assign',
          permDegraded: false,
          permRoles: perm.profile.roleNames,
        }),
      );
      return;
    }

    // ---- 降级：用岗位角色的兜底菜单 ----
    res.json(
      ok({
        profile,
        menuKeys: profile.menuKeys,
        menuSource: 'fallback',
        permDegraded: true,
        permTip: perm.degradeReason || '权限模块暂时不可用，当前使用本地兜底菜单。',
      }),
    );
  }),
);

/* ============================================================
 * GET /api/finance/auth/menus
 * ============================================================ */

router.get(
  '/menus',
  authMiddleware,
  wrap(async (req, res) => {
    const user = req.user as any;
    const profile = buildProfile(user);

    if (isSysAdmin(user)) {
      res.json(ok({ menuKeys: profile.menuKeys, menuSource: 'sys_admin', permDegraded: false }));
      return;
    }

    const perm = await fetchPermProfile(profile.account);
    if (perm.profile) {
      const menuKeys = financeMenusFromPerm(perm.profile);
      const finalKeys = menuKeys.length ? menuKeys : ['finance'];
      res.json(ok({ menuKeys: finalKeys, menuSource: 'perm_assign', permDegraded: false }));
      return;
    }

    res.json(
      ok({
        menuKeys: profile.menuKeys,
        menuSource: 'fallback',
        permDegraded: true,
        permTip: perm.degradeReason || '权限模块暂时不可用，当前使用本地兜底菜单。',
      }),
    );
  }),
);

export default router;
