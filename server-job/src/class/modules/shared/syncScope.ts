import { Knex } from 'knex';
import { DataScope } from 'shared-types/class';
import { db } from '../../db';
import { AuthUser, isFullAccess } from '../../lib/authUser';
import { notDeleted } from '../../lib/repo';
// ★ 第 4 期第 8 批：补切读层（本文件是「催费/缴费/宿舍」三域共用的公共件）
//   原来 `deptClassIds()` / `myStudentIds()` 写死 `db('t_class_info')` /
//   `db('t_class_student')` → 切读后班级/学生 id 口径不一致，
//   同步副本表按班级 id 过滤就会一条都匹配不上（**静默查空**，不报错）。
//   也正因为它是公共件，扫 `modules/urge|fee|dorm` 目录时天然扫不到。
import { tbl } from '../../../teaching/shared/uniTable';

const SRC = 'sms_class';
const STAGE = 'class' as const;

/**
 * 同步副本表的「数据范围」过滤
 *
 * 背景：催费 / 缴费 / 宿舍住宿这些都是**从别的模块同步来的只读副本**，
 *      它们**没有 dept_code 列**，也未必有 head_teacher_id 列，
 *      所以不能直接套用 middleware/dataScope.ts 的通用过滤（会 where 到不存在的列）。
 *
 * 这里的做法：
 *  - 学管 / 校长 / 管理员        → 不限制
 *  - 本班级（班主任 / 教员 / 助教）→ 按 class_id ∈ 自己负责的班级
 *  - 本部门（教务 / 财务）        → 按 class_id ∈ 本部门的班级
 *  - 本人（招生 / 咨询）          → 按 student_id ∈ 自己招入 / 咨询的学生
 *  - 匹配不到任何范围时          → `1 = 0`（宁可查空，也不放过）
 */
export interface SyncScopeOptions {
  /** 班级列名，默认 class_id */
  classColumn?: string;
  /** 学生列名，默认 student_id */
  studentColumn?: string;
}

const NONE = '__none__';

/** 本部门的班级 ID 列表 */
export async function deptClassIds(deptCode: number): Promise<string[]> {
  const rows = (await notDeleted(tbl(db, SRC, 't_class_info', STAGE))
    .where('dept_code', deptCode)
    .select('id')) as Array<{
    id: string;
  }>;
  return rows.map((r) => r.id);
}

/** 招生 / 咨询老师名下的学生 ID */
export async function myStudentIds(userId: string): Promise<string[]> {
  const rows = (await notDeleted(tbl(db, SRC, 't_class_student', STAGE))
    .where(function (this: Knex.QueryBuilder) {
      this.where('recruit_teacher_id', userId).orWhere('consult_teacher_id', userId);
    })
    .select('id')) as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

/** 把一个「只读副本」查询按登录人的数据范围收窄 */
export async function applySyncScope<T extends Knex.QueryBuilder>(
  qb: T,
  user: AuthUser | undefined,
  opts: SyncScopeOptions = {},
): Promise<T> {
  if (!user) return qb;
  if (isFullAccess(user)) return qb;

  const classCol = opts.classColumn ?? 'class_id';
  const stuCol = opts.studentColumn ?? 'student_id';

  switch (user.dataScope) {
    case DataScope.ALL:
      return qb;

    case DataScope.CLASS:
      return qb.whereIn(classCol, user.classIds.length ? user.classIds : [NONE]) as T;

    case DataScope.DEPT: {
      const ids = await deptClassIds(user.deptCode);
      return qb.whereIn(classCol, ids.length ? ids : [NONE]) as T;
    }

    case DataScope.SELF:
    default: {
      const ids = await myStudentIds(user.userId);
      return qb.whereIn(stuCol, ids.length ? ids : [NONE]) as T;
    }
  }
}
