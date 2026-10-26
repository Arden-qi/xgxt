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

/* ★ 2026-10-22 修：sms_job / sms_class_jh / sms_class 的这些老表在 P8 归一后已 DROP，
   裸查会报「数据表不存在」或被 try/catch 静默吞掉（表现为该学段查不到数据）。
   全部改指 sms_common 统一表：班级=t_uni_class、学生=t_uni_student（列名同名兼容）。 */

const CLASS_SOURCES = [
  'sms_common.t_uni_class',
];

const STUDENT_SOURCES = [
  // ★ jh/class/job 三份学生投影在 P8 后已物理合并为 t_uni_student 的一行
  'sms_common.t_uni_student',
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
        .andWhere((b: any) => {
          // ★ 合并到统一表后，owner id 有两种口径（门户 UUID / 权限库 id），都要试
          matchOwner(b, portalUid);
          if (permUid && permUid !== portalUid) matchOwner(b, permUid);
        })
        .distinct('class_name')) as any[];
      collect(rows);
    } catch {
      /* 跳过 */
    }
  }

  return { privileged: false, names: [...names], ids: [...ids] };
}

/**
 * ★ 2026-10-25：「教务分配给班主任的楼栋」。
 *
 * 用户口径：班主任登录后，宿舍页的**楼栋下拉**只应出现教务分派给本班的楼栋，
 * 而不是全部楼栋（原来下拉是全量，班主任能看到别人班/女寝的楼）。
 *
 * 判定：
 *   · 校长 / 教务 / 学管 / 管理员（privileged）→ 返回 null（不限制，仍看全部）；
 *   · 班主任 → 按 `sms_edu.t_edu_dorm_assignment` 里**本班**分派到的房间，
 *     反查房间的 building 去重；
 *   · 本班尚无分派记录时，回退到「本班在读学生已入住的楼栋」——
 *     否则下拉会完全空白，连自己学生住的楼都筛不到。
 *
 * 返回：null = 不限制；[] = 确实没有任何可分派的楼栋。
 */
export async function scopedBuildingNames(user?: any): Promise<string[] | null> {
  if (!user) return null;
  const mine = await resolveMyClasses(user);
  if (mine.privileged) return null;

  const ASSIGN = 'sms_edu.t_edu_dorm_assignment';
  const ROOM = 'sms_common.t_uni_dorm_room';
  const STUDENT = 'sms_common.t_uni_student';
  const names = new Set<string>();

  /* ① 本班分派到的房间 → 楼栋 */
  if (mine.names.length) {
    try {
      const assigned = (await db(ASSIGN)
        .whereIn('class_name', mine.names)
        .where({ is_deleted: false })
        .distinct('room_id')) as any[];
      const roomIds = assigned.map((a) => str(a.room_id)).filter(Boolean);
      if (roomIds.length) {
        const rooms = (await db(ROOM)
          .whereIn('id', roomIds)
          .where({ is_deleted: false })
          .distinct('building')) as any[];
        for (const r of rooms) if (str(r.building)) names.add(str(r.building));
      }
    } catch {
      /* 分派表不可用 → 走下面的兜底 */
    }
  }

  /* ② 兜底：本班在读学生已入住的楼栋 */
  if (!names.size) {
    try {
      const rows = (await db(STUDENT)
        .where({ is_deleted: false })
        .whereIn('student_status', [3, 5, 8])
        .whereNotNull('dorm_id')
        .andWhere('dorm_id', '<>', '')
        .andWhere((w: any) => {
          if (mine.ids.length) w.orWhereIn('class_id', mine.ids);
          if (mine.names.length) w.orWhereIn('class_name', mine.names);
        })
        .distinct('dorm_id')) as any[];
      const ids = rows.map((r) => str(r.dorm_id)).filter(Boolean);
      if (ids.length) {
        const rooms = (await db(ROOM)
          .whereIn('id', ids)
          .where({ is_deleted: false })
          .distinct('building')) as any[];
        for (const r of rooms) if (str(r.building)) names.add(str(r.building));
      }
    } catch {
      /* 查询失败 → 返回空集合（宁可少给，不给越权数据） */
    }
  }

  return [...names];
}
