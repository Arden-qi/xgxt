/**
 * ⭐ 统一账号服务（门户）
 *
 * ⚠️⚠️ 2026-10-02：全系统「一个账号表管跨模块角色」
 *
 * 设计：
 *    t_sys_account —— 统一账号表
 *      一个账号通过 modules 字段声明「能进哪些模块」
 *        系统管理员 → ['consult','finance']（全部）
 *        咨询负责人 → ['consult']
 *        财务负责人 → ['finance']
 *
 *    登录后签发含 modules 的 JWT，门户据此渲染目录树，
 *    各业务模块据此判断「这人能不能进我这儿」。
 *
 * ⚠️ 密码：演示环境明文存。正式环境必须换 bcrypt。
 */

import { randomUUID } from 'crypto';
import {
  BizCode,
  ModuleKey,
  MODULES,
  AccountKind,
  ModuleDef,
} from 'shared-types/portal';
import type { SysAccount, PortalLoginResult } from 'shared-types/portal';
import { db } from '../utils/db';
import { BizError } from '../middleware/errorHandler';
import { signToken } from '../utils/jwt';
import type { JwtPayload } from '../utils/jwt';
/* ★ 2026-10-23：把「职位 → 页面」换算成「能看到哪些板块」，供 visibleModules 合成用 */
import { effectiveModuleScopeOfAccount } from '../../utils/rolePageEffective';
/* ★★ 2026-10-24：legacy 模块的可见性追加「职位页面权限码」通道（修「页面管理给了
 *   权限、登录却什么都看不到」—— 见 resolveVisibleModules 内 ★★ 注释） */
import { getUserPagePermissions } from '../../utils/pagePermissionSource';
import { moduleOfPageCode } from '../../config/pagePermissions';

export const ACCOUNT_TABLE = 't_sys_account';

/** 密码策略视图（给改密弹窗做提示 + 前端预校验用） */
export interface PwdPolicyView {
  /** 最小长度 */
  min: number;
  /** 需包含大写字母 */
  upper: boolean;
  /** 需包含数字 */
  digit: boolean;
  /** 需包含特殊符号 */
  symbol: boolean;
  /** 人话版规则文案，例：不少于 8 位，且需包含大写字母、数字 */
  tip: string;
}

/* ============================================================
 * 行 → 视图
 * ============================================================ */

/** 解析 modules 列（库里存 JSON 字符串或逗号分隔） */
function parseModules(raw: any): ModuleKey[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as ModuleKey[];
  try {
    const arr = JSON.parse(String(raw));
    if (Array.isArray(arr)) return arr as ModuleKey[];
  } catch {
    // 退回逗号分隔
  }
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean) as ModuleKey[];
}

export function toAccountView(row: any, withPassword = false): SysAccount {
  return {
    accountId: row.id,
    account: row.account,
    userName: row.user_name,
    // ⚠️ 演示环境才返回密码。正式环境必须传 false。
    password: withPassword ? row.password : undefined,
    kind: row.kind as AccountKind,
    title: row.title || undefined,
    dept: row.dept || undefined,
    phone: row.phone || undefined,
    modules: parseModules(row.modules),
    active: !!row.active,
    lastLogin: row.last_login ? fmt(row.last_login) : undefined,
    createTime: row.create_time ? fmt(row.create_time) : undefined,
  };
}

function fmt(d: any): string {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())} ${p(dt.getHours())}:${p(dt.getMinutes())}:${p(dt.getSeconds())}`;
}

/* ============================================================
 * 可见模块
 * ============================================================ */

/**
 * ⭐ 取该账号可见的模块（含各自页面）
 *
 * ⚠️ 系统管理员 = 全部模块；模块负责人 = 只看 modules 里声明的。
 *    这里统一按 modules 字段过滤，管理员在数据层就存了全部模块，
 *    所以不需要额外特判 —— 规则单一，少一处出错的地方。
 */
export function visibleModulesOf(account: SysAccount): ModuleDef[] {
  return MODULES.filter((m) => account.modules.includes(m.key));
}

/**
 * ★ 2026-10-23 新增：登录 / 刷新身份时**真正下发**的可见模块
 *
 * ============================================================
 * 【修的是什么 bug】
 *   用户：在「页面管理」给咨询老师、咨询经理勾上财务管理的「财务概览 / 缴费管理」，
 *         「职位权限分配」里也勾上了对应动作，保存成功，
 *         但两个账号登录后左侧**根本没有「财务管理」这个一级模块**。
 *
 * 【根因：两层授权没打通】
 *   · 左侧一级模块（市场咨询 / 财务管理 / 权限管理）—— 只看
 *     `t_sys_account.modules`（账号级，登录时写死的）
 *   · 页面 / 动作 —— 看 `t_perm_role_page` + `t_perm_role_perm`（职位级）
 *   职位级放开了财务的两个页面，账号级 modules 里却没有 finance
 *   → 模块分组不渲染，页面配了也白配。
 *
 * 【口径（用户拍板：「改完登录就该看到，取消也一样」）】
 *   · 门户三模块（consult / finance / perm / 以及将来新增的非 legacy 模块）
 *     → **以职位级页面台账为准**：职位能看到该板块的页面 ⇒ 模块可见；
 *       全都取消 ⇒ 模块消失。
 *   · legacy 模块（job / edu / class / class-jh）→ 仍按 account.modules 判定。
 *     它们的 menus 是空的、由前端 config/menu.ts 渲染，可见性本来就由
 *     页面权限码（hasPage）决定，这里不该插手。
 *
 * 【降级】
 *   算不出来（没职位 / 查库失败 / 算出来是空集）→ 原样返回 account.modules 的结果，
 *   绝不让一个正常账号因为权限表抖动而登不进去。
 * ============================================================
 */
export async function resolveVisibleModules(account: SysAccount): Promise<ModuleDef[]> {
  const base = visibleModulesOf(account);
  try {
    const scope = await effectiveModuleScopeOfAccount(String(account.account || ''));
    if (!scope) return base;

    /* ⚠️ 系统管理员不参与这套合成 —— ★★ 用户拍板（2026-10-24）：
     *   「权限管理员的账号应该只看见权限管理板块才对」。
     *   也就是说 SYS_ADMIN 的可见边界由**账号级 modules** 决定（linx = ["perm"] → 只看权限管理），
     *   而不是跟着职位页面台账走（那会让管理员左侧凭空多出市场咨询 / 财务管理）。
     *
     *   注意两侧必须同源：登录下发板块按 account.modules 收窄的同时，
     *   `/api/perm/page/my-paths` 也要按账号级 modules 收窄（见 myPaths.route.ts 的 SYS_ADMIN 分支），
     *   否则会变成「职位给了财务页面、菜单却看不到」—— 正是用户最初报的那类不一致。
     *   改配置的人永远进得来：只要账号行里留着 perm，权限管理就一直在。 */
    if (scope.roleCodes.includes('SYS_ADMIN')) return base;

    /* ★★ 2026-10-24 新增：从「职位页面权限码」反推 legacy 模块授权
     *
     * 【修的是什么 —— 用户 2026-10-24 报的孙敏案例】
     *   孙敏（sunmin）是「项目经理」，职位权限分配里勾了 45 个权限点、
     *   页面管理里教学管理 8/13 打勾，但登录后侧栏只剩「工作台」。
     *
     * 【根因】
     *   · 项目经理的页面权限码全部是 `job:*`（就业/实训阶段的口径）；
     *   · 她的账号行 `t_sys_account.modules` 却是 `["class-jh"]`（历史种子数据）；
     *   · legacy 模块原先**只认账号级 modules** → token 里没有 `job`
     *     → 后端 moduleGate 把她的 11 个 job:* 页面码全部拦掉
     *     → 前端 hasPage / hasPerm 全 false → 合并域菜单集体消失。
     *
     * 【口径 —— 与用户拍板的「分配了权限页面，登录就该看到」一致】
     *   职位页面权限码覆盖到哪个 legacy 模块（job/edu/class/class-jh），
     *   该模块就对账号可见 —— 职位权限分配 / 页面管理 改了，下次登录自动跟上。
     *   查库失败 → 空集合（维持旧口径），绝不让登录挂掉。 */
    const grantedLegacyModules = new Set<string>();
    try {
      if (scope.roleCodes?.length) {
        const codes = await getUserPagePermissions(scope.roleCodes);
        for (const c of codes) {
          const mk = moduleOfPageCode(c);
          if (mk) grantedLegacyModules.add(mk);
        }
      }
    } catch {
      /* 查失败就退回 account.modules 口径，不影响登录 */
    }

    const picked = MODULES.filter((m) => {
      if (m.legacy) {
        if (account.modules.includes(m.key)) return true;
        /* ★★ 2026-10-24：职位页面权限码也能点亮 legacy 模块（见上方注释） */
        return grantedLegacyModules.has(String(m.key));
      }

      /* ★ 2026-10-23：原先这里有一条「账号级 modules 里有 perm 就保留」的防自锁兜底，
       *   它的副作用正是用户报的 bug —— 咨询经理（王寒逸）的账号行里残留着
       *   modules=["class","class-jh","consult","edu","finance","job","perm"]（历史种子数据），
       *   于是「权限管理」板块在他的左侧一直挂着，而他并没有任何权限页面。
       *
       *   自锁的正确解法不是「谁写了 perm 就永远保留」，而是：
       *     ① 系统管理员（SYS_ADMIN）在上面已按账号级 modules 原样返回，
       *        只要账号行里留着 perm，他就永远进得来（见上方 ★★）；
       *     ② 其余账号的 perm 与其他板块一视同仁 —— 职位勾了 perm 页面才有，
       *        取消就没有。这样「有没有权限」只有一个答案。 */
      return scope.modules.has(String(m.key));
    });

    // 防锁死：全被过滤掉时回退，宁可多给模块也不能让人登不进来
    return picked.length ? picked : base;
  } catch {
    return base;
  }
}

/**
 * ★ 2026-10-23 新增：账号的**展示头衔**（顶栏 / 工作台「欢迎回来，张三 <头衔>」）
 *
 * 【修的是什么】
 *   工作台把咨询经理王寒逸显示成「模块负责人」。
 *   根因：头衔取的是 `t_sys_account.title`，而这类账号的 title 是空的，
 *   前端 in 空值时退回 `kind === module_owner ? '模块负责人' : ...` ——
 *   于是**任何一个没填头衔的账号**都被叫成「模块负责人」。
 *   「模块负责人」是账号类型（kind），不是岗位名称，本来就不该占这个位置。
 *
 * 【口径】
 *   ① 账号行里填了 title → 用它（管理员可能填「市场咨询经理」这种更细的叫法）；
 *   ② 没填 → 用该账号在权限库里的**职位名**（咨询经理 / 班主任 …）；
 *   ③ 都没有 → 返回 undefined，前端再兜底（系统管理员 / 员工）。
 */
export async function resolveAccountTitle(
  account: SysAccount,
): Promise<string | undefined> {
  const own = String(account.title || '').trim();
  if (own) return own;
  try {
    const scope = await effectiveModuleScopeOfAccount(String(account.account || ''));
    const names = (scope?.roleNames || []).filter(Boolean);
    if (names.length) return names.join('、');
  } catch {
    /* 查不到就交给前端兜底 */
  }
  return account.kind === AccountKind.SYS_ADMIN ? '系统管理员' : undefined;
}

/**
 * 建议落地路径
 * ★ 2026-10-16 用户指令：「将工作台放置首页，每个角色进来第一个页面就是工作台」
 *   → 所有角色（含原先返回空串的 legacy 模块账号）统一落到 '/' 工作台首页。
 *     前端 Login.vue 拿到后 router.replace，无任何角色特判。
 */
export function landingPathOf(_account: SysAccount): string {
  return '/';
}

/* ============================================================
 * 登录
 * ============================================================ */

export async function login(account: string, password: string): Promise<PortalLoginResult> {
  const row = await db(ACCOUNT_TABLE).where({ account, is_deleted: false }).first();

  if (!row) throw new BizError(BizCode.LOGIN_FAILED, '账号或密码错误');
  if (row.password !== password) throw new BizError(BizCode.LOGIN_FAILED, '账号或密码错误');
  if (!row.active) {
    throw new BizError(
      BizCode.ACCOUNT_DISABLED,
      '该账号已停用，无法登录。请联系系统管理员恢复。',
    );
  }

  await db(ACCOUNT_TABLE).where({ id: row.id }).update({ last_login: new Date() });

  const view = toAccountView(row, false);
  /* ★ 2026-10-23：头衔为空时用职位名兜底 —— 否则工作台会把「咨询经理」
   *   显示成账号类型「模块负责人」（见 resolveAccountTitle 注释）。 */
  if (!view.title) view.title = await resolveAccountTitle(view);
  /* ★ 2026-10-23：改为按「职位 → 页面」台账合成，见 resolveVisibleModules 注释 */
  const visibleModules = await resolveVisibleModules(view);

  if (visibleModules.length === 0) {
    throw new BizError(BizCode.NO_MENU_PERMISSION, '该账号未分配任何模块权限，请联系系统管理员');
  }

  // ⭐ 签发含 modules 的 JWT —— 各业务模块验签后可解出「这人能进哪些模块」
  const payload: JwtPayload = {
    userId: row.id,
    // 三方清单口径：角色用统一新编码
    roles: [view.kind === AccountKind.SYS_ADMIN ? 'SYS_ADMIN' : 'SYS_STAFF'],
    permissions: view.kind === AccountKind.SYS_ADMIN ? ['*'] : [`module:${view.modules.join(',')}`],
    dataScope: view.kind === AccountKind.SYS_ADMIN ? 4 : 3,
    // ⭐ 门户扩展
    /* ★ 2026-10-23：token 里的 modules 必须与「这次真正下发的可见模块」一致 ——
     *   否则菜单里有了「财务管理」，但财务接口验 token 时发现 modules 没 finance，
     *   进去就是 403（门开了、锁没换）。 */
    modules: visibleModules.map((m) => String(m.key)),
    kind: view.kind,
    userName: view.userName,
    accountId: row.id,
    account: row.account,
    degraded: false,
  };

  return {
    token: signToken(payload),
    account: view,
    visibleModules,
    landingPath: landingPathOf(view),
  };
}

/** 按 token（accountId）取账号 —— 中间件用 */
export async function findById(id: string): Promise<any | null> {
  if (!id) return null;
  return db(ACCOUNT_TABLE).where({ id, is_deleted: false }).first();
}

/* ============================================================
 * ⭐ 2026-10-15 新增：登录人【自助修改密码】
 *
 * 需求（用户原话）：
 *   「在顶栏加一个重置密码的按钮，每个角色登录进去都能看到并修改；
 *     弹窗先输旧密码，旧密码正确后才能输新密码，再确认一遍新密码，
 *     两次一致才能改成功。」
 *
 * 设计要点：
 *   ① 只要「登录了」就能改自己的密码 —— 不校验模块/权限点，
 *      所以校长、班主任、教务、咨询、财务、权限管理员全都能用。
 *   ② 旧密码必须由后端复核（前端那一步只是为了交互流畅），
 *      改密接口里再验一次，防止前端跳过验证直接提交。
 *   ③ 演示环境密码是明文存储（与登录同口径），这里保持一致；
 *      正式环境换成 bcrypt 时，只需改本文件这三处比较/写入。
 * ============================================================ */

/**
 * 取当前生效的密码策略（供改密弹窗提示 + 前端预校验）
 *
 * ⚠️ 策略的单一事实来源在权限管理的 t_perm_rule（perm/services/pwdPolicy.ts），
 *    门户侧只做转发，**不再定义第二份规则** —— 本次 bug 的根因就是两份规则漂移。
 */
export async function getPwdPolicy(): Promise<PwdPolicyView> {
  const { loadPwdRule, describePwdRule } = await import('../../perm/services/pwdPolicy');
  const [rule, tip] = await Promise.all([loadPwdRule(), describePwdRule()]);
  return { min: rule.min, upper: rule.upper, digit: rule.digit, symbol: rule.symbol, tip };
}

/**
 * 新密码规则
 *
 * ★ 2026-10-19 修复：原来这里写死了「6~20 位、不含空格、不能与原密码相同」，
 *   与账号管理那套密码策略（t_perm_rule：≥8 位 + 含大写字母 + 含数字）**不是同一份**，
 *   于是出现「规则要求含大写字母，但用户全小写一样能改成功」。
 *   现在强度判定统一走 assertPwdStrength（读同一份策略），
 *   本函数只补策略管不到的三条：长度上限、不含空格、不能与原密码相同。
 *
 * ⚠️ 策略读取用【动态 import】：门户与权限是两个库，
 *    不能让「权限库暂时连不上」把用户改自己密码的入口整个拖死
 *    （pwdPolicy.loadPwdRule 读不到时回退默认策略，不会抛错）。
 */
export async function assertNewPassword(newPassword: string, oldPassword?: string): Promise<void> {
  const p = String(newPassword ?? '');

  // ① 强度：与「账号管理 → 新增账号 / 重置密码」完全同一口径
  const { assertPwdStrength } = await import('../../perm/services/pwdPolicy');
  await assertPwdStrength(p);

  // ② 策略之外的补充规则
  if (p.length > 20) {
    throw new BizError(BizCode.PARAM_ERROR, '新密码不超过 20 位');
  }
  if (/\s/.test(p)) {
    throw new BizError(BizCode.PARAM_ERROR, '新密码不能包含空格');
  }
  if (oldPassword !== undefined && p === oldPassword) {
    throw new BizError(BizCode.PARAM_ERROR, '新密码不能与原密码相同');
  }
}

/**
 * 校验「本人原密码」
 *
 * ⚠️ 密码错用 PARAM_ERROR（HTTP 200 + 业务码）而不是 401：
 *    401 会让前端拦截器判定「登录过期」并把人踢回登录页 —— 只是输错一次密码，不至于。
 */
export async function verifyOwnPassword(accountId: string, password: string): Promise<any> {
  const row = await db(ACCOUNT_TABLE).where({ id: accountId, is_deleted: false }).first();
  if (!row) throw new BizError(BizCode.UNAUTHORIZED, '账号不存在或已删除，请重新登录', 401);
  if (String(row.password ?? '') !== String(password ?? '')) {
    throw new BizError(BizCode.PARAM_ERROR, '原密码不正确，请重新输入');
  }
  return row;
}

/**
 * 修改本人密码
 *
 * @returns 是否顺带同步了「权限管理 → 账号管理」里的同名账号
 */
export async function changeOwnPassword(
  accountId: string,
  oldPassword: string,
  newPassword: string,
): Promise<boolean> {
  const row = await verifyOwnPassword(accountId, oldPassword);
  // ★ 2026-10-19：assertNewPassword 现在要读策略，改成 await
  await assertNewPassword(newPassword, oldPassword);

  await db(ACCOUNT_TABLE).where({ id: accountId }).update({
    password: newPassword,
    update_time: new Date(),
    update_by: accountId,
  });

  // 顺手把「权限管理 → 账号管理」（sms_perm.t_perm_user）里同登录名的密码对齐，
  // 否则管理员在那个页面上看到的还是旧密码。失败不影响改密结果。
  return syncPermUserPassword(row.account, newPassword);
}

/**
 * 同步同名业务账号的密码（best-effort）
 *
 * ⚠️ 门户账号库（sms_portal）与权限库（sms_perm）是两套库，
 *    这里用动态 import 拿权限库的连接，避免把两个模块的依赖在文件顶部硬绑死；
 *    查不到（如该账号只有门户账号、没有业务档案）或库暂时连不上，都直接返回 false。
 */
async function syncPermUserPassword(account: string, newPassword: string): Promise<boolean> {
  if (!account) return false;
  try {
    const { db: permDb } = await import('../../perm/utils/db');
    const affected = await permDb('t_perm_user')
      .where({ account, is_deleted: false })
      .update({
        password: newPassword,
        pwd_algo: 'plain',
        need_change_pwd: false,
        pwd_error_count: 0,
        update_time: new Date(),
      });
    return Number(affected) > 0;
  } catch {
    return false;
  }
}
