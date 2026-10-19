/**
 * 权限管理模块 · 领域服务
 *
 * 把「查询数据库 → 组装成契约要求的形状」这类逻辑集中在这里，
 * 路由文件只负责：校验参数 → 调服务 → 包响应。
 *
 * ⚠️ 权限模型：模块 → 功能点 → 动作
 *    t_perm_menu          功能点
 *    t_perm_menu_action   动作
 *    t_perm_role_perm     职位已授权的（功能点，动作）
 */

import { randomUUID } from 'crypto';
import {
  DataScope,
  PermModule,
  PermItem,
  PermActionItem,
  PermTreeStats,
  RolePermMap,
  LogResult,
  PermLog,
  PERM_BASE_ACTION_NAME,
} from 'shared-types/perm';
import { db } from '../utils/db';

/* ============================================================
 * 一、权限树
 * ============================================================ */

/**
 * 读取完整权限树（8 模块 / 53 个顶级功能点 / 185 动作）
 * ⚠️ 带 60 秒内存缓存：权限树很少变，避免每个请求都打两次库。
 */
let treeCache: { at: number; data: PermModule[] } | null = null;
const TREE_TTL = 60 * 1000;

export function clearTreeCache(): void {
  treeCache = null;
}

export async function loadModules(force = false): Promise<PermModule[]> {
  if (!force && treeCache && Date.now() - treeCache.at < TREE_TTL) {
    return treeCache.data;
  }

  const menus = await db('t_perm_menu')
    .where('is_deleted', false)
    .orderBy([{ column: 'module_sort' }, { column: 'item_sort' }]);

  const actions = await db('t_perm_menu_action')
    .where('is_deleted', false)
    .orderBy('action_sort');

  const actByMenu = new Map<string, PermActionItem[]>();
  for (const a of actions) {
    const list = actByMenu.get(a.menu_id) || [];
    list.push({
      actionCode: a.action_code,
      actionName: a.action_name,
      baseAction: a.base_action,
      baseActionName:
        PERM_BASE_ACTION_NAME[a.base_action] || String(a.base_action),
      remark: a.remark || undefined,
    });
    actByMenu.set(a.menu_id, list);
  }

  const modMap = new Map<string, PermModule>();
  for (const m of menus) {
    let mod = modMap.get(m.module_key);
    if (!mod) {
      mod = {
        moduleKey: m.module_key,
        moduleName: m.module_name,
        moduleIcon: m.module_icon || '',
        sortNo: m.module_sort,
        items: [],
        itemCount: 0,
      };
      modMap.set(m.module_key, mod);
    }
    const item: PermItem = {
      id: m.id,
      itemName: m.item_name,
      parentItemName: m.parent_item_name || undefined,
      actions: actByMenu.get(m.id) || [],
      remark: m.remark || undefined,
    };
    mod.items.push(item);
    mod.itemCount = (mod.itemCount || 0) + 1;
  }

  const data = Array.from(modMap.values()).sort((a, b) => a.sortNo - b.sortNo);
  treeCache = { at: Date.now(), data };
  return data;
}

/**
 * 权限树整体统计
 *
 * ⚠️ 两个口径必须分开算，对齐原型 treeStats()：
 *    · itemCount   —— 只算【顶级功能点】（parent_item_name 为空）。
 *                     二级功能点归属其父项，不单独计数。
 *                     例：审批中心「教质/学术审批」带 2 个子项，只算 1 个功能点。
 *    · actionCount —— 按【全部】功能点求和。
 *                     父项自身不挂动作（动作都在子项上），故不会重复计。
 */
export async function getTreeStats(): Promise<PermTreeStats> {
  const mods = await loadModules();
  let itemCount = 0;
  let actionCount = 0;
  mods.forEach((m) =>
    m.items.forEach((it) => {
      if (!it.parentItemName) itemCount += 1;
      actionCount += it.actions.length;
    }),
  );
  return { modCount: mods.length, itemCount, actionCount };
}

/* ============================================================
 * 二、职位权限
 * ============================================================ */

const permKey = (moduleKey: string, itemName: string) => `${moduleKey}||${itemName}`;

/** 读某职位的权限映射 */
export async function getRolePermMap(roleId: string): Promise<RolePermMap> {
  const rows = await db('t_perm_role_perm')
    .where({ role_id: roleId, is_deleted: false })
    .orderBy('create_time');

  const map: RolePermMap = {};
  for (const r of rows) {
    const key = permKey(r.module_key, r.item_name);
    if (!map[key]) map[key] = [];
    map[key].push(r.action_code);
  }
  return map;
}

/** 某职位的已授权动作总数 */
export async function countRolePerms(roleId: string): Promise<number> {
  const rows = await db('t_perm_role_perm')
    .where({ role_id: roleId, is_deleted: false })
    .count({ n: '*' });
  return Number(rows[0]?.n || 0);
}

/**
 * 全量覆盖保存某职位的权限
 * ⚠️ 应用权限为全量覆盖（非增量合并）：先按 role_id 清空，再插入。
 */
export async function replaceRolePerms(
  roleId: string,
  perms: RolePermMap,
  operatorId: string,
): Promise<number> {
  const mods = await loadModules();
  const menuOf = new Map<string, { id: string; moduleKey: string; itemName: string; acts: Map<string, { name: string; base: number }> }>();
  mods.forEach((m) =>
    m.items.forEach((it) => {
      menuOf.set(permKey(m.moduleKey, it.itemName), {
        id: it.id,
        moduleKey: m.moduleKey,
        itemName: it.itemName,
        acts: new Map(it.actions.map((a) => [a.actionCode, { name: a.actionName, base: a.baseAction }])),
      });
    }),
  );

  const rows: Record<string, unknown>[] = [];
  Object.keys(perms || {}).forEach((key) => {
    const menu = menuOf.get(key);
    if (!menu) return; // 忽略不认识的功能点，防止脏数据入库
    const codes = Array.from(new Set(perms[key] || []));
    codes.forEach((code) => {
      const act = menu.acts.get(code);
      if (!act) return; // 忽略不认识的动作
      rows.push({
        id: randomUUID(),
        role_id: roleId,
        menu_id: menu.id,
        module_key: menu.moduleKey,
        item_name: menu.itemName,
        action_code: code,
        action_name: act.name,
        base_action: act.base,
        is_deleted: false,
        create_time: new Date(),
        create_by: operatorId,
      });
    });
  });

  await db.transaction(async (trx) => {
    await trx('t_perm_role_perm').where({ role_id: roleId }).del();
    if (rows.length) {
      // 分片插入，避免单条 SQL 过大
      const CHUNK = 200;
      for (let i = 0; i < rows.length; i += CHUNK) {
        await trx('t_perm_role_perm').insert(rows.slice(i, i + CHUNK));
      }
    }
    await trx('t_perm_role').where({ id: roleId }).update({
      perm_count: rows.length,
      update_time: new Date(),
      update_by: operatorId,
    });
  });

  return rows.length;
}

/* ============================================================
 * 三、账号权限（多职位取并集）
 * ============================================================ */

/**
 * 取某账号全部职位的权限并集
 *
 * ⚠️⚠️ 2026-10-03 修正：权限串里的【动作段改用 action_code（英文编码）】
 *
 * 改造前形如 `['market:预到校名单:查看', ...]`（动作名用中文）。
 * 问题：各模块的 checkPermission() 写的是英文动作编码，例如
 *     perm 模块 → checkPermission('perm:权限配置:editPerm')
 *   而库里 editPerm 这个动作的中文名是「编辑权限」，
 *   于是拼出来的串是 'perm:权限配置:编辑权限' ≠ 'perm:权限配置:editPerm'，
 *   永远匹配不上 → 模块负责人保存权限一律 403（实测复现）。
 *
 * 修正后形如 `['market:预到校名单:view', 'perm:权限配置:editPerm', ...]`，
 * 与各模块 checkPermission() 的书写口径完全一致，也与 JWT 里
 * permissions 字段「只放机器可判定的编码」这一约定一致。
 *
 * @returns permissions 去重后的权限点数组（动作段为 action_code）
 *          dataScope   取所有职位中最宽的一档
 */
export async function getUserEffectivePerms(userId: string): Promise<{
  roleIds: string[];
  permissions: string[];
  dataScope: DataScope;
}> {
  const links = await db('t_perm_user_role').where({ user_id: userId, is_deleted: false });
  const roleIds = links.map((l: any) => l.role_id);
  if (!roleIds.length) {
    return { roleIds: [], permissions: [], dataScope: DataScope.SELF };
  }

  const rows = await db('t_perm_role_perm')
    .whereIn('role_id', roleIds)
    .andWhere('is_deleted', false);

  const set = new Set<string>();
  let widest = DataScope.SELF;
  for (const r of rows) {
    // ⚠️ 动作段用 action_code，不用 action_name
    set.add(`${r.module_key}:${r.item_name}:${r.action_code}`);
    const scope = SCOPE_ACTION_TO_VALUE[r.action_code];
    if (scope && scope > widest) widest = scope;
  }

  return { roleIds, permissions: Array.from(set), dataScope: widest };
}

/** 行级数据范围动作 → 数据范围枚举值 */
export const SCOPE_ACTION_TO_VALUE: Record<string, DataScope> = {
  scopeSelf: DataScope.SELF,
  scopeClass: DataScope.CLASS,
  scopeDept: DataScope.DEPT,
  scopeAll: DataScope.ALL,
};

/* ============================================================
 * 三之二、门户账号 ↔ 权限库账号 的桥接（2026-10-03 新增）
 *
 * ⚠️⚠️ 为什么需要这一层：
 *    本系统里存在【两张账号表】：
 *      · t_sys_account（门户 sms_portal 库）—— 登录唯一凭据，7 个种子账号
 *      · t_perm_user  （权限 sms_perm 库）  —— 职位 / 权限 / 数据范围，15 个种子账号
 *    两张表【没有共用主键】，只能靠 `account`（登录名）对齐。
 *    实测：两张表原本只有 admin 一个账号重合 —— 所以「权限分配」保存的数据
 *    在财务 / 咨询模块里根本读不到，这正是用户说的「权限分配没生效」。
 *
 *    本模块是权限数据的【单一事实来源】，所以由本模块负责：
 *      登录名 → t_perm_user.id → 职位并集 → 有效权限点 + 数据范围
 *    并把「按模块算出来的可见页面」交给各业务模块消费。
 * ============================================================ */

/**
 * ⭐ 2026-10-16 新增：把密码同步到【门户登录表】（`sms_portal`.t_sys_account）
 *
 * 【为什么必须同步】
 *   用户报障：「在账号管理里给陈晓峰设了密码，用新密码登不进系统」。
 *   真因就是上面那两张账号表：门户登录只校验 `t_sys_account.password`
 *   （见 portal/services/account.service.ts 的 login），
 *   而「账号管理 / 重置密码 / 编辑账号」写的是 `t_perm_user.password` ——
 *   两边各写各的，改了业务表完全不影响登录，用户自然进不来。
 *
 * 【口径】本模块是账号的维护方，门户表是登录凭据的【镜像】：
 *   凡本模块改了 t_perm_user.password，就同步一份到同登录名的门户账号。
 *   （反方向——登录人自助改密——由门户那边负责同步，见
 *     portal/services/account.service.ts 的 changeOwnPassword）
 *
 * 【跨库写法】与 class / consult 模块一致：同一个连接里用全限定表名跨库读写。
 *
 * @returns true = 门户表里确实有这个登录名并已更新；
 *          false = 门户表里没有这个账号（没同步 —— 这个人也就登不进门户）
 * @remarks 门户库连不上等异常【不抛错】，只打 warn ——「改密码」不该被门户抖动连累。
 */
export async function syncPortalPassword(account: string, password: string): Promise<boolean> {
  if (!account || !password) return false;
  const portalDb = process.env.DB_NAME_PORTAL || 'sms_portal';
  try {
    const res: any = await db.raw(
      `UPDATE \`${portalDb}\`.t_sys_account
          SET password = ?, update_time = NOW()
        WHERE account = ? AND is_deleted = 0`,
      [password, account],
    );
    const affected = Number(res?.[0]?.affectedRows ?? 0);
    if (!affected) {
      // 常见坑：t_perm_user 有、t_sys_account 没有 → 这个人永远登不进门户
      console.warn(`[perm] 门户账号表里没有登录名「${account}」，密码未同步（该账号无法登录）`);
      return false;
    }
    return true;
  } catch (e: any) {
    console.warn(`[perm] 同步门户登录密码失败（account=${account}）：${e?.message || e}`);
    return false;
  }
}

/**
 * 门户账号的简要信息（登录名 → 可访问模块 / 启用状态）
 */
export interface PortalAccountBrief {
  /** 门户账号 id */
  id: string;
  /** 可访问模块 key 数组（如 ['class']） */
  modules: string[];
  /** 是否启用 */
  active: boolean;
}

/** 解析门户表里的 modules 列（库里存 JSON 字符串，兼容逗号分隔的老数据） */
function parsePortalModules(raw: any): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String);
  try {
    const arr = JSON.parse(String(raw));
    if (Array.isArray(arr)) return arr.map(String);
  } catch {
    /* 退回逗号分隔 */
  }
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 批量取门户账号信息
 *
 * ⚠️ 列表页 / 编辑表单要回显「这个账号登录后能进哪些模块」，
 *    所以按【登录名】批量查一次，避免每行一次跨库查询。
 */
export async function getPortalAccounts(accounts: string[]): Promise<Map<string, PortalAccountBrief>> {
  const out = new Map<string, PortalAccountBrief>();
  const list = Array.from(new Set((accounts || []).filter(Boolean)));
  if (!list.length) return out;
  const portalDb = process.env.DB_NAME_PORTAL || 'sms_portal';
  try {
    const res: any = await db.raw(
      `SELECT id, account, modules, active FROM \`${portalDb}\`.t_sys_account
        WHERE is_deleted = 0 AND account IN (${list.map(() => '?').join(',')})`,
      list,
    );
    const rows: any[] = Array.isArray(res?.[0]) ? res[0] : [];
    for (const r of rows) {
      if (!r?.account) continue;
      out.set(String(r.account), {
        id: String(r.id),
        modules: parsePortalModules(r.modules),
        active: !!r.active,
      });
    }
  } catch (e: any) {
    console.warn(`[perm] 读取门户账号失败：${e?.message || e}`);
  }
  return out;
}

/**
 * ⭐ 2026-10-16 新增：开通 / 更新【门户登录账号】
 *
 * 【为什么需要】
 *   门户登录要求 t_sys_account 里同时具备两样东西：**账号本身 + 至少一个可访问模块**
 *   （见 portal/services/account.service.ts 的 login：visibleModules 为空直接拒绝）。
 *   而「权限管理 → 账号管理」过去只写 t_perm_user ——
 *   结果【在账号管理里新建的账号，天生登不进系统】。
 *
 * 【口径】
 *   · 门户已有同登录名 → 只更新传进来的字段（密码 / 姓名 / 手机 / 部门 / 模块）；
 *     ⚠️ 没传 password 就【绝不动】现有密码（避免悄悄改掉一个还能用的登录密码）；
 *   · 门户没有 → 用这些字段新建一个门户账号（kind = module_owner、启用）。
 *     新建时的密码：password → passwordIfCreating → 环境变量默认值；
 *     连模块都没给就不建（建了也登不进去，白白多一条脏数据）。
 *
 * @returns existed 门户原本就有 / created 这次新建 / updated 这次改动了
 * @remarks 门户库异常只 warn 不抛错 —— 不能因为门户抖动连「建账号」都做不了。
 */
export async function upsertPortalAccount(input: {
  account: string;
  userName?: string;
  password?: string;
  /** 仅在【新建门户账号】时使用的密码（已有账号时不会拿它去覆盖） */
  passwordIfCreating?: string;
  phone?: string;
  dept?: string;
  modules?: string[];
}): Promise<{ existed: boolean; created: boolean; updated: boolean }> {
  const account = String(input.account || '').trim();
  if (!account) return { existed: false, created: false, updated: false };
  const portalDb = process.env.DB_NAME_PORTAL || 'sms_portal';
  const modules = (input.modules || []).filter(Boolean);

  try {
    const res: any = await db.raw(
      `SELECT id FROM \`${portalDb}\`.t_sys_account WHERE account = ? AND is_deleted = 0 LIMIT 1`,
      [account],
    );
    const found: any = Array.isArray(res?.[0]) ? res[0][0] : undefined;

    if (found?.id) {
      // ---- 已有门户账号：只改明确传进来的字段 ----
      const patch: Record<string, any> = {};
      if (input.password) patch.password = input.password;
      if (input.userName) patch.user_name = input.userName;
      if (input.phone) patch.phone = input.phone;
      if (input.dept) patch.dept = input.dept;
      if (modules.length) patch.modules = JSON.stringify(modules);
      if (!Object.keys(patch).length) return { existed: true, created: false, updated: false };
      patch.update_time = new Date();
      const keys = Object.keys(patch);
      // ⚠️ 列名手写不可能，但这里必须显式加反引号 ——
      //    所以拼在字符串里（不用模板串），顺手避免 `update` 之类的保留字炸掉 SQL
      const setSql = keys.map((k) => '`' + k + '` = ?').join(', ');
      await db.raw(
        `UPDATE \`${portalDb}\`.t_sys_account SET ${setSql} WHERE id = ?`,
        [...keys.map((k) => patch[k]), found.id],
      );
      return { existed: true, created: false, updated: true };
    }

    // ---- 门户里没有：必须有模块才建（否则建了也登不进去）----
    if (!modules.length) {
      console.warn(`[perm] 门户没有登录名「${account}」且未指定模块 → 未开通登录`);
      return { existed: false, created: false, updated: false };
    }
    const pwd = input.password || input.passwordIfCreating || process.env.DEFAULT_ACCOUNT_PASSWORD || '123456';
    await db.raw(
      `INSERT INTO \`${portalDb}\`.t_sys_account
         (id, create_time, create_by, create_by_name, is_deleted,
          account, password, user_name, kind, title, dept, phone, modules, active, last_login)
       VALUES (?, NOW(), 'perm-sync', '权限管理', 0, ?, ?, ?, 'module_owner', NULL, ?, ?, ?, 1, NULL)`,
      [
        randomUUID(),
        account,
        pwd,
        input.userName || account,
        input.dept || null,
        input.phone || null,
        JSON.stringify(modules),
      ],
    );
    return { existed: false, created: true, updated: false };
  } catch (e: any) {
    console.warn(`[perm] 开通/更新门户登录账号失败（account=${account}）：${e?.message || e}`);
    return { existed: false, created: false, updated: false };
  }
}

/**
 * ⭐ 2026-10-16 新增：同步门户账号的【启用状态】
 *
 * 【为什么】「账号管理 → 停用」过去只改 t_perm_user.user_status，
 *   门户登录表那边 active 仍是 1 —— 结果【被停用的人照样能登进系统】。
 *
 * @returns true = 门户账号确实被改了；false = 门户没这个登录名 / 库异常
 */
export async function setPortalAccountActive(account: string, active: boolean): Promise<boolean> {
  return updatePortalByAccount(account, { active: active ? 1 : 0 });
}

/**
 * ⭐ 2026-10-16 新增：账号被删除时【作废门户登录账号】
 *
 * 与权限库同一步调：登录名加 `#DEL#` 后缀 + 逻辑删除 + 停用。
 * 改名是为了把【唯一键腾出来】—— 否则以后用同一个登录名新建账号会撞唯一索引。
 *
 * @param renamedAccount 与权限库同规则改出来的新登录名（不传则只做作废标记）
 */
export async function retirePortalAccount(account: string, renamedAccount?: string): Promise<boolean> {
  const patch: Record<string, any> = { is_deleted: 1, active: 0 };
  if (renamedAccount) patch.account = String(renamedAccount).slice(0, 50);
  return updatePortalByAccount(account, patch);
}

/** 按登录名更新门户账号（内部工具，只改传进来的列） */
async function updatePortalByAccount(account: string, patch: Record<string, any>): Promise<boolean> {
  const acc = String(account || '').trim();
  if (!acc) return false;
  const keys = Object.keys(patch);
  if (!keys.length) return false;
  const portalDb = process.env.DB_NAME_PORTAL || 'sms_portal';
  try {
    // ⚠️ 列名必须显式加反引号 → 拼在普通字符串里（不放进模板串，免得转义炸掉）
    const setSql = keys.map((k) => '`' + k + '` = ?').join(', ');
    const res: any = await db.raw(
      `UPDATE \`${portalDb}\`.t_sys_account SET ${setSql}, update_time = NOW()
        WHERE account = ? AND is_deleted = 0`,
      [...keys.map((k) => patch[k]), acc],
    );
    const n = Number(res?.[0]?.affectedRows ?? 0);
    if (!n) console.warn(`[perm] 门户账号表里没有可更新的登录名「${acc}」（状态未同步）`);
    return n > 0;
  } catch (e: any) {
    console.warn(`[perm] 同步门户账号状态失败（account=${acc}）：${e?.message || e}`);
    return false;
  }
}

/**
 * ⭐ 2026-10-16 新增：查这个账号在【业务表】里还被谁引用
 *
 * 用途：账号删除规则 ——「有业务数据关联时不可删除 / 不可停用」。
 *
 * 【为什么跨库】业务表存的是【门户账号 id】（`sms_portal`.t_sys_account.id，UUID），
 *   权限库这边只有登录名 —— 所以先按登录名换出门户 id，再去业务表数引用。
 *
 * 【口径】只算【当前仍挂着】的引用（未删除的班级师资），**不含历史**（如交接记录的 from/to）——
 *   否则几乎谁都删不掉。以后哪个模块再把人挂到业务表上，往下面清单里加一行即可。
 *
 * @returns 中文描述数组，例如 ['大学部班级 2 个班级的师资']；无关联返回 []
 */
export async function accountBusinessRefs(account: string): Promise<string[]> {
  const refs: string[] = [];
  const acc = String(account || '').trim();
  if (!acc) return refs;
  const portalDb = process.env.DB_NAME_PORTAL || 'sms_portal';
  try {
    const r: any = await db.raw(
      `SELECT id FROM \`${portalDb}\`.t_sys_account WHERE account = ? AND is_deleted = 0 LIMIT 1`,
      [acc],
    );
    const row: any = Array.isArray(r?.[0]) ? r[0][0] : undefined;
    const uid = row?.id;
    if (!uid) return refs;

    /** 业务表里的人列清单：[库, 表, [列...], 中文说明] */
    const checks: Array<[string, string, string[], string]> = [
      [
        'sms_class',
        't_class_info',
        ['head_teacher_id', 'teacher_id', 'assistant_id', 'project_manager_id', 'employment_teacher_id'],
        '大学部班级',
      ],
      ['sms_class_jh', 't_class_info', ['head_teacher_id', 'teacher_id', 'assistant_id'], '初高班级'],
    ];

    for (const [d, t, cols, label] of checks) {
      const where = cols.map((c) => `\`${c}\` = ?`).join(' OR ');
      const res: any = await db.raw(
        `SELECT COUNT(*) AS n FROM \`${d}\`.\`${t}\` WHERE is_deleted = 0 AND (${where})`,
        cols.map(() => uid),
      );
      const n = Number((Array.isArray(res?.[0]) ? res[0][0] : undefined)?.n || 0);
      if (n > 0) refs.push(`${label} ${n} 个班级的师资`);
    }
  } catch (e: any) {
    console.warn(`[perm] 查账号业务关联失败（account=${acc}）：${e?.message || e}`);
  }
  return refs;
}

/** 账号档案（按登录名解析出来的权限全景） */
export interface AccountPermProfile {
  /** 是否在权限库中找到该账号 */
  found: boolean;
  /** 权限库里的用户 id（如 U013）；未找到时为空串 */
  permUserId: string;
  /** 登录名 */
  account: string;
  /** 姓名（权限库口径，未找到时为空串） */
  userName: string;
  /** 部门 id（如 D_FIN） */
  deptId: string;
  /** 部门中文名 */
  deptName: string;
  /** 用户状态：正常 / 已停用 / 已锁定 */
  userStatus: string;
  /** 职位编码数组（如 ['FIN_STAFF']） */
  roles: string[];
  /** 职位中文名数组（如 ['财务']） */
  roleNames: string[];
  /** 有效权限点，形如 ['fin:账单明细:查看'] */
  permissions: string[];
  /** 数据范围：1 本人 / 2 本班 / 3 本部门 / 4 全部 */
  dataScope: DataScope;
  /**
   * ⭐ 权限库里的模块 key → 该账号在该模块下有权限的功能点名
   *    例：{ fin: ['账单明细','退费名单'], market: ['学生档案'] }
   *
   * ⚠️ 这是给各业务模块算「可见页面」用的原料。
   *    权限库的模块 key（market / teach / fin / perm…）与门户的模块 key
   *    （consult / finance / perm）是【两套编码】，映射关系见 MODULE_PERM_TO_PORTAL。
   */
  moduleItems: Record<string, string[]>;
}

/** 权限库模块 key → 门户模块 key（两套编码的桥） */
export const MODULE_PERM_TO_PORTAL: Record<string, string> = {
  market: 'consult', // 市场咨询 → 门户 consult（8001）
  fin: 'finance', // 财务管理 → 门户 finance（8005）
  perm: 'perm', // 权限管理 → 门户 perm（8006）
  // 以下模块本期未接入门户，先留映射位，便于后续扩展：
  teach: 'teach',
  train: 'train',
  job: 'job',
  acad: 'acad',
  approve: 'approve',
};

/**
 * 按登录名取「权限全景档案」
 *
 * ⚠️ 查不到账号时【不抛错】，而是返回 found:false 的空档案 ——
 *    调用方（登录流程 / 鉴权中间件）需要自己决定兜底策略，
 *    这里不替它做决定（与 perm.client.ts 的降级哲学一致）。
 *
 * @param account 登录名（如 liukj / admin）
 */
export async function getAccountPermProfile(account: string): Promise<AccountPermProfile> {
  const empty: AccountPermProfile = {
    found: false,
    permUserId: '',
    account,
    userName: '',
    deptId: '',
    deptName: '',
    userStatus: '',
    roles: [],
    roleNames: [],
    permissions: [],
    dataScope: DataScope.SELF,
    moduleItems: {},
  };

  if (!account) return empty;

  const row = await db('t_perm_user').where({ account, is_deleted: false }).first();
  if (!row) return empty;

  const dept = row.dept_id
    ? await db('t_perm_dept').where({ id: row.dept_id }).first()
    : null;

  const links = await db('t_perm_user_role').where({ user_id: row.id, is_deleted: false });
  const roleIds = links.map((l: any) => l.role_id);
  const roles = roleIds.length
    ? await db('t_perm_role').whereIn('id', roleIds).andWhere('is_deleted', false)
    : [];

  // ---- 权限点 + 数据范围（多职位并集去重）----
  const { permissions, dataScope } = await getUserEffectivePerms(row.id);

  // ---- ⭐ 按模块聚合功能点（供各业务模块算可见页面）----
  const rpRows: any[] = roleIds.length
    ? await db('t_perm_role_perm').whereIn('role_id', roleIds).andWhere('is_deleted', false)
    : [];
  const moduleItems: Record<string, string[]> = {};
  for (const rp of rpRows) {
    const list = moduleItems[rp.module_key] || (moduleItems[rp.module_key] = []);
    if (!list.includes(rp.item_name)) list.push(rp.item_name);
  }

  return {
    found: true,
    permUserId: row.id,
    account: row.account,
    userName: row.user_name,
    deptId: row.dept_id || '',
    deptName: dept?.dept_name || '—',
    userStatus: row.user_status,
    roles: roles.map((r: any) => r.role_code),
    roleNames: roles.map((r: any) => r.role_name),
    permissions,
    dataScope,
    moduleItems,
  };
}

/* ============================================================
 * 四、操作日志
 * ============================================================ */

export interface AddLogInput {
  operatorId?: string;
  operatorName?: string;
  operatorRole?: string;
  moduleName: string;
  actionType: string;
  targetObj?: string;
  beforeValue?: string;
  afterValue?: string;
  ip?: string;
  result?: LogResult | string;
}

/**
 * 职位编码 → 职位中文名
 *
 * ⚠️ 为什么需要这一步：
 *    req.user.roles 里装的是【职位编码】（SYS_ADMIN / MKT_CONSULT / TEACH_HEAD），
 *    而操作日志是给人看的，应该记中文职位名（系统管理员 / 咨询老师 / 班主任）。
 *    种子数据里预置的那 10 条日志用的就是中文名，如果写入时不转换，
 *    日志列表里就会出现「系统管理员 · SYS_ADMIN」这种中英混杂的行 —— 与原型不一致。
 *
 * 只对「形如职位编码」的片段查库（全大写字母/数字/下划线），
 * 已经是中文名的直接原样返回，不做无谓查询。
 */
async function toRoleNames(raw: string): Promise<string> {
  if (!raw) return '';
  const parts = raw
    .split('、')
    .map((s) => s.trim())
    .filter(Boolean);
  const codes = parts.filter((p) => /^[A-Z][A-Z0-9_]*$/.test(p));
  if (!codes.length) return raw;
  try {
    const rows = (await db('t_perm_role')
      .whereIn('role_code', codes)
      .where('is_deleted', false)
      .select('role_code', 'role_name')) as { role_code: string; role_name: string }[];
    const map = new Map(rows.map((r) => [r.role_code, r.role_name]));
    return parts.map((p) => map.get(p) || p).join('、');
  } catch {
    // 查库失败就记原值，不能因为"名字没转过来"把日志丢掉
    return raw;
  }
}

/**
 * 写一条操作日志
 * ⚠️ 权限变更、参数修改、账号启停必须留痕。
 *    日志写入失败不允许影响主流程，因此内部吞掉异常。
 */
export async function addLog(input: AddLogInput): Promise<void> {
  try {
    const now = new Date();
    await db('t_perm_log').insert({
      id: randomUUID(),
      log_time: now,
      operator_id: input.operatorId || 'system',
      operator_name: input.operatorName || '系统',
      operator_role: await toRoleNames(input.operatorRole || ''),
      module_name: input.moduleName,
      action_type: input.actionType,
      target_obj: input.targetObj || '',
      before_value: input.beforeValue || '—',
      after_value: input.afterValue || '',
      ip: input.ip || '',
      result: input.result || LogResult.SUCCESS,
      is_deleted: false,
      create_time: now,
      create_by: input.operatorId || 'system',
    });
  } catch (e) {
    console.error('[addLog] 写日志失败（不影响主流程）:', (e as Error).message);
  }
}

/** 从请求里取来源 IP */
export function clientIp(req: any): string {
  return (
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress?.replace('::ffff:', '') ||
    ''
  );
}

/* ============================================================
 * 五、部门口径
 * ============================================================ */

/** 部门总数口径：排除「全部门(校级)」与 3 个学段 */
export const MERGED_STAGE_IDS = ['D_TEACH_J', 'D_TEACH_G', 'D_TEACH_U'];

/** 部门总数 = 排除校级与学段后的长度 */
export async function countDeptTotal(): Promise<number> {
  const rows = await db('t_perm_dept')
    .where('is_deleted', false)
    .whereNot('id', 'D_ALL')
    .whereNotIn('id', MERGED_STAGE_IDS);
  return rows.length;
}

/** 学段数（教学部下设） */
export async function countStageTotal(): Promise<number> {
  const rows = await db('t_perm_dept')
    .where('is_deleted', false)
    .whereIn('id', MERGED_STAGE_IDS);
  return rows.length;
}

/**
 * 部门下账号数：包含子部门
 * （教学部计入初中部/高中部/大学部的账号）
 */
export async function countUsersOfDept(deptId: string): Promise<number> {
  const all = await db('t_perm_dept').where('is_deleted', false).select('id', 'parent_id');
  const ids = collectDescendants(all, deptId);
  const rows = await db('t_perm_user')
    .where('is_deleted', false)
    .whereIn('dept_id', ids)
    .count({ n: '*' });
  return Number(rows[0]?.n || 0);
}

/** 收集某部门及其全部后代部门 id */
export function collectDescendants(
  all: { id: string; parent_id: string | null }[],
  rootId: string,
): string[] {
  const ids = [rootId];
  let changed = true;
  while (changed) {
    changed = false;
    all.forEach((d) => {
      if (d.parent_id && ids.includes(d.parent_id) && !ids.includes(d.id)) {
        ids.push(d.id);
        changed = true;
      }
    });
  }
  return ids;
}

/* ============================================================
 * 六、通用小工具
 * ============================================================ */

/** 手机号脱敏 138****4567 */
export function maskPhone(phone: string): string {
  if (!phone || phone.length < 7) return phone || '';
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

/** 取姓名首字做头像占位 */
export function avatarText(name: string): string {
  if (!name) return '?';
  return name.trim().charAt(0);
}

/** 把 role 中文名数组拼成展示串 */
export function joinRoleNames(names: string[]): string {
  return names.filter(Boolean).join('、');
}

/** 清空指定表（用于规则重置等） */
export async function delAll(table: string): Promise<void> {
  await db(table).del();
}

/** 读取某组规则为 key→value 的原始字符串映射 */
export async function getRuleRaw(group: string): Promise<Record<string, string>> {
  const rows = await db('t_perm_rule')
    .where({ rule_group: group, is_deleted: false })
    .orderBy('rule_sort');
  const out: Record<string, string> = {};
  rows.forEach((r: any) => {
    out[r.rule_key] = r.rule_value;
  });
  return out;
}

/** 职位权限数回填 */
export async function refreshRolePermCount(roleId: string): Promise<number> {
  const n = await countRolePerms(roleId);
  await db('t_perm_role').where({ id: roleId }).update({ perm_count: n });
  return n;
}

/** 该职位关联的账号数（★ 2026-10-16：只数有效账号，防止孤儿关联把人数撑大） */
export async function countRoleUsers(roleId: string): Promise<number> {
  const rows = await db('t_perm_user_role as ur')
    .join('t_perm_user as u', function (this: any) {
      this.on('u.id', 'ur.user_id').andOn('u.is_deleted', 0);
    })
    .where({ 'ur.role_id': roleId, 'ur.is_deleted': false })
    .count({ n: '*' });
  return Number(rows[0]?.n || 0);
}

export type { PermLog };
