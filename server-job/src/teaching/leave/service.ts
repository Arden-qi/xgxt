/**
 * 学籍异动审批适配器 · 把三套统一到「实训那一套审批链」
 * ============================================================
 *
 * 与退费域**同源**（同一套手法、同一张审批表、同一套引擎）：
 *   ① 状态码 = `ApprovalStatus`
 *   ② 审批单 = `sms_job.t_job_approval`
 *   ③ 审批引擎 = `utils/approval.ts`（submitApproval / doApprove / doReject / doCancel）
 *
 * 【本域特有的一件事：复学班】
 *   复学**必须在终审通过那一刻确定落到哪个班**，而且这个决定是**学管审批时选的**。
 *   所以 `approve` 多收一个 `newClassId`：
 *     · 只有「复学」类型 + 审批走完时必填（没给就报错，不会悄悄通过）
 *     · 顺序上是**先 doApprove（权限校验）→ 再写复学班**，越权的人碰不到数据
 *     · 写完之后**重新读一次单**再执行副作用（否则 afterApproved 读不到复学班）
 */

import {
  ApprovalBizType,
  ApprovalStatus,
  BizCode,
  canApprove,
  canInitiate,
  isMyApproval,
} from 'shared-types';
import { db } from '../../utils/db';
import { BizError } from '../../middleware/errorHandler';
import {
  APPROVAL_TABLE,
  createApproval,
  doApprove,
  doCancel,
  doReject,
  getApprovalLogs,
  submitApproval,
  type Operator,
} from '../../utils/approval';
import type {
  LeaveDetail,
  LeaveListQuery,
  LeaveRow,
  LeaveSaveBody,
  LeaveSummary,
  TeachingStage,
} from '../shared/dto';
import {
  LEAVE_ACTIVE_STATUSES,
  LEAVE_BIZ_TYPE,
  LEAVE_BIZ_TYPE_NAME,
  LEAVE_STAGE_BIZ,
  LEAVE_STATUS,
  LEAVE_STATUS_NAME,
  TEACHING_STAGE_NAME,
  TEACHING_STAGES,
} from '../shared/dto';
import { assertStageCode, visibleStagesBy } from '../shared/stageAccess';
import { classNameOf, listClassesOfStages } from '../shared/classOptions';
import type { LeaveAggregate, LeaveWriteInput, StudentOption } from './types';
import * as repoJh from './repo.classJh';
import * as repoClass from './repo.class';
import * as repoJob from './repo.job';

/** 业务类型 → 审批业务类型（三条链，来自 shared-types 的 APPROVAL_CHAINS） */
function bizToApproval(bizType: number): string {
  if (bizType === LEAVE_BIZ_TYPE.SUSPEND) return ApprovalBizType.SUSPEND;
  if (bizType === LEAVE_BIZ_TYPE.RESUME) return ApprovalBizType.RESUME;
  return ApprovalBizType.QUIT;
}

/* ============================================================
 * 仓储统一接口
 * ============================================================ */

type Repo = {
  list: (q: LeaveListQuery) => Promise<{ rows: LeaveRow[]; total: number }>;
  detail: (id: string) => Promise<LeaveRow | null>;
  studentOptions: (keyword: string, limit: number) => Promise<StudentOption[]>;
  findStudent: (id: string) => Promise<{
    no: string;
    name: string;
    gender: string | null;
    idCard: string | null;
    phone: string | null;
    parentPhone: string | null;
    classId: string | null;
    className: string | null;
    deptCode: number | null;
    studentStatus: number | null;
  } | null>;
  aggregate: () => Promise<LeaveAggregate>;
  insert: (conn: any, input: LeaveWriteInput) => Promise<string>;
  setStatus: (
    conn: any,
    id: string,
    status: number,
    patch?: Record<string, any>,
  ) => Promise<void>;
  setResumeClass: (conn: any, id: string, classId: string, className: string) => Promise<void>;
  afterApproved: (conn: any, id: string, operatorId: string) => Promise<void>;
  hasPending: (studentId: string) => Promise<boolean>;
};

const REPOS: Record<TeachingStage, Repo> = {
  jh: repoJh as unknown as Repo,
  class: repoClass as unknown as Repo,
  job: repoJob as unknown as Repo,
};

/** 各学段审批页的权限码（= 合并前各学段审批页的权限码） */
const STAGE_VIEW_CODE = {
  jh: 'classjh:approval:view',
  class: 'class:suspend:view',
  job: 'job:suspendApproval:view',
};

const LABEL = '休学/退学审批';

async function assertStageView(user: any, stage: TeachingStage): Promise<void> {
  return assertStageCode(user, stage, STAGE_VIEW_CODE, LABEL);
}

async function visibleStages(user: any): Promise<TeachingStage[]> {
  return visibleStagesBy(user, STAGE_VIEW_CODE, LABEL);
}

export function toOperator(user: any): Operator {
  if (!user) throw new BizError(BizCode.UNAUTHORIZED, '请先登录', 401);
  return { userId: user.userId, userName: user.userName, roles: user.roles || [] };
}

/* ============================================================
 * 审批单装载
 * ============================================================ */

/** 批量取审批单（三条链 btype 不同，都要捞） */
async function loadApprovals(ids: string[]): Promise<Record<string, Record<string, any>>> {
  if (!ids.length) return {};
  const rows = (await db(APPROVAL_TABLE)
    .whereIn('biz_type', [
      ApprovalBizType.SUSPEND,
      ApprovalBizType.QUIT,
      ApprovalBizType.RESUME,
    ])
    .whereIn('biz_id', ids)
    .where('is_deleted', false)
    .orderBy('create_time', 'asc')) as Array<Record<string, any>>;
  const map: Record<string, Record<string, any>> = {};
  for (const r of rows) map[String(r.biz_id)] = r;
  return map;
}

/* ============================================================
 * 按钮显隐
 * ============================================================ */

function withActions(
  row: LeaveRow,
  approval: Record<string, any> | undefined,
  op: Operator,
): LeaveRow {
  const roles = op.roles || [];
  // 老单没审批单时按「统一状态 + 角色」兜底（否则合并后老单谁都点不动）
  let canApproveIt = false;
  if (row.approvalStatus === LEAVE_STATUS.PENDING_MANAGER) {
    canApproveIt = canApprove(bizToApproval(row.bizType), 1, roles);
  } else if (row.approvalStatus === LEAVE_STATUS.PENDING_PRINCIPAL) {
    canApproveIt = canApprove(bizToApproval(row.bizType), 2, roles);
  }

  let canCancelIt = false;
  let canSubmitIt = false;
  if (approval) {
    const isMine = isMyApproval(approval, op.userId, roles);
    if (LEAVE_ACTIVE_STATUSES.includes(row.approvalStatus) && isMine) canCancelIt = true;
    if (approval.status === ApprovalStatus.DRAFT && isMine) canSubmitIt = true;
  } else if (row.approvalStatus === LEAVE_STATUS.DRAFT) {
    canSubmitIt = true;
  }

  return {
    ...row,
    currentHandlerHint:
      approval?.current_handler_hint ||
      (row.approvalStatus === LEAVE_STATUS.PENDING_MANAGER
        ? '待学管审批'
        : row.approvalStatus === LEAVE_STATUS.PENDING_PRINCIPAL
          ? '待校长审批'
          : null),
    canApprove: canApproveIt,
    canCancel: canCancelIt,
    canSubmit: canSubmitIt,
  };
}

/* ============================================================
 * 列表 / 详情
 * ============================================================ */

export async function list(
  q: LeaveListQuery,
  user: any,
): Promise<{ rows: LeaveRow[]; total: number }> {
  const op = toOperator(user);
  const stages: TeachingStage[] = q.stage ? [q.stage] : await visibleStages(user);
  if (!stages.length) return { rows: [], total: 0 };

  if (stages.length === 1) {
    const stage = stages[0];
    await assertStageView(user, stage);
    const { rows, total } = await REPOS[stage].list(q);
    const ap = await loadApprovals(rows.map((r) => r.id));
    let out = rows.map((r) => withActions(r, ap[r.id], op));
    if (q.onlyMine) out = out.filter((r) => r.canApprove);
    return { rows: out, total: q.onlyMine ? out.length : total };
  }

  const per = Math.max(q.size, 20);
  const all: LeaveRow[] = [];
  let total = 0;
  for (const stage of stages) {
    try {
      await assertStageView(user, stage);
      const { rows, total: t } = await REPOS[stage].list({ ...q, page: 1, size: per });
      total += t;
      all.push(...rows);
    } catch {
      /* 没权限的学段跳过 */
    }
  }
  all.sort((a, b) => String(b.createTime || '').localeCompare(String(a.createTime || '')));
  const start = (q.page - 1) * q.size;
  const slice = all.slice(start, start + q.size);
  const ap = await loadApprovals(slice.map((r) => r.id));
  let out = slice.map((r) => withActions(r, ap[r.id], op));
  if (q.onlyMine) out = out.filter((r) => r.canApprove);
  return { rows: out, total };
}

export async function detail(id: string, user: any): Promise<LeaveDetail> {
  const op = toOperator(user);
  const stages = await visibleStages(user);
  let row: LeaveRow | null = null;
  for (const s of stages) {
    row = await REPOS[s].detail(id);
    if (row) break;
  }
  if (!row) throw new BizError(BizCode.STUDENT_LEAVE_NOT_FOUND, '申请单不存在');
  await assertStageView(user, row.stage);

  const ap = await loadApprovals([id]);
  const approval = ap[id];

  let logs: LeaveDetail['logs'] = [];
  if (approval) {
    const raw = await getApprovalLogs(String(approval.id));
    logs = raw.map((l: Record<string, any>) => ({
      step: Number(l.step || 0),
      nodeName: String(l.node_name || ''),
      operatorName: String(l.operator_name || ''),
      actionName: ACTION_NAME[Number(l.action)] || '',
      comment: l.comment || null,
      time: l.create_time ? String(l.create_time).replace('T', ' ').slice(0, 19) : null,
    }));
  }
  return { record: withActions(row, approval, op), logs };
}

const ACTION_NAME: Record<number, string> = { 1: '提交', 2: '同意', 3: '驳回', 4: '撤回' };

/* ============================================================
 * 下拉
 * ============================================================ */

export async function studentOptions(
  stage: TeachingStage,
  keyword: string,
  limit: number,
  user: any,
): Promise<StudentOption[]> {
  await assertStageView(user, stage);
  return REPOS[stage].studentOptions(keyword, limit);
}

export async function classOptions(user: any) {
  const stages = await visibleStages(user);
  return listClassesOfStages(stages);
}

/* ============================================================
 * 新建
 * ============================================================ */

export async function create(body: LeaveSaveBody, user: any): Promise<{ id: string }> {
  const stage = body.stage;
  if (!TEACHING_STAGES.includes(stage)) {
    throw new BizError(BizCode.PARAM_ERROR, '学段参数非法（应为 jh / class / job）');
  }
  await assertStageView(user, stage);
  const op = toOperator(user);

  // ★ 只有班主任 / 项目经理能发起（与实训口径一致）
  if (!canInitiate(bizToApproval(body.bizType), op.roles)) {
    throw new BizError(BizCode.NO_OPERATION_PERMISSION, '只有班主任 / 项目经理能发起');
  }

  // ★ 学段是否支持该类型（大学没有复学）
  if (!LEAVE_STAGE_BIZ[stage].includes(body.bizType)) {
    throw new BizError(
      BizCode.PARAM_ERROR,
      `「${TEACHING_STAGE_NAME[stage]}」不支持「${LEAVE_BIZ_TYPE_NAME[body.bizType] || '该类型'}」`,
    );
  }

  const repo = REPOS[stage];
  const stu = await repo.findStudent(body.studentId);
  if (!stu) throw new BizError(BizCode.STUDENT_NOT_FOUND, '学生不存在');

  if (await repo.hasPending(body.studentId)) {
    throw new BizError(BizCode.STUDENT_LEAVE_DUPLICATE, '该学生已有进行中的申请，请勿重复提交');
  }

  const input: LeaveWriteInput = {
    studentId: body.studentId,
    studentNo: stu.no,
    studentName: stu.name,
    gender: stu.gender,
    idCard: stu.idCard,
    phone: stu.phone,
    parentPhone: stu.parentPhone,
    classId: stu.classId,
    className: stu.className,
    deptName: null,
    deptCode: stu.deptCode,
    headTeacherId: op.userId,
    headTeacherName: op.userName,
    bizType: body.bizType,
    leaveDate: body.leaveDate || '',
    expectResumeDate: body.expectResumeDate || null,
    newClassId: body.newClassId || null,
    newClassName: body.newClassId ? await classNameOf(stage, body.newClassId) : null,
    leaveReason: body.leaveReason,
    attendedHours: null,
    initiatorId: op.userId,
    initiatorName: op.userName,
  };

  let newId = '';
  await db.transaction(async (trx) => {
    newId = await repo.insert(trx, input);
    const approvalId = await createApproval(
      {
        bizType: bizToApproval(body.bizType),
        bizId: newId,
        applicant: op,
        studentId: input.studentId,
        studentNo: input.studentNo,
        studentName: input.studentName,
        classId: input.classId || undefined,
        className: input.className || undefined,
        deptCode: input.deptCode ?? undefined,
      },
      trx,
    );
    if (body.submit) {
      await submitApproval(approvalId, op, trx);
      await repo.setStatus(trx, newId, LEAVE_STATUS.PENDING_MANAGER);
    }
  });

  return { id: newId };
}

/* ============================================================
 * 惰性补建审批单（老单）
 * ============================================================ */

async function ensureApproval(
  trx: any,
  bizId: string,
  row: LeaveRow,
  op: Operator,
): Promise<string> {
  const existed = (await trx(APPROVAL_TABLE)
    .where({ biz_id: bizId, is_deleted: false })
    .whereIn('biz_type', [ApprovalBizType.SUSPEND, ApprovalBizType.QUIT, ApprovalBizType.RESUME])
    .first()) as Record<string, any> | undefined;
  if (existed) return String(existed.id);

  const id = await createApproval(
    {
      bizType: bizToApproval(row.bizType),
      bizId,
      applicant: op,
      studentId: row.studentId,
      studentNo: row.studentNo,
      studentName: row.studentName,
      classId: row.classId || undefined,
      className: row.className || undefined,
    },
    trx,
  );
  const step =
    row.approvalStatus === LEAVE_STATUS.PENDING_PRINCIPAL
      ? 2
      : row.approvalStatus === LEAVE_STATUS.PENDING_MANAGER
        ? 1
        : 0;
  await trx(APPROVAL_TABLE).where({ id }).update({
    status: row.approvalStatus,
    current_step: step,
    current_handler_hint:
      row.approvalStatus === LEAVE_STATUS.PENDING_MANAGER
        ? '待学管审批'
        : row.approvalStatus === LEAVE_STATUS.PENDING_PRINCIPAL
          ? '待校长审批'
          : null,
  });
  return id;
}

async function mustGet(stage: TeachingStage, id: string): Promise<LeaveRow> {
  const row = await REPOS[stage].detail(id);
  if (!row) throw new BizError(BizCode.STUDENT_LEAVE_NOT_FOUND, '申请单不存在');
  return row;
}

/* ============================================================
 * 提交 / 审批 / 驳回 / 撤回
 * ============================================================ */

export async function submit(
  stage: TeachingStage,
  id: string,
  user: any,
): Promise<{ approvalStatus: number; approvalStatusName: string }> {
  await assertStageView(user, stage);
  const op = toOperator(user);
  const row = await mustGet(stage, id);
  if (row.approvalStatus !== LEAVE_STATUS.DRAFT) {
    throw new BizError(BizCode.APPROVAL_ALREADY_SUBMITTED, '该单已提交，不能重复提交');
  }

  await db.transaction(async (trx) => {
    const approvalId = await ensureApproval(trx, id, row, op);
    await submitApproval(approvalId, op, trx);
    await REPOS[stage].setStatus(trx, id, LEAVE_STATUS.PENDING_MANAGER);
  });

  return {
    approvalStatus: LEAVE_STATUS.PENDING_MANAGER,
    approvalStatusName: LEAVE_STATUS_NAME[LEAVE_STATUS.PENDING_MANAGER],
  };
}

export async function approve(
  stage: TeachingStage,
  id: string,
  body: { comment?: string; newClassId?: string },
  user: any,
): Promise<{ finished: boolean; approvalStatus: number; approvalStatusName: string }> {
  await assertStageView(user, stage);
  const op = toOperator(user);
  const row = await mustGet(stage, id);

  let finished = false;
  let nextStatus: number = row.approvalStatus;

  await db.transaction(async (trx) => {
    const approvalId = await ensureApproval(trx, id, row, op);

    // ① 先走审批引擎（权限校验在 doApprove 里 —— 越权直接抛，下面的写入不会发生）
    const r = await doApprove(approvalId, op, body.comment, trx);
    finished = r.finished;
    nextStatus = Number(r.status);

    // ② ★ 复学：**批到"通过"那一刻**才落复学班，且必须选
    if (row.bizType === LEAVE_BIZ_TYPE.RESUME && finished) {
      if (!body.newClassId) {
        throw new BizError(BizCode.PARAM_ERROR, '复学审批必须选定复学班级');
      }
      const clsName = await classNameOf(stage, body.newClassId);
      await REPOS[stage].setResumeClass(trx, id, body.newClassId, clsName);
    }

    await REPOS[stage].setStatus(trx, id, nextStatus);

    // ③ 全流程走完 → 副作用（改学生状态；复学要回到复学班，
    //    ⚠️ 所以上一步必须先把复学班写进去，afterApproved 才读得到）
    if (finished) {
      await REPOS[stage].afterApproved(trx, id, op.userId);
    }
  });

  return {
    finished,
    approvalStatus: nextStatus,
    approvalStatusName: LEAVE_STATUS_NAME[nextStatus] || '',
  };
}

export async function reject(
  stage: TeachingStage,
  id: string,
  reason: string,
  user: any,
): Promise<{ approvalStatus: number; approvalStatusName: string }> {
  await assertStageView(user, stage);
  const op = toOperator(user);
  const row = await mustGet(stage, id);

  await db.transaction(async (trx) => {
    const approvalId = await ensureApproval(trx, id, row, op);
    await doReject(approvalId, op, reason, trx);
    await REPOS[stage].setStatus(trx, id, LEAVE_STATUS.REJECTED, { reject_reason: reason });
  });

  return {
    approvalStatus: LEAVE_STATUS.REJECTED,
    approvalStatusName: LEAVE_STATUS_NAME[LEAVE_STATUS.REJECTED],
  };
}

export async function cancel(
  stage: TeachingStage,
  id: string,
  reason: string | undefined,
  user: any,
): Promise<{ approvalStatus: number; approvalStatusName: string }> {
  await assertStageView(user, stage);
  const op = toOperator(user);
  const row = await mustGet(stage, id);

  await db.transaction(async (trx) => {
    const approvalId = await ensureApproval(trx, id, row, op);
    await doCancel(approvalId, op, reason, trx);
    await REPOS[stage].setStatus(trx, id, LEAVE_STATUS.CANCELED);
  });

  return {
    approvalStatus: LEAVE_STATUS.CANCELED,
    approvalStatusName: LEAVE_STATUS_NAME[LEAVE_STATUS.CANCELED],
  };
}

/* ============================================================
 * 汇总
 * ============================================================ */

export async function summary(user: any): Promise<LeaveSummary[]> {
  const stages = await visibleStages(user);
  const out: LeaveSummary[] = [];
  for (const s of stages) {
    const a = await REPOS[s].aggregate();
    out.push({
      stage: s,
      stageName: TEACHING_STAGE_NAME[s],
      total: a.total,
      suspendCount: a.suspendCount,
      quitCount: a.quitCount,
      resumeCount: a.resumeCount,
      pendingCount: a.pendingCount,
      approvedCount: a.approvedCount,
    });
  }
  return out;
}

/** 供路由层用的常量（各学段支持的类型） */
export const STAGE_BIZ_SUPPORT = LEAVE_STAGE_BIZ;
