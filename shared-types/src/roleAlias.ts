/**
 * 角色码别名映射（★ 2026-10-08 新增）
 *
 * ============================================================
 * 【为什么要有这个文件】
 * ============================================================
 * 全系统存在**两套角色码**，历史原因（各模块早期是独立系统）：
 *
 *   A. 主包 RoleCode（shared-types/src/enums.ts）
 *      —— 代码里所有 `RoleCode.XXX` 用的就是它
 *   B. 权限库 sms_perm.t_perm_role.role_code
 *      —— 门户登录后 `resolveBusinessRoles()` 从权限库拿回来的**运行时真实值**
 *
 * 这两套**并非一一对应**。已确认的错位：
 *
 * | 主包 RoleCode        | 权限库实际存的       | 后果 |
 * |----------------------|----------------------|------|
 * | `PROJECT_MANAGER`    | **`RM_PROJECT`**     | 所有 `roles.includes(RoleCode.PROJECT_MANAGER)` 恒 false |
 * | （代码已删除财务角色）| **`FIN_STAFF`**      | 财务相关判断恒 false |
 * | （代码无此码）        | **`MKT_MANAGER`**    | 咨询经理判断恒 false |
 *
 * ⚠️ 这不是"配置错了"，而是两个系统各用各的编码，靠别名桥接。
 *
 * ============================================================
 * 【正确用法】
 * ============================================================
 * ❌ 错误（只要运行时 roles 来自权限库，就恒 false）：
 *      if (roles.includes(RoleCode.PROJECT_MANAGER)) { ... }
 *
 * ✅ 正确：
 *      if (hasRole(roles, RoleCode.PROJECT_MANAGER)) { ... }
 *
 * 或者一次性把整个数组"归一化"后比较：
 *      const rs = normalizeRoles(roles);
 *      if (rs.includes(RoleCode.PROJECT_MANAGER)) { ... }
 *
 * ============================================================
 * 【为什么不用"改数据库"来对齐】
 * ============================================================
 * 权限库的 role_code 是**已经发给用户的存量数据**（账号-角色绑定、
 * 页面授权台账 t_perm_role_page 全部按它挂），改名会牵连一大片。
 * 别名映射是成本最低、风险最小的做法 —— 与 staff.route.ts
 * 里已存在的 `PERM_ROLE_ALIAS` 同一思路，这里只是提升为全局共享。
 */

/**
 * 主包 RoleCode → 权限库可能出现的 role_code 列表
 *
 * ⚠️ key 用字符串字面量而不是 `RoleCode.XXX`，
 *    因为本文件要能被 enums.ts 之外的地方引用而不产生循环依赖。
 */
export const ROLE_CODE_ALIAS: Record<string, readonly string[]> = {
  // ★ 项目经理：权限库里是 RM_PROJECT（最主要的错位）
  PROJECT_MANAGER: ['PROJECT_MANAGER', 'RM_PROJECT'],
  // 财务：主包已删该角色，但权限库有账号在用（U010/U016/U017）
  //   ⚠️ 2026-10-08 清理：原列表里的 `'FINANCE'`（纯大写裸词）全仓无人使用，已删。
  //   `'FINANCE_ADMIN'` 也一并删：它是财务**模块内**角色枚举
  //   （FinanceRole.FINANCE_ADMIN，实际值是小写 `'finance_admin'`，见 finance/finance-auth.ts），
  //   与权限库 role_code 是两套体系，且大小写对不上、永远不会命中，留着只会误导。
  //   权限库里的权威码就叫 `FIN_STAFF`（已在上方 key 中）。
  FIN_STAFF: ['FIN_STAFF', 'ROLE_FINANCE'],
  // 咨询经理：权限库里是 MKT_MANAGER
  //   ⚠️ `'MKT_CONSULT_MANAGER'` 目前全仓无来源，属预置的兼容别名；
  //   如果要收敛，可先删掉（不影响现有行为），此处暂留。
  MKT_MANAGER: ['MKT_MANAGER', 'MKT_CONSULT_MANAGER'],
  // ★ 2026-10-08：权限管理员（新建角色，账号 linx）
  //   ⚠️ 同上，`'ROLE_PERM_ADMIN'` / `'PERM_MANAGER'` 暂无来源（权威码就是 PERM_ADMIN）。
  PERM_ADMIN: ['PERM_ADMIN', 'ROLE_PERM_ADMIN', 'PERM_MANAGER'],
  // 学管主任：历史上由「教质经理 / 学术经理」合并而来，老数据里可能还在
  TEACH_DEAN: ['TEACH_DEAN', 'TEACH_QTY', 'ACAD_MANAGER'],
  // 校长
  // ⚠️ 2026-10-08 清理：原来的别名列表里还有个裸词 `'PRINCIPAL'`，已删。
  //   原因：`'PRINCIPAL'` 是枚举**名**而不是枚举**值**，全仓没有任何地方真的传它；
  //   留着反而有害 —— `hasRole(['PRINCIPAL'], 'RM_PRINCIPAL')` 会误命中（越权风险）。
  //   真正有来源的旧码是 `'ROLE_PRINCIPAL'`（见 class-jh/finance/portal 三个子包的
  //   `RoleCode.PRINCIPAL = 'ROLE_PRINCIPAL'`），这个必须保留。
  RM_PRINCIPAL: ['RM_PRINCIPAL', 'ROLE_PRINCIPAL'],
  // 系统管理员
  // ⚠️ 同上，删掉裸词 `'ADMIN'`；`'ROLE_ADMIN'` 来自
  //   class-jh/finance/portal 子包的 `RoleCode.ADMIN = 'ROLE_ADMIN'`，保留。
  SYS_ADMIN: ['SYS_ADMIN', 'ROLE_ADMIN'],
  // ★ 2026-10-08：下面几个权限库码与主包**逐字一致**，
  //   登记在这里是为了让 `normalizeRoles()` 的反向索引也能识别它们
  //   （反向索引只登记「非自身的别名」，自身已在主包枚举里）。
  MKT_CONSULT: ['MKT_CONSULT'],
  TEACH_HEAD: ['TEACH_HEAD'],
  TEACH_TUTOR: ['TEACH_TUTOR'],
  TEACH_ASSIST: ['TEACH_ASSIST'],
  ACAD_STAFF: ['ACAD_STAFF'],
  JOB_STAFF: ['JOB_STAFF'],
};

/**
 * 反向索引：**任一别名 → 它的主包码**
 *
 * ★ 2026-10-08 新增。
 *
 * 【为什么需要】
 *   ROLE_CODE_ALIAS 是**正向表**：key 是主包码，value 是它在权限库里
 *   所有可能的写法。但调用方拿到的往往是**权限库码**（如 `RM_PROJECT`），
 *   这时用 key 去查查不到 → 展开失败。
 *   反向索引让任意一个写法都能定位到同一个主包码。
 *
 * @example
 *   ROLE_REVERSE['RM_PROJECT']         // 'PROJECT_MANAGER'
 *   ROLE_REVERSE['ROLE_FINANCE']       // 'FIN_STAFF'
 */
const ROLE_REVERSE: Record<string, string> = (() => {
  const rev: Record<string, string> = {};
  for (const [mainCode, aliases] of Object.entries(ROLE_CODE_ALIAS)) {
    for (const a of aliases) rev[a] = mainCode;
    // 自身也要能定位（有些别名列表里没写自己）
    rev[mainCode] = mainCode;
  }
  return rev;
})();

/* ============================================================
 * ★★ 2026-10-08 新增：动态等价角色（自建角色 → 内置角色）
 * ============================================================
 *
 * 【为什么静态表不够】
 *   `ROLE_CODE_ALIAS` 是**写死在代码里**的，只能登记「已知的」两套码错位
 *   （如 `RM_PROJECT` ↔ `PROJECT_MANAGER`）。
 *   但用户在**权限管理里自建的角色**（如 `XMJL_000`「项目经理2」）
 *   是运行期才出现的，静态表永远不可能预知 —— 它连这个码长什么样都不知道。
 *
 *   后果（本轮实测）：
 *     班主任/项目经理 用自建角色时，`canInitiate('refund', ['XMJL_000'])`
 *     恒 false → 退费/休学/退学单据**发都发不出去**（40302），
 *     页面却看得见（因为页面可见性走的是另一套「功能点推导」，已修）。
 *     本质是同一个病根：**自建角色在业务代码眼里没有"身份"**。
 *
 * 【解法：让权限库来"声明"身份】
 *   `t_perm_role.equiv_role_code` 一列 —— 建角色时声明「我等价于谁」。
 *   server-job 启动时/定期把这张映射灌进来（见 `utils/roleEquiv.ts`），
 *   于是所有 `hasRole(roles, 'PROJECT_MANAGER')` 对 `XMJL_000` **自动成立**，
 *   业务代码一行都不用改。
 *
 * 【为什么不用「改数据库 role_code」】
 *   权限库的 role_code 是**存量数据**（账号绑定、页面授权台账都挂着它），
 *   改名牵连一大片。声明式等价是最低成本的做法。
 *
 * ⚠️ 线程/时序说明：这里是**模块级可变状态**，由外部加载器写入。
 *    读的时候拿不到就退回静态表 —— 绝不会因为「没加载完」而误判权限
 *    （顶多是自建角色暂时不生效，属于安全侧失败）。
 */

/** 自建角色码 → 它声明等价的内置角色码（由 roleEquiv 加载器写入） */
const DYNAMIC_EQUIV: Record<string, string> = {};

/** 反向：内置角色码 → 声明等价于它的自建角色码集合（派生，避免每次遍历） */
const DYNAMIC_EXTRA_ALIASES: Record<string, string[]> = {};

/**
 * 注册「自建角色 → 内置角色」的等价关系（由 server-job 的加载器调用）
 *
 * ⚠️ 传入空对象 = 清空动态注册，回到「只有静态表」的状态。
 *    加载失败时**务必传空或跳过**，不要保留上一轮的陈旧数据 ——
 *    管理员刚把某角色的等价声明去掉，不该因为缓存没过期而仍然放行。
 *
 * @param map 形如 `{ XMJL_000: 'PROJECT_MANAGER' }`
 */
export function registerEquivalentRoles(map: Record<string, string> | null | undefined): void {
  // 清空旧的派生索引
  for (const k of Object.keys(DYNAMIC_EXTRA_ALIASES)) delete DYNAMIC_EXTRA_ALIASES[k];
  for (const k of Object.keys(DYNAMIC_EQUIV)) delete DYNAMIC_EQUIV[k];

  if (!map) return;

  for (const [customCode, builtinCode] of Object.entries(map)) {
    if (!customCode || !builtinCode) continue;
    // 不做链式解析：只接受「自建 → 内置」，内置角色自己不需要声明
    if (DYNAMIC_EQUIV[customCode]) continue; // 一个自建角色只认一次声明
    DYNAMIC_EQUIV[customCode] = builtinCode;
    (DYNAMIC_EXTRA_ALIASES[builtinCode] ||= []).push(customCode);
  }
}

/** 取当前已注册的动态等价表（只读快照，调试/自检用） */
export function getRegisteredEquivalentRoles(): Record<string, string> {
  return { ...DYNAMIC_EQUIV };
}

/**
 * 把「任意写法的角色码」展开成它名下**所有**写法
 *
 * ★ 2026-10-08 改进：现在**双向可用**。
 *
 *   传主包码 → 返回它全部别名
 *   传权限库码 → 先反向定位到主包码，再返回该主包码的全部别名
 *
 * ★★ 2026-10-08 二次改进：并入**动态等价角色**
 *   如果权限库里某些自建角色声明了「等价于这个内置角色」
 *   （`t_perm_role.equiv_role_code`），它们会被一并返回 ——
 *   这样 `hasRole(['XMJL_000'], 'PROJECT_MANAGER')` 才能成立。
 *
 * @example
 *   expandRoleCode('PROJECT_MANAGER')  // ['PROJECT_MANAGER','RM_PROJECT', 'XMJL_000', ...]
 *   expandRoleCode('RM_PROJECT')       // 同上（反向也能展开）
 */
export function expandRoleCode(code: string): string[] {
  // ① 正向：这个 code 本身就是主包码
  const direct = ROLE_CODE_ALIAS[code];
  if (direct) {
    const dyn = DYNAMIC_EXTRA_ALIASES[code];
    return dyn && dyn.length ? [...direct, ...dyn] : [...direct];
  }
  // ② 反向：这个 code 是权限库里的某种写法 → 上升到主包码再展开
  const mainCode = ROLE_REVERSE[code];
  if (mainCode && ROLE_CODE_ALIAS[mainCode]) {
    const base = ROLE_CODE_ALIAS[mainCode];
    const dyn = DYNAMIC_EXTRA_ALIASES[mainCode];
    return dyn && dyn.length ? [...base, ...dyn] : [...base];
  }
  // ③ 未知码：看看它是不是「自建角色声明了等价于某内置角色」的那个自建码本身
  const equivTarget = DYNAMIC_EQUIV[code];
  if (equivTarget) return expandRoleCode(equivTarget);
  // ④ 彻底未知：原样返回（不吞掉未来的新角色）
  return [code];
}

/**
 * 判断「运行时角色列表里有没有某个角色」—— **别名感知**
 *
 * 这是本文件存在的意义。所有原本写
 *   `roles.includes(RoleCode.XXX)`
 * 的地方都应改用它。
 *
 * @param roles    运行时角色列表（来自权限库，可能是 RM_PROJECT 这类）
 * @param code     想判断的角色（主包 RoleCode 的写法）
 *
 * @example hasRole(['RM_PROJECT'], 'PROJECT_MANAGER')  // true ✅
 */
export function hasRole(roles: readonly string[] | undefined | null, code: string): boolean {
  if (!roles || roles.length === 0) return false;
  const wanted = expandRoleCode(code);
  return wanted.some((c) => roles.includes(c));
}

/**
 * 判断「运行时角色列表里有没有其中任意一个角色」—— 别名感知
 *
 * @example hasAnyRole(['RM_PROJECT'], ['PROJECT_MANAGER', 'JOB_STAFF'])  // true
 */
export function hasAnyRole(
  roles: readonly string[] | undefined | null,
  codes: readonly string[],
): boolean {
  if (!roles || roles.length === 0) return false;
  return codes.some((code) => hasRole(roles, code));
}

/**
 * 把运行时角色列表「归一化」成主包 RoleCode 的写法
 *
 * 用途：需要拿整个数组做多处判断时，先归一化一次，之后就能用
 * 简单的 `includes(RoleCode.XXX)` 了。
 *
 * ★ 2026-10-08：自建角色若声明了等价内置角色（`equiv_role_code`），
 *   会**归一成那个内置码** —— 于是数组里 `XMJL_000` 变成 `PROJECT_MANAGER`，
 *   下游哪怕用 `includes` 也能命中。
 *
 * ⚠️ 注意：无法识别的角色码会**原样保留**（不丢弃），
 *    以免把未来的新角色吞掉。
 *
 * @example normalizeRoles(['RM_PROJECT', 'SYS_ADMIN'])
 *          // ['PROJECT_MANAGER', 'SYS_ADMIN']
 *          normalizeRoles(['XMJL_000'])   // ['PROJECT_MANAGER']（若声明了等价）
 */
export function normalizeRoles(roles: readonly string[] | undefined | null): string[] {
  if (!roles || roles.length === 0) return [];
  const out = new Set<string>();
  for (const r of roles) {
    // ★ 依次尝试：动态等价 → 静态反向索引 → 原样
    out.add(DYNAMIC_EQUIV[r] ?? ROLE_REVERSE[r] ?? r);
  }
  return [...out];
}
