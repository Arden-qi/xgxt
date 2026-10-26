/**
 * 角色 → 操作码 叠加层（**按钮级 + 接口级**打通 legacy 四板块 ← 权限树）
 *
 * ============================================================
 * 【解决什么问题】
 *   「职位权限分配」页面（/perm/assign）维护的是 `sms_perm.t_perm_role_perm`
 *   —— 一棵**权限树**，命名体系是
 *     `module_key`（market/teach/train/job/acad/fin/approve/perm）
 *     + 中文功能点（如「学生基础数据」）
 *     + 英文动作码（如 create / uploadAttend / submitApply）
 *
 *   而 legacy 四个板块（实训 job / 教务 edu / 班级 class / 班级初高 classjh）
 *   的按钮与接口判权用的是**另一套操作码**：
 *     `class:student:add` / `class:grade:add` / `edu:student:edit` …
 *     （前端 `can('class:student:add')`，后端 `checkPermission('class:student:add')`）
 *
 *   两套命名**没有任何一列能对上**（`class` 不是树里的模块名，
 *   树里的动作叫 `create` 而操作码里叫 `add`）→ 于是「权限树改了，
 *   按钮/接口不动」，管理员在界面上取消了某动作，按钮照样在、接口照样通。
 *
 * 【本文件做什么】
 *   ① 维护一张**显式映射表** `PERM_POINT_TO_ACTION_CODES`：
 *        树上的 (module, item, action)  →  若干个 legacy 操作码
 *   ② 用**差异存储**把权限树「改动的那部分」叠加到静态兜底表上。
 *
 * ============================================================
 * 【★★ 差异存储语义（本文件最核心的一条，别改）】
 *
 *   基线（baseline）= **本功能第一次启用时**权限树里的勾选状态，
 *   快照在 `sms_perm.t_perm_role_perm_baseline`（首次使用自动灌入，幂等）。
 *
 *      新增授权 = 现在勾了 − 基线勾过        → 映射成操作码【补上】
 *      撤销授权 = 基线勾过 − 现在没勾        → 映射成操作码【移除】
 *
 *      最终操作码(role) = 静态兜底表(role) ∪ mapped(新增) − mapped(撤销)
 *
 *   为什么必须这样（血的教训，2026-10-07 实测）：
 *     直接把权限树当权威会**误伤**——树的 `teach` 模块当初是按
 *     「页面可见范围」校准的，不是按「按钮」口径：
 *       · 校长（R12）在 teach 下只勾了 view/export
 *         → 会把「新增学生 / 新建考试 / 录入成绩 / 发起退费 …」9 个按钮收走
 *       · 教员（R04）、助教（R05）同理各丢 1 个 / 4 个
 *     而按「差异存储」：**打通当天零变化**（没有差异 ⇒ 不干预），
 *     管理员之后在界面上勾/取消 → 立刻双向生效。
 *
 *   ⚠️ 这也意味着：树里**本来就勾着**、但静态表里没有的动作，
 *      不会自动授权（它不是一次「改动」）。这是刻意的 ——
 *      保证上线当天对全站 16 个账号零行为变化。
 *
 * ============================================================
 * 【降级原则】
 *   ⚠️ 与 rolePageLedger 一样：查库失败 / 基线缺失 → 当作「没有任何覆盖」，
 *      原样返回静态表。绝不能因为权限表抖一下就让全站按钮消失、接口全 403。
 * ============================================================
 */

import { db } from '../perm/utils/db';
import { PERM_TREE, PERM_TREE_ACTION_OPS } from '../perm/config/permTree';

/* ============================================================
 * 1. 映射表：(module||item) → { 树上动作码 → legacy 操作码[] }
 * ============================================================ */

/**
 * 维护提示：
 *   · key 一律 `module_key||item_name`（与 `t_perm_menu` 的列口径一致）
 *   · value 的 key 是 `t_perm_menu_action.action_code`
 *   · value 的值是该动作对应的一到多个 legacy 操作码
 *     （一个动作对应多码：如「录入成绩」在前端叫 `class:grade:add`、
 *       后端叫 `class:examScore:add`，两套码都要给到）
 *   · **只登记能明确对应的**；对应不上的动作不写 → 该动作不影响按钮
 */
/**
 * ★ 2026-10-22：映射表不再手写，改为**由权限树定义派生**
 *
 * 旧版这里是一张手抄的大表（8 板块 53 功能点 → 各模块操作码），
 * 每加一个功能点就要记得来登记一次 —— 2026-10-07 就因为漏登记 6 个
 * train 功能点，出现「权限树改了、按钮和接口都不动」。
 *
 * 现在权限树本身（`perm/config/permTree.ts`）的每个动作都带 `ops`，
 * 这张表直接从它派生：
 *   键盘输入 → t_perm_menu（界面） 与 操作码（判权）**同源**，不可能漂移。
 */
export const PERM_POINT_TO_ACTION_CODES: Record<string, Record<string, string[]>> =
  PERM_TREE_ACTION_OPS;

/* ============================================================
 * 2. 权限管理模块（perm）—— **同名映射**
 *
 *   树上的模块 key 就叫 `perm`，操作码格式天然同构：
 *     · perm||职位管理||add          → perm:职位管理:add
 *     · perm||职位权限分配||editPerm → perm:职位权限分配:editPerm
 *   所以这里只需要「每个页面有哪些动作」，同样从权限树派生。
 * ============================================================ */

const PERM_MODULE_ACTIONS: Record<string, string[]> = Object.fromEntries(
  PERM_TREE.filter((b) => b.moduleKey === 'perm').flatMap((b) =>
    b.pages.map((p) => [`perm||${p.name}`, p.actions.map((a) => a.code)] as [string, string[]]),
  ),
);

/** 把 `perm||功能点||动作` 拼成权限管理自己的操作码 */
function permCodeOf(itemKey: string, action: string): string {
  const item = itemKey.split('||')[1];
  return `perm:${item}:${action}`;
}

/* ============================================================
 * 3. 基线表（快照）
 * ============================================================ */

const BASELINE_TABLE = 't_perm_role_perm_baseline';

let baselineEnsured: Promise<void> | null = null;

/**
 * 建基线表，并**在第一次使用时**把当前权限树全量灌进去。
 *
 * ⚠️ 幂等：表里已有数据就什么都不做。
 * ⚠️ 「基线」的语义 = 本功能启用那一刻，权限树的既有状态。
 *    想重置基线（把当前状态重新认定为基线）：
 *      DELETE FROM sms_perm.t_perm_role_perm_baseline; 然后重启后端。
 */
async function ensureBaselineTable(): Promise<void> {
  if (baselineEnsured) return baselineEnsured;

  baselineEnsured = (async () => {
    await db.raw(`
      CREATE TABLE IF NOT EXISTS ${BASELINE_TABLE} (
        id VARCHAR(191) NOT NULL PRIMARY KEY,
        role_code VARCHAR(64) NOT NULL,
        module_key VARCHAR(32) NOT NULL,
        item_name VARCHAR(64) NOT NULL,
        action_code VARCHAR(64) NOT NULL,
        create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY idx_role (role_code)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    const [cnt] = (await db.raw(`SELECT COUNT(*) AS c FROM ${BASELINE_TABLE}`)) as any;
    if (Number(cnt?.[0]?.c || 0) > 0) return; // 已有基线 → 不覆盖

    // 首次：把当前权限树全量快照为基线
    await db.raw(`
      INSERT IGNORE INTO ${BASELINE_TABLE} (id, role_code, module_key, item_name, action_code)
      SELECT CONCAT(r.role_code, '|', rp.module_key, '|', rp.item_name, '|', rp.action_code),
             r.role_code, rp.module_key, rp.item_name, rp.action_code
      FROM t_perm_role_perm rp
      JOIN t_perm_role r ON r.id = rp.role_id
      WHERE rp.is_deleted = 0 AND r.is_deleted = 0
    `);

    // eslint-disable-next-line no-console
    console.log(`[权限] 已建立「按钮权限」基线快照（${BASELINE_TABLE}）`);
  })().catch((e) => {
    // 建表失败 → 关闭本次的 ensure，下次重试；但不影响主流程（会降级为「无覆盖」）
    baselineEnsured = null;
    throw e;
  });

  return baselineEnsured;
}

/* ============================================================
 * 4. 读取（带 15 秒内存缓存）
 * ============================================================ */

export interface RoleActionOverride {
  /** 该角色在权限树里「有记录」的功能点（module||item） */
  touchedItems: Set<string>;
  /** 现在勾选的三元组（module||item||action） */
  granted: Set<string>;
  /** 基线里勾选的三元组 */
  baselineGranted: Set<string>;
  /** ★ 预计算：「新增授权」映射出的操作码（供同步判定用，避免每请求重算） */
  addedCodes?: Set<string>;
  /** ★ 预计算：「撤销授权」映射出的操作码 */
  removedCodes?: Set<string>;
}

const CACHE_TTL_MS = 15_000;

let cache: { at: number; map: Map<string, RoleActionOverride> } | null = null;

/** 清缓存（权限管理保存角色权限后调用，让按钮/接口判定立刻生效） */
export function clearRoleActionCache(): void {
  cache = null;
}

/**
 * 读全部「角色 → 权限点」明细 + 基线，按 **role_code** 聚合。
 *
 * ⚠️ key 用 role_code：运行时 `req.user.roles` 是一串 role_code，
 *    role_id 是权限库主键，两者靠 t_perm_role 关联。
 */
export async function loadRoleActionOverrides(
  force = false,
): Promise<Map<string, RoleActionOverride>> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.map;

  const map = new Map<string, RoleActionOverride>();
  try {
    await ensureBaselineTable();

    const rows = await db('t_perm_role_perm as rp')
      .leftJoin('t_perm_role as r', 'r.id', 'rp.role_id')
      .where('rp.is_deleted', false)
      .andWhere('r.is_deleted', false)
      .select(
        'r.role_code as roleCode',
        'rp.module_key as moduleKey',
        'rp.item_name as itemName',
        'rp.action_code as actionCode',
      );

    for (const row of rows as any[]) {
      const code = String(row.roleCode || '');
      const mod = String(row.moduleKey || '');
      const item = String(row.itemName || '');
      const act = String(row.actionCode || '');
      if (!code || !mod || !item || !act) continue;

      let ov = map.get(code);
      if (!ov) {
        ov = { touchedItems: new Set(), granted: new Set(), baselineGranted: new Set() };
        map.set(code, ov);
      }
      ov.touchedItems.add(`${mod}||${item}`);
      ov.granted.add(`${mod}||${item}||${act}`);
    }

    /* ---- 基线 ---- */
    const baseRows = await db(BASELINE_TABLE).select(
      'role_code as roleCode',
      'module_key as moduleKey',
      'item_name as itemName',
      'action_code as actionCode',
    );
    for (const row of baseRows as any[]) {
      const code = String(row.roleCode || '');
      if (!code) continue;
      let ov = map.get(code);
      if (!ov) {
        ov = { touchedItems: new Set(), granted: new Set(), baselineGranted: new Set() };
        map.set(code, ov);
      }
      ov.baselineGranted.add(
        `${row.moduleKey}||${row.itemName}||${row.actionCode}`,
      );
    }

    /* ---- ★ 预计算「新增 / 撤销」的操作码（供各业务模块同步判定）---- */
    for (const ov of map.values()) {
      const d = diffOfOverride(ov);
      ov.addedCodes = new Set(d.added);
      ov.removedCodes = new Set(d.removed);
    }
  } catch {
    /**
     * ⚠️ 查库失败 → 当作「没有任何覆盖」放行（与 rolePageLedger 同一降级原则）。
     *    权限表抖一下，按钮不该跟着消失、接口不该全 403。
     */
    cache = { at: Date.now(), map: new Map() };
    return cache.map;
  }

  cache = { at: Date.now(), map };
  return map;
}

/** 取单个角色的权限点覆盖 */
export async function getRoleActionOverride(roleCode: string): Promise<RoleActionOverride | null> {
  const map = await loadRoleActionOverrides();
  return map.get(roleCode) || null;
}

/* ============================================================
 * 5. 叠加到操作码（差异存储）
 * ============================================================ */

/** 把「差异」换算成操作码：changed 里的三元组 → 它们映射出的操作码 */
function codesOfChanged(
  changed: (actSet: Set<string>) => Set<string>,
  ov: RoleActionOverride,
): string[] {
  const out: string[] = [];

  const collect = (itemKey: string, actMap: Record<string, string[]>): void => {
    changed(new Set(Object.keys(actMap).map((a) => `${itemKey}||${a}`))).forEach((k) => {
      const act = k.split('||')[2];
      const codes = actMap[act];
      if (codes) codes.forEach((c) => out.push(c));
    });
  };

  for (const [itemKey, actMap] of Object.entries(PERM_POINT_TO_ACTION_CODES)) {
    collect(itemKey, actMap);
  }
  for (const [itemKey, actions] of Object.entries(PERM_MODULE_ACTIONS)) {
    collect(itemKey, Object.fromEntries(actions.map((a) => [a, [permCodeOf(itemKey, a)]])) as any);
  }
  return out;
}

/**
 * 把「相对基线的改动」叠加到 legacy 操作码列表上。
 *
 * @param baseCodes 该角色的静态兜底操作码（ROLE_OPERATION_PERMISSIONS）
 * @param ov        该角色的权限点覆盖（null = 树里没有这个角色 → 不干预）
 */
export function overlayActionCodes(
  baseCodes: string[],
  ov: RoleActionOverride | null,
): string[] {
  if (!ov) return baseCodes;

  /** 现在勾了 − 基线勾过 = 新增 */
  const added = codesOfChanged(
    (keys) =>
      new Set(Array.from(keys).filter((k) => ov.granted.has(k) && !ov.baselineGranted.has(k))),
    ov,
  );
  /** 基线勾过 − 现在没勾 = 撤销 */
  const removed = codesOfChanged(
    (keys) =>
      new Set(Array.from(keys).filter((k) => !ov.granted.has(k) && ov.baselineGranted.has(k))),
    ov,
  );

  if (!added.length && !removed.length) return baseCodes;

  const set = new Set(baseCodes);
  removed.forEach((c) => set.delete(c));
  added.forEach((c) => set.add(c));
  return Array.from(set);
}

/* ============================================================
 * 6. 诊断用：算出某角色的「新增 / 撤销」明细（不改数据）
 * ============================================================ */

export function diffOfOverride(ov: RoleActionOverride | null): { added: string[]; removed: string[] } {
  if (!ov) return { added: [], removed: [] };
  const added = codesOfChanged(
    (keys) =>
      new Set(Array.from(keys).filter((k) => ov.granted.has(k) && !ov.baselineGranted.has(k))),
    ov,
  );
  const removed = codesOfChanged(
    (keys) =>
      new Set(Array.from(keys).filter((k) => !ov.granted.has(k) && ov.baselineGranted.has(k))),
    ov,
  );
  return { added: Array.from(new Set(added)), removed: Array.from(new Set(removed)) };
}

/* ============================================================
 * 7.1 ★ 权限树「当前勾选」判定（不看基线差异）
 *
 *   【为什么需要它 —— 2026-10-26 实测 bug】
 *     财务核对接口 `finance:fee:verify` 只认静态表 FIN_ROLE_OPERATIONS
 *     （只有 FIN_STAFF / SYS_ADMIN）+ 差异覆盖。
 *     校长（RM_PRINCIPAL）在「职位权限分配」里把「财务管理」全勾了，
 *     但**基线快照里本来就有这 18 项** → 差异为空 → 没有 added 覆盖；
 *     静态表又没有校长 → 直接 403「您没有该操作的权限」。
 *
 *   差异语义对「静态表里已有该角色」的模块是**对的**（防上线当天误伤），
 *   但对「静态表里根本没有这个角色」的模块（finance 只认财务与管理员），
 *   该角色在树里勾什么都不会生效 —— 这时**权限树必须是唯一权威**。
 *
 *   所以调用方用法固定为：
 *     · 角色在静态表里有条目 → 只走 resolveActionWithOverlay（行为不变）
 *     · 角色在静态表里没条目 → 再补一次 isActionGrantedInTree
 * ============================================================ */

/** legacy 操作码 → 权限树上的 `${module}||${item}||${action}` 集合（惰性建索引） */
let codeToTreeKeys: Map<string, Set<string>> | null = null;
function treeKeysOf(code: string): Set<string> {
  if (!codeToTreeKeys) {
    codeToTreeKeys = new Map();
    for (const [point, acts] of Object.entries(PERM_POINT_TO_ACTION_CODES)) {
      for (const [act, codes] of Object.entries(acts)) {
        if (!Array.isArray(codes)) continue;
        for (const c of codes) {
          let set = codeToTreeKeys.get(c);
          if (!set) codeToTreeKeys.set(c, (set = new Set()));
          set.add(`${point}||${act}`);
        }
      }
    }
  }
  return codeToTreeKeys.get(code) || new Set();
}

/**
 * 这些角色里，是否有任何一个在**权限树里当前勾着**该操作码。
 *
 * 与 `resolveActionWithOverlay` 的区别：本函数**不看基线**，
 * 只看"现在树里有没有勾"。用于静态白名单未覆盖的角色。
 */
export function isActionGrantedInTree(
  roleCodes: string[] | undefined,
  actionCode: string,
): boolean {
  const roles = Array.isArray(roleCodes) ? roleCodes : [];
  if (!cache || !actionCode) return false;
  const keys = treeKeysOf(actionCode);
  if (!keys.size) return false;
  for (const role of roles) {
    const ov = cache.map.get(role);
    if (!ov) continue;
    for (const k of keys) {
      if (ov.granted.has(k)) return true;
    }
  }
  return false;
}

/**
 * 角色是否**已**被某模块的静态表认过（用来决定要不要补 `isActionGrantedInTree`）。
 *
 * 用法：
 *   const known = hasStaticEntry(roles, FIN_ROLE_OPERATIONS);
 *   const allowed = resolveActionWithOverlay(...) || (!known && isActionGrantedInTree(roles, code));
 */
export function hasStaticEntry(
  roleCodes: string[] | undefined,
  staticTable: Record<string, unknown>,
): boolean {
  const roles = Array.isArray(roleCodes) ? roleCodes : [];
  return roles.some((r) => Object.prototype.hasOwnProperty.call(staticTable, r));
}

/* ============================================================
 * 7. ★ 同步判定接口（给各业务模块的【后端接口判权】用）
 *
 *   背景：四个 legacy 模块（class / class-jh / consult / finance）的接口
 *   判权各写各的（角色白名单 / 正则策略表 / 操作码表），都**不读权限树**。
 *   结果：管理员在「职位权限分配」里取消了某动作 → 按钮没了，
 *        但直接敲接口仍然成功（前后端不一致）。
 *
 *   本节提供 3 个函数，让这些模块用**最小改动**接入：
 *     · preloadRoleActionOverrides() —— 中间件里 await 一下，保证缓存新鲜
 *     · resolveActionWithOverlay()   —— 把「显式撤销 / 显式授权」叠加到
 *                                       模块自己的静态判权之上
 *
 *   ⚠️ 全部是「差异存储」语义：没被管理员改动过的码，行为与从前**完全一致**。
 * ============================================================ */

/** 读内存缓存里的某角色覆盖（缓存未就绪 → null = 不干预，交静态表） */
export function getOverrideSync(roleCode: string): RoleActionOverride | null {
  return cache ? cache.map.get(roleCode) || null : null;
}

/**
 * 预热内存缓存。
 *
 * 15s TTL 内是纯内存读（零查库成本），所以可以在**每个鉴权中间件**里 await；
 * 「职位权限分配」保存时会 `clearRoleActionCache()`，下一请求即重新加载 → 即时生效。
 */
export async function preloadRoleActionOverrides(): Promise<void> {
  try {
    await loadRoleActionOverrides();
  } catch {
    /* 降级：查不到就当作「无覆盖」，绝不因为权限库抖动拦掉正常业务 */
  }
}

function addedCodesOf(ov: RoleActionOverride): Set<string> {
  if (!ov.addedCodes) ov.addedCodes = new Set(diffOfOverride(ov).added);
  return ov.addedCodes;
}

function removedCodesOf(ov: RoleActionOverride): Set<string> {
  if (!ov.removedCodes) ov.removedCodes = new Set(diffOfOverride(ov).removed);
  return ov.removedCodes;
}

/**
 * ★★ 统一收口入口：把权限树的「显式改动」叠加到模块自己的静态判权上。
 *
 * 语义（逐角色判定，任一角色放行即放行 —— 与各模块原有的 `hasAnyRole` 口径一致）：
 *
 *   for each role:
 *     · 该 role 的这个码被【显式授权】  → 放行（覆盖静态表）
 *     · 该 role 的这个码被【显式撤销】  → 跳过（不再贡献放行）
 *     · 其余情况（含权限树里没这个角色） → 走模块自己的静态判权 staticAllow(role)
 *
 * @param roleCodes    用户拥有的角色码（role_code，如 TEACH_HEAD）
 * @param actionCode   本次要判的操作码（如 class:student:add）
 * @param staticAllow  模块自己的静态判权：该角色是否被允许
 */
export function resolveActionWithOverlay(
  roleCodes: string[] | undefined,
  actionCode: string,
  staticAllow: (roleCode: string) => boolean,
): boolean {
  const roles = Array.isArray(roleCodes) ? roleCodes : [];
  let allow = false;
  for (const role of roles) {
    const ov = cache ? cache.map.get(role) : null;
    if (ov) {
      if (addedCodesOf(ov).has(actionCode)) return true;
      if (removedCodesOf(ov).has(actionCode)) continue;
    }
    if (staticAllow(role)) allow = true;
  }
  return allow;
}

/* ============================================================
 * 8. ★ 前端按钮显隐用：取「被权限树显式撤销」的操作码
 *
 *   背景：job/edu 板块的按钮默认显隐由「角色」决定（各页面自己写死的
 *   角色白名单，如 `canInitiate = TEACH_HEAD`），这套默认是对的。
 *   但管理员在「职位权限分配」里取消某个动作后，对应按钮要跟着消失。
 *
 *   语义与后端总闸（boardPermGate）一致：只叠加「相对基线的撤销」，
 *   没被管理员动过的码，前端默认行为与从前**完全一致**（零回归）。
 * ============================================================ */
export function getRemovedActionCodesForRoles(roleCodes: string[] | undefined): string[] {
  const roles = Array.isArray(roleCodes) ? roleCodes : [];
  const set = new Set<string>();
  for (const role of roles) {
    const ov = cache ? cache.map.get(role) : null;
    if (!ov) continue;
    removedCodesOf(ov).forEach((c) => set.add(c));
  }
  return Array.from(set);
}
