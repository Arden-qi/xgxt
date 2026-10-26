/**
 * 「我能看哪些页面」轻量接口（**给全部账号用**，不要求 perm 模块权限）
 *
 * ============================================================
 * 前缀：GET /api/perm/page/my-paths
 *
 * 【为什么需要它 —— 与 /enabled-paths 的分工】
 *   `/api/perm/page/enabled-paths` 挂在 permAuth 下，要求账号 modules 含 perm。
 *   但「左侧菜单要不要渲染这个页面」是全系统每个账号都要问的问题 ——
 *   班主任、教务、财务、咨询、就业都不在 perm 模块里，调那个接口一律 403，
 *   于是前端只能「拉不到就不过滤」（store/pageConfig.ts 的降级约定）——
 *   **结果就是页面台账对这些账号的前端菜单形同虚设。**
 *
 *   本接口用【宽松鉴权】（只验 JWT、不要求 perm 模块），
 *   把两件事一次性算好下发：
 *     ① 全局板块台账（t_perm_page）：这个板块还有没有这个页面
 *     ② 职位页面台账（t_perm_role_page）：这个职位能不能看到这个页面 ★ 2026-10-07 新增
 *
 * 【返回】
 *   paths       —— 当前账号**最终可用**的页面 path（①②都过）
 *   allPaths    —— 台账登记过的全部 path（前端用来区分「不受台账管」与「被关了」）
 *   roleFiltered—— 本次是否叠加了职位级台账（false = 该账号的职位没人配过）
 *
 * 【降级】
 *   ① 未登录/令牌无效 → 401，前端 pageConfig 会静默降级为「不过滤」
 *   ② 查库失败 → 返回未叠加职位过滤的结果，绝不让页面凭空消失
 * ============================================================
 */

import { Router } from 'express';
import { ok } from '../utils/response';
import { wrap } from '../utils/wrap';
import { loadPathFlags } from '../services/page.service';
import { effectivePathsForRoles } from '../../utils/rolePageEffective';

export const myPathsRouter = Router();

myPathsRouter.get(
  '/',
  wrap(async (req, res) => {
    const flags = await loadPathFlags();

    let paths = flags.paths;
    let roleFiltered = false;

    try {
      const roles = Array.isArray(req.user?.roles) ? req.user.roles.map((r: any) => String(r)) : [];
      const rolePaths = await effectivePathsForRoles(roles);
      if (rolePaths) {
        roleFiltered = true;
        paths = flags.paths.filter((p) => rolePaths.has(p));
      }

      /* ★★ 2026-10-24：系统管理员的页面下发按【账号级 modules】收窄（与登录下发的
       *   visibleModules 同源 —— 见 portal/services/account.service.ts 的 ★★ 注释）。
       *
       *   【为什么】用户拍板：「权限管理员的账号应该只看见权限管理板块才对」。
       *   SYS_ADMIN 职位在权限树里天然勾着几乎所有页面（这是它作为"超级职位"的设计），
       *   如果 my-paths 照单全发，就会出现「页面管理里一片勾、林晓登录却看不到」或
       *   「菜单跟着页面走、管理员多出一堆板块」——两头都不对。
       *
       *   【口径】SYS_ADMIN 能拿到哪些页面 = 账号行 `t_sys_account.modules` 里声明的板块
       *   （token 里就有，不用回查库）∩ 职位页面集合。
       *   linx（modules=["perm"]）→ 只剩 `/` 与 `/perm/*`；
       *   想让管理员多看什么，就在账号管理里给他的 modules 加板块。
       *
       *   【不影响别人】这条只对 roleCodes 含 SYS_ADMIN 的账号生效；
       *   其余账号仍按「职位页面台账」原样下发（legacy / teaching 菜单靠它渲染，不能动）。 */
      if (roles.includes('SYS_ADMIN')) {
        const mods = new Set(
          Array.isArray(req.user?.modules) ? req.user.modules.map((m: any) => String(m)) : [],
        );
        paths = paths.filter((p) => {
          if (p === '/' || p === '') return true; // 工作台恒可见
          const seg = p.split('/')[1] || '';
          return mods.has(seg);
        });
      }
    } catch {
      // 职位台账算不出来 → 只按全局台账下发，绝不把页面全禁掉
    }

    res.json(ok({ paths, allPaths: flags.allPaths, roleFiltered }));
  }),
);

export default myPathsRouter;
