import { Knex } from 'knex';
import { ApplyType, NotifyType, RoleCode } from 'shared-types/class';
import { baseInsert } from '../../lib/repo';
import { AuthUser } from '../../lib/authUser';
import { usersByRoles } from '../../lib/upstream';
import { ApplyTypeName, NotifyTypeName } from '../../lib/dict';
import { tblInsTrx } from '../../../teaching/shared/uniTable';

/**
 * 审批流转公共件：留痕 + 站内通知
 *
 * 依据需求（审批与通知要求）：
 *  - 休学：班主任申请 → 学管审批 → 通过/驳回都通知班主任
 *  - 退学：班主任申请 → 学管初审 → 校长审批 → 通过/驳回都通知班主任与学管
 *  - 退费：五级链，每个节点通知「下一节点处理人」，驳回通知申请人
 *
 * ⚠️ 所有写操作都必须在事务里调用，保证「业务状态 + 日志 + 通知」三者一致。
 *
 * ★ 第 4 期第 2 批：本文件原有 2 处裸访问（`db('t_class_approval_log')` /
 *   `db('t_class_notify')`），已改走 `tblInsTrx()`。
 *   这两处**特别容易被漏掉** —— 本文件是三个审批路由共用的公共件，
 *   藏在 `shared/` 下，只扫 `approval/` 目录扫不到；
 *   而它写的表被删后症状是「提交申请整个事务回滚」，看起来像审批逻辑坏了。
 */
export type Tx = Knex | Knex.Transaction;

/** 本公共件只服务大学老审批链 */
const SRC = 'sms_class';
const STAGE = 'class' as const;

/** 写审批日志（所有审批动作都留痕，供追溯） */
export async function logApproval(
  db: Tx,
  p: {
    applyType: ApplyType;
    applyNo: string;
    bizId: string;
    action: 'submit' | 'approve' | 'reject' | 'withdraw' | 'receive' | 'sync';
    fromStatus: number;
    toStatus: number;
    user?: AuthUser;
    opinion?: string;
  },
): Promise<void> {
  await tblInsTrx(db, SRC, 't_class_approval_log', STAGE, {
    ...baseInsert(p.user),
    apply_type: p.applyType,
    apply_no: p.applyNo,
    biz_id: p.bizId,
    action: p.action,
    from_status: p.fromStatus,
    to_status: p.toStatus,
    operator_id: p.user?.userId ?? 'system',
    operator_name: p.user?.userName ?? '系统',
    operator_role: (p.user?.roles ?? []).join(','),
    opinion: p.opinion ?? null,
    operate_time: new Date().toISOString().slice(0, 19).replace('T', ' '),
  } as never);
}

export interface NotifyInput {
  notifyType: NotifyType;
  applyType?: ApplyType;
  bizId?: string;
  applyNo?: string;
  title: string;
  content: string;
  linkPath?: string;
}

/** 给指定用户发一条站内通知 */
export async function sendNotify(
  db: Tx,
  input: NotifyInput,
  receiver: { userId: string; userName?: string },
): Promise<void> {
  if (!receiver.userId) return;
  await tblInsTrx(db, SRC, 't_class_notify', STAGE, {
    ...baseInsert(),
    notify_type: input.notifyType,
    apply_type: input.applyType ?? null,
    biz_id: input.bizId ?? null,
    apply_no: input.applyNo ?? null,
    title: input.title,
    content: input.content,
    receiver_id: receiver.userId,
    receiver_name: receiver.userName ?? null,
    is_read: 0,
    read_time: null,
    link_path: input.linkPath ?? null,
  } as never);
}

/**
 * 给某个角色的所有人发通知（如「通知学管」「通知校长」）
 * 用户来自登录模块 8001 的 internal 接口；拿不到就跳过，绝不因为通知失败而回滚业务。
 */
export async function sendNotifyByRole(
  db: Tx,
  input: NotifyInput,
  roleCodes: string[],
): Promise<number> {
  try {
    const users = await usersByRoles(roleCodes);
    for (const u of users) {
      await sendNotify(db, input, { userId: u.userId, userName: u.userName });
    }
    return users.length;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[notify] 按角色 ${roleCodes.join('/')} 发通知失败：${(e as Error).message}`);
    return 0;
  }
}

/** 学管角色（教质经理 + 学术经理），需求里「学管」即这两个角色的合称 */
export const STUDY_MANAGER_ROLES: string[] = [RoleCode.QUALITY_MGR, RoleCode.ACADEMIC_MGR];

/** 校长角色 */
export const PRINCIPAL_ROLES: string[] = [RoleCode.PRINCIPAL];

/** 审批结论标题文案 */
export function notifyTitle(t: NotifyType, applyTypeName: string, studentName: string, extra?: string): string {
  const base = `${applyTypeName}申请`;
  if (t === NotifyType.APPROVED) return `${base}已通过：${studentName}${extra ? `（${extra}）` : ''}`;
  if (t === NotifyType.REJECTED) return `${base}被驳回：${studentName}${extra ? `（${extra}）` : ''}`;
  return `您有新的${base}待审批：${studentName}`;
}

/** 通知类型中文（日志/调试用） */
export function notifyTypeNameOf(t: NotifyType): string {
  return NotifyTypeName[t] ?? '';
}
