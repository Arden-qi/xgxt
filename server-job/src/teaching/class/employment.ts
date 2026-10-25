/**
 * 升就业 / 已就业（2026-10-21 批注）
 * ============================================================
 * 批注原文（班级管理页，红字 1/2/3 条）：
 *   「1. 点击【升实训】，并且升实训成功后，则班级状态改为【实训】」
 *   「2. 点击【升就业】，并且升就业成功之后，则班级状态改为【待就业】，
 *     【升就业】按钮改为已就业」
 *   「3. 点击【已就业】系统识别整个班级的学生状态，若状态都已经变为已就业、退学，
 *     则提示整班都已就业并显示班级人数和就业人数，确认要将班级状态改为已就业吗，
 *     确认之后，班级的状态该为【已就业】；若识别班级内仍存在其他状态的学生，
 *     则进行提示班级各个状态的人数，并且提示确认要强制将本班状态改为【已就业】，
 *     确认之后需要再次确认，再次确认之后状态改为已就业」
 *
 * 【口径】
 *   ① 入口只在**实训班**（`t_job_class` 里 `stage_key='job'`）上出现 ——
 *      这些班就是「升实训」造出来的，所以「升实训之后才有升就业」天然成立。
 *   ② 升就业：改**学生状态**（实训中 8 → 待就业 9）+ 班级状态（实训 5 → 待就业 6）。
 *      班级本身不搬、不改名、不换部门。
 *      已是「待就业(9)」的学生跳过；已是「已就业(10)」的**不降级**（终态）。
 *   ③ 已就业：先查整班学生状态分布（employment-progress），
 *      全部为「已就业 / 退学」→ 提示整班已就业 + 班级人数 / 就业人数 → 一次确认
 *      → 把**班级状态**置为「已就业(7)」。**不改学生状态**
 *      （学生是不是已就业，由「学生档案 → 已就业」按钮逐个确认）。
 *
 * ★ 2026-10-23 批注（改口径，以此为准）：
 *   「若识别班级内仍存在其他状态的学生，则进行提示班级各个状态的人数及人员，
 *     **不可进行【已就业】操作**」
 *   → 原「强制确认 + 再次确认」两条弹窗**整体删除**。只要还有学生不是
 *     「已就业 / 退学」，就只弹提示（人数 + 姓名），**不允许改班级状态**；
 *     后端的 confirmClassEmployed 也做同一道校验，绕过前端直接调接口同样会被拦。
 *
 * ⚠️ 与「升实训」不同：这里不跨库、不建班、不写花名册，只是批量改状态，
 *    所以不放进 training.ts，单独一个文件更不容易误改到搬迁逻辑。
 */

import { BizCode, STUDENT_STATUS_NAME, StudentStatus } from 'shared-types';
import { BizError } from '../../middleware/errorHandler';
import { db } from '../../utils/db';
import { CLASS_STATUS, CLASS_STATUS_NAME } from '../shared/dto';
import { tbl, uniDb } from '../shared/uniTable';
import { LOCKED_STUDENT_STATUSES } from '../shared/statusLock';
import { assertStageView } from './service';

const T = 't_job_class';
const ROSTER_T = 't_job_class_student';

/**
 * ★ 2026-10-25：就业部在库里有两个学段 —— `job`（实训，升实训造的班）
 *   与 `emp`（就业，班级管理里「部门=就业部」直接建的班）。
 *   本文件原来所有取数都用 tbl(...,'job')，会被注入 edu_stage='job'：
 *   → emp 班级 loadJobClass 直接报「该操作只能用于实训班级」
 *   → rosterStudentIds 查不到人、学生状态更新 0 行、班级状态改不动。
 *   升就业/已就业对两种学段都必须生效，统一走下面两个 helper。
 */
const empStudentQb = () =>
  uniDb('t_uni_student').whereIn('edu_stage', ['job', 'emp']).andWhere('dept_code', 3);
const STUDENT_T = 't_student_base';
const STAGE = 'job' as const;

export interface EmploymentUpgradeInput {
  classId: string;
}

export interface EmploymentUpgradeResult {
  className: string;
  /** 本次真正改成「待就业」的人数 */
  updated: number;
  /** 已经是待就业 / 已就业，跳过的学生数 */
  skipped: number;
  /** 改完之后的班级状态（应为 6 待就业） */
  classStatus: number;
  classStatusName: string;
}

/** 一个「学生状态 → 人数」条目 */
export interface EmploymentProgressStudent {
  studentId: string;
  studentNo: string | null;
  studentName: string | null;
}

export interface EmploymentProgressItem {
  status: number;
  statusName: string;
  count: number;
  /**
   * 该状态下的学生名单
   *   ★ 2026-10-23 批注：被拦时除了人数还要显示「人员」，所以这里直接带名字，
   *     前端不必再按状态回查一次花名册。
   */
  students: EmploymentProgressStudent[];
}

export interface EmploymentProgressResult {
  className: string;
  /** 班级当前状态（5 实训 / 6 待就业 / 7 已就业 …） */
  classStatus: number;
  classStatusName: string;
  /** 班级人数（花名册在册人数） */
  total: number;
  /** 已就业人数 */
  employed: number;
  /** 退学人数 */
  quit: number;
  /** 还没结清的人数（既不是已就业也不是退学） */
  pending: number;
  /** 全班都已是「已就业 / 退学」→ true */
  settled: boolean;
  /** 各状态人数（按人数降序，人数相同按状态码升序） */
  items: EmploymentProgressItem[];
}

export interface EmployedConfirmResult {
  className: string;
  /** 确认之后的班级状态（7 已就业） */
  classStatus: number;
  classStatusName: string;
  /** 本次是否真的改动了（本来就是已就业 → false） */
  changed: boolean;
}

/** 取实训班（只认 stage_key='job'，越权与不存在都按同一句话回） */
async function loadJobClass(classId: string): Promise<Record<string, any>> {
  const cls = (await uniDb('t_uni_class')
    .where({ id: classId, is_deleted: 0 })
    .first()) as Record<string, any> | undefined;
  if (!cls) throw new BizError(BizCode.CLASS_NOT_FOUND, '班级不存在或已删除');
  /* 就业部两种学段都允许（job=实训班、emp=就业班） */
  const key = String(cls.stage_key ?? cls.edu_stage ?? '');
  if (key !== 'job' && key !== 'emp') {
    throw new BizError(BizCode.PARAM_ERROR, '该操作只能用于就业部班级');
  }
  return cls;
}

/** 花名册里的学生 id 列表 */
async function rosterStudentIds(classId: string): Promise<string[]> {
  /* ★ 2026-10-25：改为按学生档案的 class_id 取。
     就业班（emp）在建班时没有写花名册表，按花名册查会「该班级没有学生」。 */
  const roster = (await empStudentQb()
    .where({ class_id: classId, is_deleted: 0 })
    .select('id')) as Array<Record<string, any>>;
  return roster.map((r) => String(r.id)).filter(Boolean);
}

export async function upgradeClassToEmployment(
  input: EmploymentUpgradeInput,
  user: any,
): Promise<EmploymentUpgradeResult> {
  // 升就业只发生在实训班，权限按「实训」学段校验
  await assertStageView(user, 'job');

  const classId = String(input.classId ?? '').trim();
  if (!classId) throw new BizError(BizCode.PARAM_ERROR, '缺少班级ID');

  const cls = await loadJobClass(classId);
  const className = String(cls.class_name ?? '');

  const ids = await rosterStudentIds(classId);
  if (!ids.length) throw new BizError(BizCode.PARAM_ERROR, '该班级没有学生');

  // 只动「还没到待就业/已就业」的学生
  // ★ 2026-10-21 批注：「学生状态为【退学】的，任何操作都不可更改该状态」
  //   退学(7) 虽然也落在 whereNotIn 里，但它是**永久锁** → 必须单独排除，
  //   否则一次【升就业】就把退学学生改成「待就业」，花名册里那条退学记录凭空消失。
  //   见 shared/statusLock.ts（LOCKED_STUDENT_STATUSES）。
  const updated = await empStudentQb()
    .whereIn('id', ids)
    .whereNotIn('student_status', [
      StudentStatus.WAIT_EMPLOY,
      StudentStatus.EMPLOYED,
      ...LOCKED_STUDENT_STATUSES,
    ])
    .update({
      student_status: StudentStatus.WAIT_EMPLOY,
      update_time: new Date(),
      update_by: user?.userId || 'system',
    });

  /* ★ 2026-10-21 批注第 2 条：升就业成功 → 班级状态改为「待就业」
   *   已经是「已就业(7)」的班不动（终态，不能被再次升就业拉回来）。 */
  const from = Number(cls.class_status);
  let classStatus = from;
  if (from !== CLASS_STATUS.EMPLOYED && from !== CLASS_STATUS.WAIT_EMPLOY) {
    classStatus = CLASS_STATUS.WAIT_EMPLOY;
    await uniDb('t_uni_class').where({ id: classId }).update({
      class_status: classStatus,
      prev_class_status: from,
      update_time: new Date(),
      update_by: user?.userId || 'system',
    });
  }

  return {
    className,
    updated: Number(updated) || 0,
    skipped: Math.max(ids.length - (Number(updated) || 0), 0),
    classStatus,
    classStatusName: CLASS_STATUS_NAME[classStatus] ?? '',
  };
}

/**
 * 【已就业】第一步：识别整班学生状态
 *   前端拿 settled 决定弹「确认」还是弹「不可操作」，
 *   items 用来逐条列出「已就业 12 人（张三、李四…）/ 待就业 3 人（王五…）」。
 */
export async function getEmploymentProgress(
  input: EmploymentUpgradeInput,
  user: any,
): Promise<EmploymentProgressResult> {
  await assertStageView(user, 'job');

  const classId = String(input.classId ?? '').trim();
  if (!classId) throw new BizError(BizCode.PARAM_ERROR, '缺少班级ID');

  const cls = await loadJobClass(classId);
  const ids = await rosterStudentIds(classId);
  if (!ids.length) throw new BizError(BizCode.PARAM_ERROR, '该班级没有学生');

  return buildProgress(cls, ids);
}

/** 整班学生状态分布（getEmploymentProgress 与 confirmClassEmployed 共用） */
async function buildProgress(
  cls: Record<string, any>,
  ids: string[],
): Promise<EmploymentProgressResult> {
  const rows = (await empStudentQb()
    .whereIn('id', ids)
    .select('id', 'student_no', 'student_name', 'student_status')) as Array<Record<string, any>>;

  // 状态码 → 该状态的学生名单
  const bucket = new Map<number, EmploymentProgressStudent[]>();
  for (const r of rows) {
    const s = Number(r.student_status ?? 0);
    const list = bucket.get(s) ?? [];
    list.push({
      studentId: String(r.id),
      studentNo: r.student_no == null ? null : String(r.student_no),
      studentName: r.student_name == null ? null : String(r.student_name),
    });
    bucket.set(s, list);
  }
  // 花名册有、主档查不到的学生也要算进总人数，否则「人数」对不上
  const found = new Set(rows.map((r) => String(r.id)));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length) {
    const list = bucket.get(0) ?? [];
    for (const id of missing) list.push({ studentId: id, studentNo: null, studentName: null });
    bucket.set(0, list);
  }

  const items: EmploymentProgressItem[] = [...bucket.entries()]
    .map(([status, students]) => ({
      status,
      statusName: status ? (STUDENT_STATUS_NAME[status] ?? String(status)) : '状态未知',
      count: students.length,
      students,
    }))
    .sort((a, b) => b.count - a.count || a.status - b.status);

  const employed = bucket.get(StudentStatus.EMPLOYED)?.length ?? 0;
  const quit = bucket.get(StudentStatus.QUIT)?.length ?? 0;
  // 既不是已就业也不是退学（含状态未知）→ 都算「未结清」
  const pending = ids.length - employed - quit;

  return {
    className: String(cls.class_name ?? ''),
    classStatus: Number(cls.class_status),
    classStatusName: CLASS_STATUS_NAME[Number(cls.class_status)] ?? '',
    total: ids.length,
    employed,
    quit,
    pending: Math.max(pending, 0),
    settled: pending <= 0,
    items,
  };
}

/**
 * 【已就业】第二步：把班级状态改成「已就业」
 *   ⚠️ 只改班级状态，学生状态一个不动（学生档案里逐个点【已就业】才是写 10）。
 *   ★ 2026-10-23 批注：班级里还有学生不是「已就业 / 退学」→ **不允许改**，
 *     即使前端被绕过也在这里拦下（否则「不可进行已就业操作」只是前端假象）。
 */
export async function confirmClassEmployed(
  input: EmploymentUpgradeInput,
  user: any,
): Promise<EmployedConfirmResult> {
  await assertStageView(user, 'job');

  const classId = String(input.classId ?? '').trim();
  if (!classId) throw new BizError(BizCode.PARAM_ERROR, '缺少班级ID');

  const cls = await loadJobClass(classId);
  const className = String(cls.class_name ?? '');
  const from = Number(cls.class_status);

  if (from === CLASS_STATUS.EMPLOYED) {
    return {
      className,
      classStatus: CLASS_STATUS.EMPLOYED,
      classStatusName: CLASS_STATUS_NAME[CLASS_STATUS.EMPLOYED],
      changed: false,
    };
  }

  const ids = await rosterStudentIds(classId);
  if (!ids.length) throw new BizError(BizCode.PARAM_ERROR, '该班级没有学生');

  const progress = await buildProgress(cls, ids);
  if (!progress.settled) {
    const detail = progress.items
      .filter((i) => i.status !== StudentStatus.EMPLOYED && i.status !== StudentStatus.QUIT)
      .map((i) => `${i.statusName} ${i.count} 人`)
      .join('、');
    throw new BizError(
      BizCode.CLASS_STATUS_NOT_ALLOW,
      `班级内还有学生未到「已就业 / 退学」（${detail}），不可改为已就业`,
    );
  }

  await uniDb('t_uni_class').where({ id: classId }).update({
    class_status: CLASS_STATUS.EMPLOYED,
    prev_class_status: from,
    update_time: new Date(),
    update_by: user?.userId || 'system',
  });

  return {
    className,
    classStatus: CLASS_STATUS.EMPLOYED,
    classStatusName: CLASS_STATUS_NAME[CLASS_STATUS.EMPLOYED],
    changed: true,
  };
}
