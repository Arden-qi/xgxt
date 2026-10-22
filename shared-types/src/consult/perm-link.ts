/**
 * ⭐ 权限模块联调契约（财务/咨询模块共用）
 *
 * ⚠️⚠️ 2026-10-03 新增：打通「权限分配 → 财务/咨询菜单」
 *
 * 背景（用户指令）：
 *   「权限管理内的权限分配和财务市场咨询联调一下，
 *     让权限管理内的权限可以正常分配。」
 *
 * 问题：权限分配页把「角色 → 功能点 → 动作」写进 sms_perm 库，
 *       但财务/咨询模块的菜单一直是自己按【账号表里的岗位】硬算的
 *       （财务 FINANCE_ROLE_MENUS / 咨询 ROLE_MENUS），
 *       两边数据不通 → 权限分配改了没有任何效果。
 *
 * 方案：权限模块对外暴露只读接口
 *     GET http://127.0.0.1:8006/api/perm/remote/account-profile?account=<登录名>
 *   返回该账号的角色 / 权限点 / 数据范围 / 各模块下的功能点清单。
 *   财务与咨询在登录（或刷新）时调用它，把「权限库的功能点名」
 *   映射成「本模块的 menuKeys」，从而让权限分配的改动真正生效。
 *
 * ⚠️ 关键：两套编码要映射
 *   权限库的【模块 key】      market / fin / perm / teach / train / job / acad / approve
 *   门户+各模块的【模块 key】 consult / finance / perm
 *   权限库的【功能点名】是中文（如「账单明细」）
 *   本模块的【menuKey】是英文（如 bill）
 *   下面的 *_PERM_ITEM_TO_MENU 就是这张对照表。
 *
 * ⚠️ 降级原则（重要）：
 *   权限接口拿不到（8006 没起 / 该账号不在权限库）时，
 *   【绝不能让人进不来】—— 回退到原有的「按岗位角色算菜单」逻辑，
 *   并在返回里标记 permDegraded=true，让前端可以提示。
 */

/* ============================================================
 * 1. 跨模块接口返回结构（与 perm 模块 AccountPermProfile 对齐）
 * ============================================================ */

export interface RemotePermProfile {
  /** 是否在权限库中找到该账号 */
  found: boolean;
  /** 权限库里的用户 id（如 U010） */
  permUserId: string;
  account: string;
  userName: string;
  deptId: string;
  deptName: string;
  userStatus: string;
  /** 角色编码数组（如 ['FIN_STAFF']） */
  roles: string[];
  /** 角色中文名数组（如 ['财务']） */
  roleNames: string[];
  /** 有效权限点，形如 ['fin:账单明细:view'] */
  permissions: string[];
  /** 数据范围：1 本人 / 2 本班 / 3 本部门 / 4 全部 */
  dataScope: number;
  /** ⭐ 权限库模块 key → 该模块下有权限的功能点名 */
  moduleItems: Record<string, string[]>;
}

/** 取权限档案的结果（含降级标记） */
export interface RemotePermResult {
  profile: RemotePermProfile | null;
  /** true = 权限模块没连上或账号不在库里，用的是本地兜底菜单 */
  degraded: boolean;
  /** 降级原因（便于提示与排查） */
  degradeReason?: string;
}

/* ============================================================
 * 2. 财务模块：权限库功能点 → 财务 menuKey
 *
 * ⚠️ 一个 menuKey 可能对应多个功能点（任一命中即算可见）：
 *    fee      ← 试学学费名单 / 正式学费名单 / 保险费名单
 *    refund   ← 退费名单
 *    bill     ← 账单明细
 *    finance  ← 以上任一命中（概览页作为模块首页始终可见，见 FINANCE_ALWAYS_MENUS）
 *
 * ⚠️ 没有对应功能点的 menuKey（freeze / standard）：
 *    freeze（冻结名单）—— 权限树 010 版已并入 acad「缴费总名单」的「冻结」动作，
 *                       财务侧保留页面，按「概览有权限就给」处理。
 *    standard（费用标准）—— 权限树里没有对应功能点，
 *                       保留给财务负责人，见 FINANCE_ALWAYS_MENUS。
 * ============================================================ */

/**
 * ★ 2026-10-22：权限树改成「板块 → 页面」之后，这张表变成**页面名 → menuKey**
 *
 * 以前权限树的 fin 模块功能点是「试学学费名单 / 正式学费名单 / 保险费名单…」，
 * 与财务模块的菜单（缴费管理 / 冻结名单 / 费用标准…）不是一一对应，
 * 只能靠这张表归并（三个名单 → 一个缴费管理）。
 * 现在权限树的功能点就是页面本身，板块 key 与门户一致（finance），
 * 所以映射是 1:1 的，改页面名时两边（页面管理 / 本表）必须一起改。
 */

/** 权限库 finance 模块的页面名 → 财务 menuKey */
export const FIN_PERM_ITEM_TO_MENU: Record<string, string> = {
  财务概览: 'finance',
  缴费管理: 'fee',
  冻结名单: 'freeze',
  退费管理: 'refund',
  账单明细: 'bill',
  费用标准: 'standard',
};

/**
 * 始终可见的财务页面（不受权限分配影响）
 *
 * ⚠️ finance（财务概览）是本模块首页：
 *    一个账号能进财务模块就必然要有个落地页，
 *    否则 menuKeys 为空会导致「进来一片空白 + 路由守卫死循环」。
 */
export const FINANCE_ALWAYS_MENUS: string[] = ['finance'];

/* ============================================================
 * 3. 咨询模块：权限库页面名 → 咨询 menuKey
 * ============================================================ */

/** 权限库 consult 模块的页面名 → 咨询 menuKey */
export const MARKET_PERM_ITEM_TO_MENU: Record<string, string> = {
  学生管理: 'student',
  收款与缴费: 'fee',
  审批中心: 'approve',
  退费管理: 'refund',
  流失记录: 'loss',
};

/**
 * 旧口径的审批中心映射表 —— 权限树合并进 consult 板块后已无对应模块
 * （审批中心现在就是 consult 板块下的一个页面），保留空对象只为兼容老引用。
 */
export const APPROVE_PERM_ITEM_TO_MENU: Record<string, string> = {};

/** 始终可见的咨询页面（模块首页） */
export const CONSULT_ALWAYS_MENUS: string[] = ['student'];

/* ============================================================
 * 4. 通用换算工具
 * ============================================================ */

/**
 * 把「权限库功能点清单」换算成「本模块 menuKeys」
 *
 * @param moduleItems 权限库的 moduleItems（模块 key → 功能点名数组）
 * @param permModuleKey 要读的权限库模块 key（财务 'finance' / 咨询 'consult'）
 * @param mapping 页面名 → menuKey 对照表
 * @param always 始终可见的 menuKey（模块首页）
 */
export function menusFromPermItems(
  moduleItems: Record<string, string[]> | undefined,
  permModuleKey: string,
  mapping: Record<string, string>,
  always: string[] = [],
): string[] {
  const items = moduleItems?.[permModuleKey] || [];
  const out = new Set<string>(always);
  for (const item of items) {
    const key = mapping[item];
    if (key) out.add(key);
  }
  return Array.from(out);
}

/**
 * 财务：按权限档案算 menuKeys
 * @param profile 权限档案（null 时返回 always 兜底）
 */
export function financeMenusFromPerm(profile: RemotePermProfile | null): string[] {
  if (!profile || !profile.found) return [...FINANCE_ALWAYS_MENUS];
  return menusFromPermItems(
    profile.moduleItems,
    'finance',
    FIN_PERM_ITEM_TO_MENU,
    FINANCE_ALWAYS_MENUS,
  );
}

/** 咨询：按权限档案算 menuKeys（审批中心已并入 consult 板块） */
export function consultMenusFromPerm(profile: RemotePermProfile | null): string[] {
  if (!profile || !profile.found) return [...CONSULT_ALWAYS_MENUS];
  return menusFromPermItems(
    profile.moduleItems,
    'consult',
    MARKET_PERM_ITEM_TO_MENU,
    CONSULT_ALWAYS_MENUS,
  );
}

/* ============================================================
 * 5. 权限模块地址
 * ============================================================ */

/** 权限模块后端地址（各模块 .env 里的 PERM_URL 优先，兜底本机 8006） */
export const DEFAULT_PERM_URL = 'http://localhost:8006';

/** 权限模块「按登录名取权限档案」的路径 */
export const PERM_ACCOUNT_PROFILE_PATH = '/api/perm/remote/account-profile';
