/**
 * ★ 2026-10-06 新增：按【统一门户账号】现查 sms_perm 角色码 → 咨询模块岗位角色
 *
 * ============================================================
 * 【为什么需要它】
 *   统一门户改造后，本模块自己的账号表 `t_consult_account` 只是「历史遗留的影子表」：
 *     · 门户登录签发的 token 里 roles 只有 SYS_ADMIN / SYS_STAFF（粗粒度）
 *     · 本模块判定「是经理还是咨询师」原来**只查 t_consult_account**
 *   2026-10-06 全量重建（seed:all）把业务库清空重建，这张表**没被重新播种** →
 *   全表为空 → 每个咨询请求都查不到行 → 岗位角色静默降级成「咨询师」，
 *   于是：
 *     · 「分配咨询老师」下拉查不到人（无数据）—— 用户 2026-10-06 截图反馈
 *     · 经理点「分配 / 审批」被 checkRole(MANAGER) 拦成 403
 *
 * 【口径（与班级模块 staffFromAccounts 完全一致）】
 *   「谁是咨询经理 / 咨询师」= 他的角色里有 MKT_MANAGER / MKT_CONSULT，
 *   唯一事实来源是 sms_portal.t_sys_account × sms_perm.t_perm_user × t_perm_role。
 *   本模块的 t_consult_account 只作**最后兜底**（老数据 / 老 token 兼容）。
 *
 * ⚠️ 本连接绑在 sms_consult 上，靠**跨库限定名**读 portal / perm（项目里既有写法）。
 * ⚠️ 本文件不依赖 middleware/auth，避免与 auth.ts 形成循环引用。
 */

import { ConsultRole } from 'shared-types/consult';
import { db } from '../utils/db';

/** 统一角色编码 → 咨询模块岗位角色 */
export const PERM_ROLE_TO_CONSULT: Record<string, ConsultRole> = {
  SYS_ADMIN: ConsultRole.ADMIN,
  // ★ 校长在咨询模块按「经理」口径（能看审批中心 / 能分配），与「校长=全权」一致
  RM_PRINCIPAL: ConsultRole.MANAGER,
  MKT_MANAGER: ConsultRole.MANAGER,
  MKT_CONSULT: ConsultRole.CONSULT,
};

/** 咨询模块认的「咨询岗位」角色码（下拉候选 / 角色推定的来源） */
export const CONSULT_STAFF_ROLE_CODES = ['MKT_MANAGER', 'MKT_CONSULT'];

/** 角色优先级：数字越小越优先（经理 > 咨询师 > 其它） */
const ROLE_PRIORITY: Record<string, number> = {
  SYS_ADMIN: 0,
  RM_PRINCIPAL: 1,
  MKT_MANAGER: 2,
  MKT_CONSULT: 3,
};

function permDb(): string {
  return process.env.DB_NAME_PERM || 'sms_perm';
}

function portalDb(): string {
  return process.env.DB_NAME_PORTAL || 'sms_portal';
}

/** 按门户账号取统一角色码（查不到 / 出错 → 空数组，绝不抛） */
export async function permRoleCodesOf(account: string): Promise<string[]> {
  if (!account) return [];
  try {
    const [rows] = (await db.raw(
      `SELECT r.role_code AS roleCode
         FROM \`${permDb()}\`.t_perm_user u
         JOIN \`${permDb()}\`.t_perm_user_role ur ON ur.user_id = u.id AND ur.is_deleted = 0
         JOIN \`${permDb()}\`.t_perm_role r ON r.id = ur.role_id AND r.is_deleted = 0
        WHERE u.account = ? AND u.is_deleted = 0`,
      [account],
    )) as unknown as [Array<{ roleCode: string }>, unknown];
    return rows.map((r) => String(r.roleCode));
  } catch {
    return [];
  }
}

/**
 * 按门户账号推定咨询模块岗位角色
 *
 * @returns null = 权限库里也认不出来（调用方自行决定兜底）
 */
export async function resolveConsultRoleFromPerm(account: string): Promise<ConsultRole | null> {
  const codes = await permRoleCodesOf(account);
  if (!codes.length) return null;
  const hit = codes
    .filter((c) => PERM_ROLE_TO_CONSULT[c])
    .sort((a, b) => (ROLE_PRIORITY[a] ?? 99) - (ROLE_PRIORITY[b] ?? 99))[0];
  return hit ? PERM_ROLE_TO_CONSULT[hit] : null;
}

/** 按门户账号取「姓名 + 岗位标题」（下拉展示用；查不到返回 null） */
export async function portalAccountOf(
  account: string,
): Promise<{ id: string; userName: string; title: string } | null> {
  if (!account) return null;
  try {
    const [rows] = (await db.raw(
      `SELECT id, user_name AS userName, title
         FROM \`${portalDb()}\`.t_sys_account
        WHERE account = ? AND is_deleted = 0 AND active = 1
        LIMIT 1`,
      [account],
    )) as unknown as [Array<{ id: string; userName: string; title: string }>, unknown];
    const r = rows[0];
    return r ? { id: String(r.id), userName: String(r.userName || ''), title: String(r.title || '') } : null;
  } catch {
    return null;
  }
}

/** 咨询经理 + 咨询师候选（门户账号 × sms_perm 角色） */
export async function consultantsFromAccounts(): Promise<
  Array<{ id: string; account: string; userName: string; title: string; role: ConsultRole }>
> {
  const wanted = CONSULT_STAFF_ROLE_CODES;
  try {
    const [rows] = (await db.raw(
      `SELECT a.id            AS id,
              a.account       AS account,
              a.user_name     AS userName,
              a.title         AS title,
              r.role_code     AS roleCode
         FROM \`${portalDb()}\`.t_sys_account a
         JOIN \`${permDb()}\`.t_perm_user u
           ON u.account = a.account AND u.is_deleted = 0
         JOIN \`${permDb()}\`.t_perm_user_role ur
           ON ur.user_id = u.id AND ur.is_deleted = 0
         JOIN \`${permDb()}\`.t_perm_role r
           ON r.id = ur.role_id AND r.is_deleted = 0
        WHERE a.is_deleted = 0
          AND a.active = 1
          AND r.role_code IN (?, ?)
        ORDER BY a.id`,
      wanted,
    )) as unknown as [Array<Record<string, unknown>>, unknown];

    const map = new Map<
      string,
      { id: string; account: string; userName: string; title: string; role: ConsultRole }
    >();
    for (const r of rows) {
      const id = String(r.id ?? '');
      if (!id) continue;
      const role = PERM_ROLE_TO_CONSULT[String(r.roleCode)];
      if (!role) continue;
      const hit = map.get(id);
      // 同一人既是经理又是咨询师时，取优先级高的（经理）
      if (!hit || role === ConsultRole.MANAGER) {
        map.set(id, {
          id,
          account: String(r.account ?? ''),
          userName: String(r.userName ?? ''),
          title: String(r.title ?? ''),
          role,
        });
      }
    }
    return Array.from(map.values());
  } catch {
    return [];
  }
}
