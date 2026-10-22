/**
 * 班级信息适配器（Adapter）
 * ============================================================
 *
 * 【与学生档案适配器的关键区别：不去重】
 *   学生档案要去重 —— 同一个人的影子表在多个库各有一条。
 *   班级**不去重** —— 「初高 G104」和「大学 G104」是**两个不同的班**，
 *   同名是常态，不是重复。按名字去重会把两个真实班级吃掉一个。
 *   → 所以本域只做「合并 + 分页」，不做去重。
 *
 * 【权限码 = 合并前各学段原页面的权限码，一个都没改】
 *   jh classjh:classInfo:view / class class:info:view / job job:class:view
 */

import { BizCode } from 'shared-types';
import { BizError } from '../../middleware/errorHandler';
import * as repoClassJh from './repo.classJh';
import * as repoClass from './repo.class';
import * as repoJob from './repo.job';
import * as repoEmp from './repo.emp';
import type {
  ClassHandoverPayload,
  ClassStage,
  ClassHandoverRow,
  ClassListQuery,
  ClassRow,
  ClassSaveBody,
  ClassStageMeta,
  ClassSummary,
} from '../shared/dto';
import { CLASS_STAGES, CLASS_STAGE_NAME, isClassStage } from '../shared/dto';
import { assertClassInScope } from '../shared/dataScope';
import { assertStageCodeEx, visibleStagesEx } from '../shared/stageAccess';
import { loadStagePlanOptions, mergePhaseOptions } from '../shared/stagePlans';
import type { ClassDetail, ClassRepo } from './types';
import {
  HANDOVER_ROLES,
  insertHandover,
  listHandovers,
  pickNew,
  type RoleKey,
  type StaffSlot,
} from './handover.repo';

const REPOS: Record<ClassStage, ClassRepo> = {
  jh: repoClassJh.repo,
  class: repoClass.repo,
  job: repoJob.repo,
  // ★ 2026-10-19 批注：就业部独立学段（复用 sms_job 表，按 dept_code=3 隔离）
  emp: repoEmp.repo,
};

/** 各学段班级页的权限码 */
const CODES: Record<ClassStage, string> = {
  jh: 'classjh:classInfo:view',
  class: 'class:info:view',
  job: 'job:class:view',
  // 就业部沿用就业/实训模块的班级查看权限
  emp: 'job:class:view',
};

const LABEL = '班级信息';

/** 学段所属门户模块（判权时用；就业部沿用 job 模块） */
const MODULE_OF = (s: ClassStage): string =>
  s === 'jh' ? 'class-jh' : s === 'class' ? 'class' : 'job';

export function assertStageView(user: any, stage: ClassStage): Promise<void> {
  return assertStageCodeEx(user, stage, CODES, LABEL, (s) => CLASS_STAGE_NAME[s], MODULE_OF);
}

export function visibleStages(user: any): Promise<ClassStage[]> {
  return visibleStagesEx(user, CLASS_STAGES, CODES, LABEL, (s) => CLASS_STAGE_NAME[s], MODULE_OF);
}

function pick(stage: ClassStage): ClassRepo {
  const r = REPOS[stage];
  if (!r) throw new BizError(BizCode.PARAM_ERROR, `stage 只能是 jh / class / job`);
  return r;
}

/** 校验 stage 合法 */
export function assertStage(v: unknown): ClassStage {
  if (!isClassStage(v)) {
    throw new BizError(BizCode.PARAM_ERROR, 'stage 只能是 jh / class / job / emp');
  }
  return v;
}

function optStage(v: unknown): ClassStage | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  return assertStage(v);
}

/* ============================================================
 * ★ 2026-10-22 批注：「部门」下拉删除「实训」，实训班并入「就业部」
 * ------------------------------------------------------------
 *   前端「部门」筛选只剩 初高部 / 大学部 / 就业部。
 *   实训(job) 与就业(emp) 在库里是**同一张表**（sms_job.t_job_class），
 *   只靠 stage_key 区分，dept_code 都是 3 —— 所以选「就业部」必须同时查这两套，
 *   否则做了「升实训」的班在页面上就凭空消失了。
 *   行的 stage 仍是 job / emp（操作按钮、删改、详情都要按真实 stage 走），
 *   只是「部门」这一层的展示合并成就业部。
 * ============================================================ */
const STAGE_FANOUT: Record<ClassStage, ClassStage[]> = {
  jh: ['jh'],
  class: ['class'],
  job: ['job'],
  emp: ['job', 'emp'],
};

/** 把「部门选项」展开成真正要查的学段（去重、保持顺序） */
function expandStages(stages: ClassStage[]): ClassStage[] {
  const out: ClassStage[] = [];
  for (const s of stages) {
    for (const x of STAGE_FANOUT[s]) if (!out.includes(x)) out.push(x);
  }
  return out;
}

/** 按学段固定顺序排（初高 → 大学 → 实训 → 就业） */
function sortByStage<T extends { stage: ClassStage }>(list: T[]): T[] {
  return list.sort((a, b) => CLASS_STAGES.indexOf(a.stage) - CLASS_STAGES.indexOf(b.stage));
}

/**
 * 统计卡：把「实训」那一行并进「就业部」，页面上不再出现「实训班级」卡
 *   （部门下拉已经没有实训了，卡片再单列一行就和筛选对不上）
 */
function mergeJobIntoEmp(list: ClassSummary[]): ClassSummary[] {
  const job = list.find((x) => x.stage === 'job');
  if (!job) return list;
  const n = (v: number | undefined) => Number(v || 0);
  const out = list.filter((x) => x.stage !== 'job');
  const emp = out.find((x) => x.stage === 'emp');
  if (!emp) {
    // 只有实训班（还没有真正的就业班）→ 用实训那条顶上，名字统一成「就业部」
    out.push({ ...job, stage: 'emp', stageName: CLASS_STAGE_NAME.emp });
  } else {
    emp.total += job.total;
    emp.openCount += job.openCount;
    emp.closedCount += job.closedCount;
    emp.graduatingCount += job.graduatingCount;
    emp.studentCount += job.studentCount;
    emp.trainingCount = n(emp.trainingCount) + n(job.trainingCount);
    emp.waitEmployCount = n(emp.waitEmployCount) + n(job.waitEmployCount);
    emp.employedCount = n(emp.employedCount) + n(job.employedCount);
  }
  return sortByStage(out);
}

/* ============================================================
 * 列表（合并 + 分页；统计与列表共用 mergedRows，保证「卡片 = 列表」）
 * ============================================================ */

async function mergedRows(
  q: ClassListQuery,
  user: any,
): Promise<{ rows: ClassRow[]; stages: ClassStage[] }> {
  const stages: ClassStage[] = expandStages(q.stage ? [q.stage] : await visibleStages(user));
  if (!stages.length) throw new BizError(BizCode.NO_OPERATION_PERMISSION, '没有班级信息的访问权限');
  if (q.stage) await assertStageView(user, q.stage);

  // ★ 展开出来的子学段（就业部 → job + emp）不再单独判权：
  //   两个学段用的是同一个权限码（见 CODES），父级过了就等于子级也过了。
  const parts = await Promise.all(stages.map((s) => REPOS[s].list(q, user)));
  let rows = parts.flat();

  // 学段顺序固定（初高 → 大学 → 实训 → 就业），再按创建时间倒序
  rows.sort((a, b) => {
    const sa = CLASS_STAGES.indexOf(a.stage);
    const sb = CLASS_STAGES.indexOf(b.stage);
    if (sa !== sb) return sa - sb;
    const ta = a.createTime || '';
    const tb = b.createTime || '';
    if (ta !== tb) return ta < tb ? 1 : -1;
    return a.className.localeCompare(b.className, 'zh-Hans-CN');
  });
  return { rows, stages };
}

/** 列表（分页） */
export async function listClasses(
  q: ClassListQuery,
  user: any,
): Promise<{ list: ClassRow[]; total: number; page: number; size: number; stages: ClassStage[] }> {
  const { rows, stages } = await mergedRows(q, user);
  const total = rows.length;
  const start = (q.page - 1) * q.size;
  return { list: rows.slice(start, start + q.size), total, page: q.page, size: q.size, stages };
}

/** 统计（口径与列表完全一致：同一套筛选） */
export async function summaryClasses(
  q: ClassListQuery,
  user: any,
): Promise<ClassSummary[]> {
  const stages: ClassStage[] = expandStages(q.stage ? [q.stage] : await visibleStages(user));
  if (!stages.length) return [];
  if (q.stage) await assertStageView(user, q.stage);

  // 逐学段统计（每个仓储自己算，口径与它自己的 list 一致）
  const list = await Promise.all(stages.map((s) => REPOS[s].summary(q, user)));
  // ★ 2026-10-22：「实训」不再单列一行卡片，并进「就业部」
  return mergeJobIntoEmp(list);
}

/** 详情 */
export async function getClassDetail(
  stage: ClassStage,
  id: string,
  user: any,
): Promise<ClassDetail | null> {
  await assertStageView(user, stage);
  await assertClassInScope(stage, id, user, '该班级');
  return pick(stage).detail(id, user);
}

/** 保存 */
export async function saveClass(body: ClassSaveBody, user: any): Promise<{ id: string }> {
  await assertStageView(user, body.stage);
  try {
    return await pick(body.stage).save(body, user?.userId || '');
  } catch (e) {
    // ★ 2026-10-21：仓储抛的业务校验（编号必填 / 编号重复 / 名称重复）原来会冒成
    //   「服务器错误：…」，前端只能看到一个 500。转成参数错误，原文照给用户看。
    const msg = (e as Error).message || '保存失败';
    if (/编号|必填|已有班级|已存在/.test(msg)) throw new BizError(BizCode.PARAM_ERROR, msg);
    throw e;
  }
}

/** 删除 */
export async function removeClass(stage: ClassStage, id: string, user: any): Promise<void> {
  await assertStageView(user, stage);
  /**
   * ★ 2026-10-22 批注：**不可删除有人的班级**
   *   原实现直接软删班级 —— 班里还有学生时，删完班级就没了，
   *   学生档案与花名册里会留下指向已删班级的孤儿记录。
   *
   * 【为什么在这里拦，而不在各仓储的 remove()】
   *   四个 repo 的 remove 只做一句 update，口径各异（jh/class 读 t_class_student、
   *   job/emp 读 t_job_class_student）。detail() 已经把「在读人数」算好了
   *   （base.studentCount，与列表「人数」列同源），复用它可以避免四份重复判断。
   *
   * 【为什么用 detail 现算，不信前端传的 studentCount】
   *   前端只是提前提示；真要删的时候必须由后端复算，否则改个请求就能删掉有人的班。
   *
   * 【合并上游时的取舍（2026-10-22）】
   *   上游同期也加了同一道闸（直接 count t_uni_student）。两版等价，
   *   保留本版：① 提示里带班级名与人数，和前端弹窗「不可删除有人的班级」同一句话；
   *   ② 人数口径走各仓储的 detail()，与列表「人数」列同源（emp/job 两套表都覆盖）。
   */
  const detail = await pick(stage).detail(id, user);
  if (!detail) throw new BizError(BizCode.PARAM_ERROR, '班级不存在或无权操作');
  const studentCount = Number(detail.base?.studentCount ?? 0);
  if (studentCount > 0) {
    throw new BizError(
      BizCode.PARAM_ERROR,
      `不可删除有人的班级：「${detail.base.className}」当前有 ${studentCount} 名学生，请先将学生转出或结业后再删除`,
    );
  }
  await pick(stage).remove(id, user?.userId || '');
}

/** 花名册 */
export async function listClassRoster(stage: ClassStage, id: string, user: any) {
  await assertStageView(user, stage);
  await assertClassInScope(stage, id, user, '该班级花名册');
  return pick(stage).roster(id, user);
}

/** 改状态 */
export async function changeClassStatus(
  stage: ClassStage,
  id: string,
  to: number,
  user: any,
): Promise<void> {
  await assertStageView(user, stage);
  await pick(stage).changeStatus(id, to, user?.userId || '');
}

/**
 * 元信息：**只返回当前账号可见学段的**特性
 *
 * 前端据此隐藏不适用的输入框：
 *   hasClassCode=false → 不显示「班级编号」
 *   hasCloseDate=false → 不显示「结业日期」
 *   classroomLabel     → 用仓储给的 label，别自己猜（大学叫"教室"、实训叫"教室地点"）
 */
export async function listClassMeta(user: any): Promise<ClassStageMeta[]> {
  const stages = await visibleStages(user);
  const [list, planOptions] = await Promise.all([
    Promise.all(stages.map((s) => REPOS[s].meta())),
    // ★ 2026-10-16 阶段方案：两个部门的方案都在 sms_class_jh 里，与学段无关
    loadStagePlanOptions(),
  ]);
  return list.map((m) => ({
    ...m,
    // ★ 2026-10-19：本部门方案里的阶段并进筛选下拉（就业部/实训 dept_code=3 共用一套）
    phaseOptions: mergePhaseOptions(m.stage, m.phaseOptions, planOptions),
    planOptions,
  }));
}

/* ★ 2026-10-20：原 listSchemeOptions（/api/teaching/class/scheme-options）已删除 ——
 *   它读的 t_class_stage_scheme / t_class_stage_scheme_stage 两张表从未建过
 *   （迁移从未执行），接口一进来就报「数据表不存在」。
 *   班级表单的「阶段方案 / 阶段」统一取上面 listClassMeta 下发的 planOptions，
 *   数据源 = t_class_stage_plan + t_class_stage（系统设置 · 阶段方案页维护的那套）。 */

/**
 * 班级下拉（供出勤/考试/成绩/学生等域复用）
 *
 * ⚠️ 已被 `shared/classOptions.ts` 承担（那是对**学生表**去重取班名），
 *    这里是**权威班级表**取数 —— 两者用途不同，别混用：
 *    classOptions = 给筛选下拉用（要含已解散的班）
 *    本函数 = 给"选班建班/转班"用（只给有效班）
 */
export async function listClassOptions(user: any) {
  const stages = await visibleStages(user);
  const out: Array<{
    stage: ClassStage;
    stageName: string;
    classId: string;
    className: string;
    classStatus: number;
    classStatusName: string;
  }> = [];
  for (const s of stages) {
    const rows = await REPOS[s].list({ stage: s, page: 1, size: 200 }, user);
    for (const r of rows) {
      out.push({
        stage: r.stage,
        stageName: r.stageName,
        classId: r.classId,
        className: r.className,
        classStatus: r.classStatus,
        classStatusName: r.classStatusName,
      });
    }
  }
  return out;
}

/** 班级编号生成（只有实训有；其它学段前端应隐藏该入口） */
export async function genClassCodeFor(stage: ClassStage): Promise<string | null> {
  if (stage === 'job') return repoJob.genClassCode();
  if (stage === 'emp') return repoEmp.genClassCode();
  return null;
}

/* ============================================================
 * 班级交接（2026-10-19 批注）
 *   一次交接 = 一个班把 5 个岗位（班主任/教员/助教/项目经理/就业老师）
 *   的现任换成新人；提交即生效，并留一条记录给班级详情看。
 *   初高没有后两个岗位 → 那两个岗位传什么都忽略。
 * ============================================================ */

/** 读某班的交接记录 */
export async function listClassHandovers(
  stage: ClassStage,
  classId: string,
  user: any,
): Promise<ClassHandoverRow[]> {
  await assertStageView(user, stage);
  return listHandovers(stage, classId);
}

const EMPTY_SLOT: StaffSlot = { id: null, name: null };

/**
 * 执行交接
 *
 * 【口径】
 *   · 前端只需传「要换的人」；没传的岗位视为不变（不是清空 —— 清空负责人只能用编辑班级）
 *   · 至少要换一个岗位，否则报错（防止点两下写出一条什么都没变的记录）
 *   · 交接日期为空 → 默认今天
 *   · 先改班级负责人，再写记录：改失败就不留记录
 */
export async function handoverClass(
  payload: ClassHandoverPayload,
  user: any,
): Promise<ClassHandoverRow> {
  const stage = assertStage(payload.stage);
  await assertStageView(user, stage);

  const classId = String(payload.classId ?? '').trim();
  if (!classId) throw new BizError(BizCode.PARAM_ERROR, '缺少班级ID');

  const detail = await pick(stage).detail(classId, user);
  if (!detail) throw new BizError(BizCode.CLASS_NOT_FOUND, '班级不存在或无权访问');
  const base = detail.base;

  // 初高的表没有项目经理/就业老师 → 这两个岗位不参与比较与保存
  const keys: RoleKey[] =
    stage === 'jh' ? ['headTeacher', 'teacher', 'assistant'] : [...HANDOVER_ROLES];

  const old: Record<RoleKey, StaffSlot> = {
    headTeacher: { id: base.headTeacherId, name: base.headTeacherName },
    teacher: { id: base.teacherId, name: base.teacherName },
    assistant: { id: base.assistantId, name: base.assistantName },
    projectManager: { id: base.projectManagerId, name: base.projectManagerName },
    employmentTeacher: { id: base.employmentTeacherId, name: base.employmentTeacherName },
  };

  const next: Record<RoleKey, StaffSlot> = { ...old };
  let changed = 0;
  for (const key of keys) {
    const picked = pickNew(payload, key);
    if (!picked.id && !picked.name) continue; // 没选 = 该岗位不变
    // 只传了 ID 没传姓名（其它调用方）→ 退回保留原名，避免详情里只剩裸 ID
    const name = picked.name || (picked.id === old[key].id ? old[key].name : null);
    next[key] = { id: picked.id, name };
    if (picked.id !== old[key].id || name !== old[key].name) changed += 1;
  }
  if (!changed) {
    throw new BizError(BizCode.PARAM_ERROR, '请至少更换一个岗位的负责人再提交交接');
  }

  const handoverDate =
    String(payload.handoverDate ?? '').trim().slice(0, 10) ||
    new Date().toISOString().slice(0, 10);
  const reason = String(payload.reason ?? '').trim().slice(0, 255) || null;
  const userId = user?.userId || '';
  const userName = user?.userName || '';

  // ① 改班级负责人（走各学段原有仓储；classStatus 不传 → 不触发状态机）
  const saveBody: ClassSaveBody = {
    stage,
    id: classId,
    className: base.className,
    deptCode: base.deptCode ?? undefined,
    phaseCode: base.phaseCode ?? undefined,
    headTeacherId: next.headTeacher.id,
    headTeacherName: next.headTeacher.name,
    teacherId: next.teacher.id,
    teacherName: next.teacher.name,
    assistantId: next.assistant.id,
    assistantName: next.assistant.name,
  };
  if (stage !== 'jh') {
    saveBody.projectManagerId = next.projectManager.id;
    saveBody.projectManagerName = next.projectManager.name;
    saveBody.employmentTeacherId = next.employmentTeacher.id;
    saveBody.employmentTeacherName = next.employmentTeacher.name;
  }
  await pick(stage).save(saveBody, userId);

  // ② 留痕（初高缺的两个岗位记空，前端也不展示）
  return insertHandover({
    stage,
    classId,
    className: base.className,
    deptCode: base.deptCode,
    old,
    next: {
      headTeacher: next.headTeacher,
      teacher: next.teacher,
      assistant: next.assistant,
      projectManager: stage === 'jh' ? EMPTY_SLOT : next.projectManager,
      employmentTeacher: stage === 'jh' ? EMPTY_SLOT : next.employmentTeacher,
    },
    handoverDate,
    reason,
    operatorId: userId || null,
    operatorName: userName || null,
  });
}
