import { Knex } from 'knex';
import { DataScope } from 'shared-types/class';
import { Errors } from '../http/response';
import { AuthUser, isFullAccess } from '../lib/authUser';

/**
 * 数据权限（数据范围）过滤
 *
 * 依据需求：
 *  - 老师（班主任 / 教员 / 助教）只能查看和管理自己负责班级的信息 → DataScope.CLASS
 *  - 招生 / 咨询老师只看自己招的学生                          → DataScope.SELF
 *  - 学管（教质/学术经理）和校长拥有全部权限                    → DataScope.ALL
 *
 * ⚠️ 所有列表 / 详情查询都必须过这一层，忘记加就是数据越权。
 */

export interface ScopeOptions {
  /** 班级 ID 列名，默认 class_id */
  classIdColumn?: string;
  /** 部门编码列名，默认 dept_code（本班级范围时也允许按部门兜底） */
  deptColumn?: string;
  /** DataScope.SELF 时用于匹配「本人」的列名数组，如 ['recruit_teacher_id','consult_teacher_id'] */
  ownerColumns?: string[];
}

/** 把数据范围条件挂到查询构造器上；返回同一个 qb 便于链式调用 */
export function applyDataScope<T extends Knex.QueryBuilder>(
  qb: T,
  user: AuthUser | undefined,
  opts: ScopeOptions = {},
): T {
  if (!user) throw Errors.unauthorized();
  if (isFullAccess(user)) return qb;

  const classCol = opts.classIdColumn || 'class_id';
  const deptCol = opts.deptColumn || 'dept_code';

  switch (user.dataScope) {
    case DataScope.ALL:
      return qb;

    case DataScope.DEPT:
      return qb.where(deptCol, user.deptCode) as T;

    case DataScope.CLASS: {
      if (!user.classIds.length) {
        throw Errors.noOperationPermission('您还没有负责的班级，请联系学管分配班级');
      }
      return qb.whereIn(classCol, user.classIds) as T;
    }

    case DataScope.SELF:
    default: {
      const cols = opts.ownerColumns;
      if (!cols || !cols.length) {
        // 没有可判定的「本人」列 → 保守拒绝，绝不放过
        throw Errors.noOperationPermission('当前账号没有查看该数据的权限，请联系学管');
      }
      /* ★ 2026-10-23：责任人列历史上有 UUID / U号 两种写法，两个都比 */
      const me = [...new Set([user.userId, user.businessUserId, (user as any).portalUserId]
        .map((x) => String(x || '')).filter(Boolean))];
      return qb.where(function (this: Knex.QueryBuilder) {
        for (const c of cols) this.whereIn(c, me);
      }) as T;
    }
  }
}

/** 判断当前用户能否操作指定班级 */
export function canAccessClass(user: AuthUser | undefined, classId: string | undefined | null): boolean {
  if (!user) return false;
  if (isFullAccess(user)) return true;
  if (!classId) return false;
  if (user.dataScope === DataScope.CLASS) return user.classIds.includes(classId);
  if (user.dataScope === DataScope.ALL) return true;
  // 本人 / 本部门范围无法仅凭 classId 判定 → 交由具体业务再校验
  return user.dataScope === DataScope.DEPT;
}

/** 断言能操作指定班级，否则抛 403 */
export function assertClassAccess(user: AuthUser | undefined, classId: string | undefined | null, what = '该班级'): void {
  if (!canAccessClass(user, classId)) {
    throw Errors.noOperationPermission(`您无权管理${what}的信息`);
  }
}
