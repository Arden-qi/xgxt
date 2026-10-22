/**
 * 「我的班」解析（班主任 / 教员 / 助教）
 * ============================================================
 *
 * 宿舍是合并页，同一件事有三种存法，且**要跨学段查**：
 *   ① 班级表 `head_teacher_id` = 权限库业务 id（U008…），演示库还出现过 '123456' 这种脏值；
 *   ② 门户学生表 `head_teacher_id` = **门户账号 UUID**（token 里的 userId）；
 *   ③ 有的环境只填了 `head_teacher_name = '孙敏'`。
 * 只认一种 → 班主任的班一个都查不到（宿舍页恒空、候选人空、班级下拉是别人家的班）。
 *
 * ⚠️ 大学部班主任可能带初高班（张海涛带 Q30），所以班级表 / 学生表都遍历三学段。
 */

import { db } from '../../utils/db';
import { hasRole, RoleCode } from 'shared-types';

const CLASS_SOURCES = [
  'sms_class_jh.t_class_info',
  'sms_class.t_class_info',
  'sms_job.t_job_class',
];

const STUDENT_SOURCES = [
  'sms_class_jh.t_class_student',
  'sms_class.t_class_student',
  'sms_job.t_student_base',
  'sms_edu.t_student_base',
  'sms_perm.t_student_base',
];

const PRIVILEGED_ROLES = [
  RoleCode.RM_PRINCIPAL,
  RoleCode.ACAD_STAFF,
  RoleCode.TEACH_DEAN,
  RoleCode.SYS_ADMIN,
];

export interface MyClassInfo {
  /** 校长/教务/学管/管理员 → 不限制 */
  privileged: boolean;
  /** 我带的班级名 */
  names: string[];
  /** 我带的班级 id（有的表只有 id） */
  ids: string[];
}

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/**
 * 解析当前账号「名下的班级」。
 *
 * 判定口径：head_teacher / teacher / assistant 任一命中即算（业务 id、门户 UUID、姓名都试）。
 */
export async function resolveMyClasses(user: any): Promise<MyClassInfo> {
  const roles: string[] = user?.roles ?? [];
  if (PRIVILEGED_ROLES.some((r) => hasRole(roles, r))) {
    return { privileged: true, names: [], ids: [] };
  }

  const portalUid = String(user?.businessUserId || user?.userId || user?.id || '');
  const userName = String(user?.userName || user?.name || '').trim();

  // 权限库业务 id（U008）：token 没带就按账号查一次
  let permUid = String(user?.businessUserId || '');
  if (!permUid && user?.account) {
    try {
      const u = (await db('sms_perm.t_perm_user').where({ account: String(user.account) }).first()) as any;
      permUid = u?.id ? String(u.id) : '';
    } catch {
      permUid = '';
    }
  }

  const names = new Set<string>();
  const ids = new Set<string>();
  const collect = (rows: any[]) => {
    for (const r of rows) {
      const cn = str(r.class_name);
      if (!cn) continue;
      names.add(cn);
      if (r.id) ids.add(String(r.id));
    }
  };

  const matchOwner = (b: any, id: string) => {
    if (id) {
      b.where('head_teacher_id', id)
        .orWhere('teacher_id', id)
        .orWhere('assistant_id', id);
    }
    if (userName) {
      b.orWhere('head_teacher_name', userName)
        .orWhere('teacher_name', userName)
        .orWhere('assistant_name', userName);
    }
  };

  // ① 三学段班级表
  for (const table of CLASS_SOURCES) {
    try {
      const rows = (await db(table)
        .where({ is_deleted: false })
        .andWhere((b: any) => matchOwner(b, permUid))
        .select('id', 'class_name')) as any[];
      collect(rows);
    } catch {
      /* 表/列不存在 → 跳过 */
    }
  }

  // ② 学生表（门户 + 三学段）：有的环境班级表没维护班主任，学生表里有
  for (const table of STUDENT_SOURCES) {
    try {
      const rows = (await db(table)
        .where({ is_deleted: false })
        .whereNotNull('class_name')
        .andWhere((b: any) => matchOwner(b, portalUid || permUid))
        .distinct('class_name')) as any[];
      collect(rows);
    } catch {
      /* 跳过 */
    }
  }

  return { privileged: false, names: [...names], ids: [...ids] };
}
