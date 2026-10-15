/**
 * 学籍异动仓储 · 大学部（sms_class）· 表 `t_class_suspend_apply`
 * ============================================================
 *
 * 【与实训（蓝本）的差异 —— 实测】
 *   · **没有「复学」**：`ApplyType` 只有 1休学 2退学 3退费 4升学
 *     → 本仓储只处理 1/2（页面也会据此隐藏"复学"选项，而不是给个点不动的按钮）
 *   · 状态字段 `apply_status` 用大学自己的 `SuspendStatus`：
 *     1待提交 2待经理 3待校长 4已同意 5已驳回 —— **与统一码一一对应（恒等）**
 *     撤回原来是**软删单据**（`is_deleted=1`），本次补了 `WITHDRAWN=6` 改为记状态
 *   · 审批人**分字段存**（`manager_approver_*` / `principal_approver_*`）—— 统一后
 *     审批轨迹以 `t_job_approval` 为准，这两组列保留兼容老代码
 *   · 有 `apply_no` 申请单号（初高/实训没有）→ 需生成
 *
 * ⚠️ 写操作的 `conn` 是 **job 库的事务** → 表名用全限定名。
 */

import { randomUUID } from 'crypto';
import { StudentStatus } from 'shared-types';
import { db } from '../../class/db';
import type { LeaveListQuery, LeaveRow } from '../shared/dto';
import { LEAVE_BIZ_TYPE_NAME, LEAVE_STATUS_NAME } from '../shared/dto';
import {
  toRawLeaveBiz,
  toRawLeaveStatus,
  toUnifiedLeaveBiz,
  toUnifiedLeaveStatus,
} from '../shared/conf';
import { fmtDate, fmtDateTime, todayStr } from '../shared/format';
import type { LeaveAggregate, LeaveWriteInput, StudentOption, StudentSnapshot } from './types';
import { tbl, tblTrx, tblInsTrx } from '../shared/uniTable';
import { buildApplyNo } from '../shared/conf';

const T = 't_class_suspend_apply';
const S = 't_class_student';
const STAGE = 'class' as const;
/** ★ 老表所在库（切读路由层 tbl() 的第一个参数） */
const SRC = 'sms_class';

/** ★ 全限定表名（conn 来自 job 库事务） */
const WT = 'sms_class.t_class_suspend_apply';
const WS = 'sms_class.t_class_student';

/** ★ 大学只有 休学(1) / 退学(2) */
const IN_SCOPE = [1, 2];

async function decorate(row: Record<string, any>): Promise<LeaveRow> {
  const biz = (await toUnifiedLeaveBiz(STAGE, row.apply_type)) ?? 0;
  const st = (await toUnifiedLeaveStatus(STAGE, row.apply_status)) ?? 0;

  return {
    stage: STAGE,
    stageName: '大学',
    id: String(row.id),
    bizType: biz,
    bizTypeName: LEAVE_BIZ_TYPE_NAME[biz] || '',
    studentId: String(row.student_id || ''),
    studentNo: String(row.student_no || ''),
    studentName: String(row.student_name || ''),
    gender: null,
    idCard: row.id_card || null,
    phone: null,
    parentPhone: row.parent_phone || null,
    classId: row.class_id ? String(row.class_id) : null,
    className: row.class_name || null,
    deptName: null,
    headTeacherName: row.applicant_name || null,
    leaveDate: fmtDate(row.effect_date) || null,
    expectResumeDate: fmtDate(row.expect_resume_date) || null,
    newClassId: null, // 大学无复学，也就没有复学班
    newClassName: null,
    leaveReason: String(row.apply_reason || ''),
    attendedHours: null,
    relatedRefundNo: null,
    approvalStatus: st,
    approvalStatusName: LEAVE_STATUS_NAME[st] || '',
    currentHandlerHint: null,
    createTime: fmtDateTime(row.create_time),
    canApprove: false,
    canCancel: false,
    canSubmit: false,
  };
}

/**
 * 学生下拉
 *
 * ★ `opts.onlySuspended` = 只挑「当前处于休学」的学生（`student_status = 6`）。
 *   ⚠️ 大学目前**没有复学**（`LEAVE_STAGE_BIZ.class = [1,2]`），所以这个开关
 *      在大学这条链上暂时用不到；仍然实现，是为了让三个仓储**签名一致**
 *      （service 按 stage 一致分派，缺参数会编译不过）。哪天大学开出复学，
 *      这里已经是对的。
 */
export async function studentOptions(
  keyword: string,
  limit: number,
  opts: { onlySuspended?: boolean } = {},
): Promise<StudentOption[]> {
  const q = tbl(db, 'sms_class', S, STAGE).where('is_deleted', 0);
  if (opts.onlySuspended) q.andWhere('student_status', StudentStatus.SUSPENDED);
  if (keyword) {
    q.andWhere((b) => {
      b.where('student_name', 'like', `%${keyword}%`).orWhere('student_no', 'like', `%${keyword}%`);
    });
  }
  const rows = (await q.limit(limit)) as Array<Record<string, any>>;
  return rows.map((r) => ({
    id: String(r.id),
    no: String(r.student_no || ''),
    name: String(r.student_name || ''),
    classId: r.class_id ? String(r.class_id) : null,
    className: r.class_name || null,
  }));
}

/** 取一个学生的快照 */
export async function findStudent(id: string): Promise<StudentSnapshot | null> {
  const r = (await tbl(db, 'sms_class', S, STAGE).where({ id, is_deleted: 0 }).first()) as Record<string, any> | undefined;
  if (!r) return null;
  return {
    no: String(r.student_no || ''),
    name: String(r.student_name || ''),
    gender: r.gender || null,
    idCard: r.id_card || null,
    phone: r.phone || null,
    parentPhone: r.parent_phone || null,
    classId: r.class_id ? String(r.class_id) : null,
    className: r.class_name || null,
    deptCode: r.dept_code != null ? Number(r.dept_code) : null,
    studentStatus: r.student_status != null ? Number(r.student_status) : null,
  };
}

/** 分页（★ 始终限定在 休学/退学） */
export async function list(q: LeaveListQuery): Promise<{ rows: LeaveRow[]; total: number }> {
  const base = tbl(db, SRC, T, STAGE).where('is_deleted', 0).whereIn('apply_type', IN_SCOPE);
  if (q.keyword) {
    base.andWhere((b) => {
      b.where('student_name', 'like', `%${q.keyword}%`).orWhere('student_no', 'like', `%${q.keyword}%`);
    });
  }
  if (q.classId) base.andWhere('class_id', q.classId);
  if (q.startDate) base.andWhere('apply_time', '>=', `${q.startDate} 00:00:00`);
  if (q.endDate) base.andWhere('apply_time', '<=', `${q.endDate} 23:59:59`);
  if (q.bizType) base.andWhere('apply_type', await toRawLeaveBiz(STAGE, q.bizType));
  if (q.status) base.andWhere('apply_status', await toRawLeaveStatus(STAGE, q.status));

  const [{ total }] = (await base.clone().count({ total: '*' })) as Array<{ total: number }>;
  const rows = (await base
    .clone()
    .orderBy('create_time', 'desc')
    .limit(q.size)
    .offset((q.page - 1) * q.size)) as Array<Record<string, any>>;
  return { rows: await Promise.all(rows.map(decorate)), total: Number(total) };
}

/**
 * ★ 批量取「学生当前状态」：`{ 学生id: student_status }`
 *
 * 列表要显示「学生现状」（区别于单据状态），但这是**实时值**、
 * 不是异动单上的快照列，所以在 service 分页之后按页批量补，
 * 一次 whereIn 拿完（不是每行查一次 —— 跨学段合并时可能有几百行）。
 *
 * ⚠️ 不过滤 `is_deleted`：软删的学生也要能看到状态，否则列表出现空白。
 */
export async function studentStatuses(ids: string[]): Promise<Record<string, number>> {
  if (!ids.length) return {};
  const rows = (await tbl(db, SRC, S, STAGE)
    .whereIn('id', ids)
    .select('id', 'student_status')) as Array<Record<string, any>>;
  const out: Record<string, number> = {};
  for (const r of rows) out[String(r.id)] = Number(r.student_status ?? 0);
  return out;
}

export async function detail(id: string): Promise<LeaveRow | null> {
  const row = (await tbl(db, SRC, T, STAGE).where({ id, is_deleted: 0 }).whereIn('apply_type', IN_SCOPE).first()) as
    | Record<string, any>
    | undefined;
  return row ? decorate(row) : null;
}

/** 汇总 */
export async function aggregate(): Promise<LeaveAggregate> {
  const rows = (await tbl(db, SRC, T, STAGE)
    .where('is_deleted', 0)
    .whereIn('apply_type', IN_SCOPE)
    .select('apply_type', 'apply_status')
    .count({ c: '*' })
    .groupBy('apply_type', 'apply_status')) as Array<Record<string, any>>;

  const out: LeaveAggregate = {
    total: 0,
    suspendCount: 0,
    quitCount: 0,
    resumeCount: 0,
    pendingCount: 0,
    approvedCount: 0,
  };
  for (const r of rows) {
    const n = Number(r.c || 0);
    out.total += n;
    const biz = (await toUnifiedLeaveBiz(STAGE, Number(r.apply_type))) ?? 0;
    if (biz === 1) out.suspendCount += n;
    if (biz === 2) out.quitCount += n;
    if (biz === 3) out.resumeCount += n;
    const st = Number(r.apply_status);
    if (st === 2 || st === 3) out.pendingCount += n;
    if (st === 4) out.approvedCount += n;
  }
  return out;
}

/** 新建（`apply_status` 初值 = 1 待提交；大学 DRAFT 也是 1） */
export async function insert(conn: any, input: LeaveWriteInput): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  const rawBiz = await toRawLeaveBiz(STAGE, input.bizType);
  const t = `${todayStr()} ${String(now.getHours()).padStart(2, '0')}:${String(
    now.getMinutes(),
  ).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

  await tblInsTrx(conn, SRC, T, STAGE, {
    id,
    create_time: now,
    create_by: input.initiatorId,
    is_deleted: false,

    apply_no: buildApplyNo(),
    apply_type: rawBiz,
    student_id: input.studentId,
    student_no: input.studentNo || null,
    student_name: input.studentName || null,
    class_id: input.classId,
    class_name: input.className,
    dept_code: input.deptCode,

    id_card: input.idCard,
    parent_phone: input.parentPhone,
    apply_reason: input.leaveReason,
    effect_date: input.leaveDate || todayStr(),
    expect_resume_date: input.expectResumeDate,

    apply_status: 1, // 待提交
    applicant_id: input.initiatorId,
    applicant_name: input.initiatorName,
    apply_time: t,
  });
  return id;
}

/** 改状态（统一码 → 大学原码，恒等） */
export async function setStatus(
  conn: any,
  id: string,
  unifiedStatus: number,
  patch: Record<string, any> = {},
): Promise<void> {
  const raw = await toRawLeaveStatus(STAGE, unifiedStatus);
  await tblTrx(conn, SRC, T, STAGE)
    .where({ id })
    .update({ apply_status: raw, update_time: new Date(), ...patch });
}

/** 大学无复学 → 空实现（保持三仓储签名一致） */
export async function setResumeClass(): Promise<void> {
  /* 大学没有复学，不涉及 */
}

/**
 * ★ 审批通过后：改 `t_class_student.student_status`
 *   休学 → 6 · 退学 → 7（大学无复学）
 */
export async function afterApproved(conn: any, id: string, operatorId: string): Promise<void> {
  const row = (await tblTrx(conn, SRC, T, STAGE).where({ id }).first()) as Record<string, any> | undefined;
  if (!row) return;
  const biz = (await toUnifiedLeaveBiz(STAGE, Number(row.apply_type))) ?? 0;
  const newStatus = biz === 1 ? StudentStatus.SUSPENDED : StudentStatus.QUIT;

  await tblTrx(conn, SRC, S, STAGE)
    .where({ id: row.student_id })
    .update({ student_status: newStatus, update_time: new Date(), update_by: operatorId });
}

/** 该学生是否有进行中的申请 */
export async function hasPending(studentId: string): Promise<boolean> {
  const row = await tbl(db, SRC, T, STAGE)
    .where({ student_id: studentId, is_deleted: 0 })
    .whereIn('apply_type', IN_SCOPE)
    .whereIn('apply_status', [1, 2, 3])
    .first();
  return !!row;
}
