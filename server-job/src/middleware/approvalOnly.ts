import { NextFunction, Request, Response } from 'express';
import { BizCode, RoleCode } from 'shared-types';

/**
 * 「只读 + 仅审批可写」总闸 —— 学管主任专用
 *
 * ============================================================
 * 【业务口径】（2026-10-06 明确）
 * ============================================================
 *   学管主任（`TEACH_DEAN`，演示账号 `congym`）是**审批角色**：
 *   在整条业务链里他只做一件事 —— 审。
 *
 *     · 退费：  班主任发起 → **学管审批** → 校长审批 → 财务
 *     · 休学：  班主任发起 → **学管审批**
 *     · 退学：  班主任发起 → **学管审批** → 校长审批
 *     · 复学：  班主任发起 → **学管审批**
 *     · 升实训：班主任发起 → **学管接收**
 *     · 待接收学员：咨询推送 → **学管接收 / 驳回**
 *
 *   除此之外的一切内容他都**只能查看**：建班、改班、交接、推进阶段、
 *   录出勤、录成绩、建考试、建宿舍、花名册加减人、发退费/休学…
 *   全都不能操作。
 *
 * ============================================================
 * 【为什么需要一个"总闸"而不是逐个改接口】
 * ============================================================
 *   学管的写权限来自**三条互相独立的通道**，任何一条漏掉都会越权：
 *     ① 大学部班级模块 `class/lib/authUser.ts` 的 `FULL_ACCESS_ROLES`
 *        —— 而 `shared-types/class` 把 `QUALITY_MGR / ACADEMIC_MGR`
 *           的**值**直接定义成 `'TEACH_DEAN'`，于是学管=全权。
 *     ② 初高模块 `class-jh/middleware/auth.ts` 的 `POLICIES`
 *        —— `[QUALITY_MGR]: { allow: [/./] }` 全放行。
 *     ③ job 模块多处**硬编码角色数组**（`CLASS_DELETE_ROLES` 等）含 TEACH_DEAN。
 *   再叠加「几十个写接口压根没挂任何守卫」，逐个补挂必然漏。
 *
 *   所以这里做**一道按路径生效的总闸**：管你后端内部怎么判，
 *   学管的写请求先在这里被拦一次（审批动作放行）。各模块的白名单仍然
 *   按原样收窄（见 permGuard / POLICIES），两道一起才是稳的。
 *
 * ============================================================
 * 【放行规则】
 * ============================================================
 *   1. 只读方法（GET / HEAD / OPTIONS）→ 放行
 *   2. 审批动作（路径以 approve / reject / receive / refuse 结尾）→ 放行
 *   3. 其余非只读请求 → 403
 *
 *   ⚠️ 故意**不**放行 `withdraw`（撤回）与 `cancel`（撤销）——
 *      这两个是**申请人**的动作，学管不是申请人，本就不该点。
 *   ⚠️ 与系统管理员只读闸（app.ts 里 `roles.every(r => r === SYS_ADMIN)`）
 *      的区别：管理员是「角色里**只有**管理员才只读」，
 *      学管是「**含**学管主任即只读」——
 *      因为演示库里 `congym` 同时挂了 `TEACH_QTY + TEACH_DEAN`，
 *      两个都是"学管"这一脉，都该只读。
 */

/** 判定为"学管主任"的角色码（教质经理 `TEACH_QTY` 是同职能的历史码） */
export const APPROVAL_ONLY_ROLES: string[] = [RoleCode.TEACH_DEAN, 'TEACH_QTY'];

/** 审批动作的路径特征：`/approve` `/reject` `/receive` `/refuse` 结尾 */
const APPROVAL_ACTION_RE = /\/(approve|reject|receive|refuse)(\/)?$/i;

/** 当前请求是不是"审批动作" */
export function isApprovalAction(path: string): boolean {
  return APPROVAL_ACTION_RE.test(path);
}

/** 学管主任的写请求拦截中间件（挂在鉴权之后、业务路由之前） */
export function denyApprovalOnlyWrite(req: Request, res: Response, next: NextFunction): void {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    next();
    return;
  }

  const roles: string[] = req.user?.roles || [];
  const isApprovalOnly = roles.some((r) => APPROVAL_ONLY_ROLES.includes(r));
  if (!isApprovalOnly) {
    next();
    return;
  }

  // 审批动作放行（同意 / 驳回 / 接收）
  if (isApprovalAction(req.path)) {
    next();
    return;
  }

  // 已登录但无操作权 → 403（不是 401！401 会让前端跳登录页）
  res.status(403).json({
    code: BizCode.NO_OPERATION_PERMISSION,
    message: '学管主任为审批角色：只能查看数据、执行审批，不能新增/修改/删除',
    data: null,
  });
}
