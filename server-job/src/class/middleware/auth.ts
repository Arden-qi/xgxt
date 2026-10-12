import { NextFunction, Request, Response } from 'express';
import { ClassStatus, DataScope, RoleCode } from 'shared-types/class';
import { Errors } from '../http/response';
import { extractBearer, verifyToken } from '../lib/jwt';
import { AuthUser, resolveDataScope } from '../lib/authUser';
import { db } from '../db';
// ★ 2026-10-05：内部服务令牌统一从 config 读（默认值非空 → 校验永远生效）
import { config } from '../config';
// ★ 2026-10-06：复用主包的「按登录名查权限模块拿业务角色」（与 class-jh 同一出口）
import { resolveBusinessRoles } from '../../middleware/auth';
// ★ 第 4 期第 8 批：补切读层（本文件原来写死 `db('t_class_info')`）
//   【为什么这一处特别关键 —— 它决定「老师能看到哪些班」】
//   登录中间件在这里查一次班主任/教员/助教负责的班级，填进 `user.classIds`，
//   全模块的数据范围过滤（applyDataScope / assertClassAccess）都依赖它。
//   切读打开后若仍读老表 → 班级 id 对不上统一表 → `user.classIds = []`
//   → **所有老师的数据范围都变成「一个班都看不到」**，而且不报错、只表现为列表全空。
import { tbl } from '../../teaching/shared/uniTable';

const SRC = 'sms_class';
const STAGE = 'class' as const;

/**
 * ★ 2026-10-04 并入主包：补 `classIds`（我负责哪些班）
 *
 *   主系统的 token 里不带这个（主系统是按 `t_job_class.head_teacher_id` 现查的），
 *   而本模块的数据范围过滤依赖 `req.user.classIds`（见 middleware/dataScope.ts）。
 *   所以在这里查一次库补上 —— 查的是**本模块自己的表** `t_class_info`。
 *
 *   （班级自己的 JWT 里本来就带 classIds，那条路不用查）
 */
async function fillClassIds(user: AuthUser): Promise<void> {
  if (user.classIds && user.classIds.length) return;
  if (!user.userId) return;
  try {
    const rows = (await tbl(db, SRC, 't_class_info', STAGE)
      .where('is_deleted', 0)
      /**
       * ★ 2026-10-06（第四轮）用户改口径：**升实训 = 交棒，原班主任/教员退出**。
       *
       * 【职责交棒模型】（与 utils/stageScope.ts 的注释一致）
       *   大学 1~6 阶段 → 班主任 + 教员 + 助教（本表三岗）
       *   实训阶段      → 项目经理（t_job_class.project_manager，兼「教员」角色）
       *   就业阶段      → 就业指导老师（t_job_class.employment_teacher，兼「班主任」角色）
       *
       *   升实训后，本模块（大学部·班级管理）**不再对原班主任三人组展示这个班** ——
       *   班级列表、班级信息管理花名册、出勤/成绩/催费 全部看不到；
       *   写操作（换班/休学/退学/修改）也随之被 assertClassAccess 拦下（403）。
       *   数据**不删**，学管/校长/管理员（DataScope=ALL）仍可查看。
       *
       * ⚠️ 交棒只对「教师三岗」生效：学管/校长/管理员的数据范围是 ALL，不受本过滤影响。
       */
      .whereNot('class_status', ClassStatus.TRAINING)
      .andWhere((q: any) => {
        q.where('head_teacher_id', user.userId)
          .orWhere('teacher_id', user.userId)
          .orWhere('assistant_id', user.userId);
      })
      .select('id')) as Array<{ id: string }>;
    user.classIds = rows.map((r) => r.id);
  } catch {
    // 查不到就按「没有负责的班」处理（数据范围最保守）
    user.classIds = [];
  }
}

/**
 * ★★ 2026-10-06 关键修复：解析【业务角色】
 *
 * 【原来错在哪】
 *   门户签发的 token 里 `roles` 只有门户级编码：SYS_ADMIN（管理员）/ SYS_STAFF（其余）。
 *   本模块（班级管理·大学部）以前直接照单全收，于是：
 *     · /api/class/me 对**所有人**返回 roles:['SYS_STAFF']、dataScope:3、deptCode:0
 *     · 前端 user store 里 isSuper / isStudyManager / canApprove 全为 false
 *     · 后端 permGuard 的 FULL_ACCESS_ROLES / TEACHING_STAFF 全部比不中
 *       → 班主任点「接收学员」报 40302，校长/学管打开催费/缴费列表是空的
 *   （表象是「权限配错了」，实际是角色压根没解析。）
 *
 * 【怎么修】
 *   与主包 middleware/auth.ts、以及 class-jh 完全一致的姿势：
 *   拿 token 里的 `account` 去权限管理模块（sms_perm.t_perm_user）现查真实角色码，
 *   再用 resolveDataScope 从角色推数据范围 —— 「学管/校长 = 全部，班主任 = 本班级」。
 *   ⚠️ 解析不到（账号没配权限）时 roles = []，dataScope 落到最保守的 SELF，
 *      绝不降级成 SYS_ADMIN —— 否则「咨询/财务负责人」会看到班级全部数据。
 */
async function resolvePortalRoles(user: AuthUser, payload: Record<string, unknown> | undefined): Promise<void> {
  if (!payload) return; // 开发调试 token（test-XXX）：roles 已在 parseDevToken 里定好，不动
  const kind = String(payload.kind || '');
  const account = String(payload.account || '');
  if (!kind && !account) return; // 不是门户 token（旧版 token），保持原样

  if (kind === 'sys_admin') {
    user.roles = [RoleCode.ADMIN];
    user.dataScope = DataScope.ALL;
    return;
  }
  const roles = account ? await resolveBusinessRoles(account) : [];
  user.roles = roles;
  // 角色 → 数据范围：SYS_ADMIN / RM_PRINCIPAL / TEACH_DEAN → ALL；班主任/教员/助教 → CLASS
  user.dataScope = resolveDataScope(roles);
  user.deptCode = roles.length ? user.deptCode || 2 : 2;
}

/**
 * ★★ 2026-10-06 补：模块准入闸（大学部班级管理）
 *
 * 【为什么必须补】
 *   /api/class/* 以前**只做认证、不做模块准入** —— 只要登录了就能读：
 *     · 初高班主任（门户模块只有 class-jh）能读大学部的咨询推送单/花名册
 *     · 财务、咨询、就业、权限管理员同理
 *   违反门户「一个账号只进自己被授权的模块」的约定。
 *   初高模块（class-jh）早就有这道闸，这里补齐、口径保持一致：
 *     · 系统管理员（kind=sys_admin）→ 放行（他本来就是全模块只读）
 *     · 老 token / 开发调试 token（没有 modules 字段）→ 放行，保持向后兼容
 *     · 其余 → modules 里必须含 'class'
 *
 * ⚠️ 服务间同步口（/sync、/push、/open-options、/internal-status）
 *    在 authAllowSync 里就被拦下换成 SYSTEM_USER 了，走不到这里。
 */
function assertModuleAccess(payload: Record<string, unknown> | undefined): boolean {
  if (!payload) return true; // 开发调试 token
  const kind = String(payload.kind || '');
  if (kind === 'sys_admin') return true;
  const mods = Array.isArray(payload.modules) ? (payload.modules as string[]) : null;
  if (!mods || !mods.length) return true; // 老 token：没有模块声明，不误伤
  return mods.includes('class');
}

/** 统一认证中间件 ... */
export function auth(req: Request, _res: Response, next: NextFunction): void {
  const token = extractBearer(req.headers.authorization);
  if (!token) {
    return next(Errors.unauthorized());
  }
  const r = verifyToken(token);
  if (!r.ok) {
    return next(r.reason === 'expired' ? Errors.tokenExpired() : Errors.unauthorized(r.message));
  }
  // ⓪ 模块准入（先于一切业务逻辑，避免越界读取）
  if (!assertModuleAccess(r.payload)) {
    return next(Errors.noOperationPermission('您没有访问「班级管理」模块的权限'));
  }
  // ① 解析业务角色（门户 token 必需）→ ② 补 classIds → ③ 放行
  //    任何一步失败都不拦请求（降级为「空班级 + 最保守范围」，由业务层再判）
  resolvePortalRoles(r.user, r.payload)
    .then(() => fillClassIds(r.user))
    .catch(() => undefined)
    .finally(() => {
      req.user = r.user;
      next();
    });
}

/**
 * 外部系统推数据时使用的身份
 * 同步接口是「上游模块 → 本模块」的服务间调用，没有用户登录上下文，
 * 因此用系统身份占位，并把 `dataScope` 设为 ALL（同步接口内部不做数据范围过滤）。
 */
export const SYSTEM_USER: AuthUser = {
  userId: 'SYSTEM',
  userName: '外部系统同步',
  roles: [],
  deptCode: 0,
  dataScope: DataScope.ALL,
  classIds: [],
  permissions: [],
  token: '',
};

/**
 * 允许「同步接口」用服务凭证访问的认证中间件
 *
 * - 上游模块推数据的接口（`/sync` 或 `/push` 结尾）→ 视为模块间调用：
 *   校验 `x-internal-token`，不要求用户 token，身份置为 SYSTEM_USER
 * - 其余路径 → 与普通 auth 完全一致
 *
 * ★ 2026-10-05 合并：令牌来源统一为 `config.internalToken`（默认值非空）。
 *   原来读的是裸的 `process.env.INTERNAL_TOKEN`，**没配就整个跳过校验** ——
 *   那样任何请求都能往只读副本里写数据。现在校验【永远生效】。
 *
 * ★ 2026-10-05 二次修（联调发现）：**只认 `/sync` 漏了 `/push`**。
 *   咨询推送的接收口是 `POST /api/class/consult/push`（不是 /sync），
 *   原来走到这里会落到普通 `auth()` → 内部调用没带登录 token →
 *   报「您尚未登录，请先登录」，**咨询「入班」永远推不进来**。
 *   现在把 `/push` 一并当作服务间调用口。
 */
export function authAllowSync(req: Request, res: Response, next: NextFunction): void {
  /** 上游推数据用的收口：/sync（财务/教务）与 /push（咨询） */
  // ★ 2026-10-05 增加 open-options：给咨询「分班」/ 初高「升学」提供开放班级清单的内部读接口
  // ★ 2026-10-06 增加 internal-status：给咨询侧查「该生分班到哪一步了」的只读接口
  //    （咨询「分班」按钮要靠它判断「已推送/已接收 → 不可重复分派，已驳回 → 可重新分派」）
  const isIngress = /\/(sync|push|open-options|internal-status)(\/)?$/.test(req.path);
  if (isIngress) {
    const expected = config.internalToken;
    const got = String(req.header('x-internal-token') || '');
    if (got !== expected) {
      return next(Errors.unauthorized('内部服务凭证无效，无法接收同步数据'));
    }
    req.user = SYSTEM_USER;
    return next();
  }
  return auth(req, res, next);
}

/** 可选认证：带了 token 就解析，没带也放行（用于公开接口） */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = extractBearer(req.headers.authorization);
  if (token) {
    const r = verifyToken(token);
    if (r.ok) req.user = r.user;
  }
  next();
}

/** 要求至少具备其中一个角色 */
export function requireRole(roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const u = req.user;
    if (!u) return next(Errors.unauthorized());
    if (!u.roles.some((r: string) => roles.includes(r))) {
      return next(Errors.noOperationPermission('您无权执行此操作，请联系学管或校长'));
    }
    next();
  };
}
