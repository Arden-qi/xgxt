/**
 * 「当前操作人」的 ID 取法（★ 2026-10-23 ID 统一改造）
 * ============================================================
 *
 * 【背景】
 *   系统里"人"有两套 ID：
 *     · 门户账号 UUID（t_sys_account.id，登录时进 token）
 *     · 权限库用户号（t_perm_user.id，如 U004 / U_chenxf）—— **唯一标准**
 *   业务表的责任人列（班主任/申请人/审批人/操作人…）历史上两种都写过，
 *   于是「我是谁」在代码里有两种答案，谁用错了就静默查空。
 *
 * 【口径】
 *   · 写库一律用 `actorId()`（= 权限库 U 号）
 *   · 读库/比对过渡期用 `actorIds()`（U 号 + 旧 UUID 都算"我"），
 *     等历史数据清洗完（npm run id:unify:apply）就可以只留 actorId
 */

/** 写库用：权限库用户号优先，退回门户账号 id（查不到映射时保持兼容） */
export function actorId(user: any): string {
  return String(user?.businessUserId || user?.userId || '');
}

/** 读库比对用：所有可能代表"我"的 id（去重、去空） */
export function actorIds(user: any): string[] {
  return [
    ...new Set([user?.businessUserId, user?.userId, user?.portalUserId]
      .map((x) => String(x || ''))
      .filter(Boolean)),
  ];
}

/** 某个值是否代表"我" */
export function isActor(user: any, value: unknown): boolean {
  const v = String(value ?? '');
  return !!v && actorIds(user).includes(v);
}
