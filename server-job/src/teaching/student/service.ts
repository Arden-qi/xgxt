/**
 * 学生档案适配器（Adapter）
 * ============================================================
 *
 * 【与前面几个域的适配器有两处不同】
 *   ① 学段是 **4 个**（多一个「教务/edu」）→ 权限校验用泛化版 `assertStageCodeEx`
 *   ② 合并时**必须按学号去重** —— 同一个人可能同时存在于多个库（影子表）；
 *      例如「大学 → 实训」升上来的人，class 库和 job 库各有一条。
 *      去重规则：保留**阶段更靠后**的那条（job > class > jh > edu）。
 *
 * 【「全部」= 统一页的默认视图 = 原来「教务」页提供的「全校总台账」能力】
 *   合并前只有教务页能看全校，所以它在页面里自己拼了三个库。
 *   现在统一页的「全部」就是这个能力，而且**去重逻辑统一在适配器里**，更准。
 */

import { BizCode } from 'shared-types';
import { BizError } from '../../middleware/errorHandler';
import * as repoClassJh from './repo.classJh';
import * as repoClass from './repo.class';
import * as repoJob from './repo.job';
import * as repoEdu from './repo.edu';
import type {
  StudentDetail,
  StudentListQuery,
  StudentRow,
  StudentSaveBody,
  StudentSaveResult,
  StudentStage,
  StudentStageMeta,
} from '../shared/dto';
import { STUDENT_DEDUP_PRIORITY, STUDENT_STAGES, STUDENT_STAGE_NAME } from '../shared/dto';
import { assertStageCodeEx, visibleStagesEx } from '../shared/stageAccess';
import { listClassesByStage } from '../shared/classOptions';
import { db } from '../../utils/db';
import { StudentStatus } from 'shared-types';
import type { StudentRepo, StudentStat } from './types';
import { assertStudentsInScope } from '../shared/dataScope';

const REPOS: Record<StudentStage, StudentRepo> = {
  jh: repoClassJh.repo,
  class: repoClass.repo,
  job: repoJob.repo,
  edu: repoEdu.repo,
};

/** 各学段学生档案页的权限码（= 合并前各学段原页面的权限码，一个都没改） */
const CODES: Record<StudentStage, string | string[]> = {
  jh: 'classjh:student:view',
  class: 'class:student:view',
  /* ★ 2026-10-15：job 学段有**两个等价权限码**，任一即可 ——
   *   · `job:empArchive:view`     就业老师（就业信息档案）
   *   · `job:classStudent:view`   项目经理（实训-班级学生）
   *   业务上「项目经理 = 实训阶段的班主任」（斌哥明确），他必须能进「学生档案」，
   *   但他手里只有 classStudent，原先只认 empArchive → 学段可见性为空 → 403。 */
  job: ['job:empArchive:view', 'job:classStudent:view'],
  edu: 'edu:student:view',
};

/** 各学段所属门户模块（与全站 moduleOfPageCode 口径一致） */
const MODULE: Record<StudentStage, string> = {
  jh: 'class-jh',
  class: 'class',
  job: 'job',
  edu: 'edu',
};

const LABEL = '学生档案';

const nameOf = (s: StudentStage): string => STUDENT_STAGE_NAME[s];
const moduleOf = (s: StudentStage): string => MODULE[s];

export function assertStageView(user: any, stage: StudentStage): Promise<void> {
  return assertStageCodeEx(user, stage, CODES, LABEL, nameOf, moduleOf);
}

export function visibleStages(user: any): Promise<StudentStage[]> {
  return visibleStagesEx(user, STUDENT_STAGES, CODES, LABEL, nameOf, moduleOf);
}

/* ============================================================
 * 合并 + 去重（列表与统计共用同一份，保证「卡片 = 列表」）
 * ============================================================ */

async function mergedRows(
  q: StudentListQuery,
  user: any,
): Promise<{ rows: StudentRow[]; stages: StudentStage[] }> {
  const stages: StudentStage[] = q.stage ? [q.stage] : await visibleStages(user);
  if (!stages.length) throw new BizError(BizCode.NO_OPERATION_PERMISSION, '没有学生档案的访问权限');
  if (q.stage) await assertStageView(user, q.stage);

  const parts = await Promise.all(stages.map((s) => REPOS[s].list(q, user)));
  let rows = parts.flat();

  // 单学段查询不需要去重（同一张表内学号本就唯一）
  if (stages.length > 1) rows = dedupeByStudentNo(rows);

  rows.sort((a, b) => {
    const ta = a.createTime || '';
    const tb = b.createTime || '';
    if (ta !== tb) return ta < tb ? 1 : -1;
    return a.studentNo.localeCompare(b.studentNo, 'zh-Hans-CN');
  });
  return { rows, stages };
}

/**
 * 按学号去重：同学号保留**阶段更靠后**的那条
 *
 * ⚠️ 学号为空的记录**不参与去重**（不聚合无号的行，否则会把不同的人并成一条）
 */
function dedupeByStudentNo(rows: StudentRow[]): StudentRow[] {
  const rank = (s: StudentStage): number => {
    const i = STUDENT_DEDUP_PRIORITY.indexOf(s);
    return i < 0 ? STUDENT_DEDUP_PRIORITY.length : i;
  };
  const best = new Map<string, StudentRow>();
  const noNo: StudentRow[] = [];
  for (const r of rows) {
    const key = (r.studentNo || '').trim();
    if (!key) {
      noNo.push(r);
      continue;
    }
    const cur = best.get(key);
    if (!cur || rank(r.stage) < rank(cur.stage)) best.set(key, r);
  }
  return [...best.values(), ...noNo];
}

/* ============================================================
 * 对外能力
 * ============================================================ */

export async function listStudents(
  q: StudentListQuery,
  user: any,
): Promise<{ total: number; page: number; size: number; list: StudentRow[] }> {
  const { rows } = await mergedRows(q, user);
  const start = (q.page - 1) * q.size;
  return { total: rows.length, page: q.page, size: q.size, list: rows.slice(start, start + q.size) };
}

export async function summaryStudents(q: StudentListQuery, user: any): Promise<StudentStat> {
  const { rows } = await mergedRows({ ...q, page: 1, size: Number.MAX_SAFE_INTEGER }, user);
  const out: StudentStat = {
    total: rows.length,
    studying: 0,
    trial: 0,
    suspended: 0,
    quit: 0,
    unassigned: 0,
  };
  for (const r of rows) {
    if (r.studentStatus === StudentStatus.STUDYING) out.studying += 1;
    if (r.studentStatus === StudentStatus.TRIAL) out.trial += 1;
    if (r.studentStatus === StudentStatus.SUSPENDED) out.suspended += 1;
    if (r.studentStatus === StudentStatus.QUIT) out.quit += 1;
    if (!r.dormId || !r.dormNo) out.unassigned += 1;
  }
  return out;
}

export async function getStudentDetail(
  stage: StudentStage,
  id: string,
  user: any,
): Promise<StudentDetail> {
  await assertStageView(user, stage);
  /* edu（教务）不是带班概念，不做班级级范围 */
  if (stage !== 'edu') await assertStudentsInScope(stage as any, [id], user, '该学生');
  const d = await REPOS[stage].detail(id, user);
  if (!d) throw new BizError(BizCode.STUDENT_NOT_FOUND, '学生不存在或没有访问权限');
  return d;
}

export async function saveStudent(body: StudentSaveBody, user: any): Promise<StudentSaveResult> {
  await assertStageView(user, body.stage);
  if (!body.studentName?.trim()) throw new BizError(BizCode.PARAM_ERROR, '姓名必填');
  if (!body.gender) throw new BizError(BizCode.PARAM_ERROR, '性别必填');
  // 大学 / 就业 的 dept_code 是必填列，缺了会撞数据库约束 —— 提前给出可读报错
  if (body.stage !== 'jh' && !body.deptCode) {
    throw new BizError(BizCode.PARAM_ERROR, `${STUDENT_STAGE_NAME[body.stage]}学段「部门」必填`);
  }
  try {
    return await REPOS[body.stage].save(body, user?.userId || 'system');
  } catch (e) {
    // 仓储抛的 Error 多为「学号已存在」这类业务校验 → 转成 40302/400 让前端能显示原文
    const msg = (e as Error).message || '保存失败';
    if (/学号/.test(msg)) throw new BizError(BizCode.STUDENT_NO_EXISTS, msg);
    throw new BizError(BizCode.PARAM_ERROR, msg);
  }
}

export async function removeStudent(
  stage: StudentStage,
  id: string,
  user: any,
): Promise<void> {
  await assertStageView(user, stage);
  await REPOS[stage].remove(id, user?.userId || 'system');
}

/** 元信息：每个可见学段支持的阶段码与特有区块（前端据此渲染筛选项与页签） */
export async function listStageMeta(user: any): Promise<StudentStageMeta[]> {
  const stages = await visibleStages(user);
  const out: StudentStageMeta[] = [];
  for (const s of stages) {
    const repo = REPOS[s];
    out.push({
      stage: s,
      stageName: STUDENT_STAGE_NAME[s],
      phaseOptions: await repo.phaseOptions(),
      sections: repo.sections,
      supportUnassigned: repo.supportUnassigned,
    });
  }
  return out;
}

/* ============================================================
 * 班级下拉（四学段）
 * ============================================================
 * 前三个学段直接复用共享的 `listClassesByStage`（三个学段的班级表各不相同）；
 * 「教务」没有自己的班级表（它按学生表里出现过的 class_id/class_name 去重取），
 * 所以这里单独补一段 —— 这是四个学段里唯一「班级不来自班级表」的那个。
 */
export interface StudentClassOption {
  stage: StudentStage;
  stageName: string;
  id: string;
  name: string;
}

export async function listStudentClasses(user: any): Promise<StudentClassOption[]> {
  const stages = await visibleStages(user);
  const out: StudentClassOption[] = [];
  for (const s of stages) {
    if (s === 'edu') {
      const rows = (await db('sms_edu.t_student_base')
        .where('is_deleted', false)
        .whereNotNull('class_id')
        .where('class_id', '<>', '')
        .distinct('class_id', 'class_name')) as Array<Record<string, any>>;
      for (const r of rows) {
        out.push({
          stage: s,
          stageName: STUDENT_STAGE_NAME[s],
          id: String(r.class_id),
          name: String(r.class_name ?? ''),
        });
      }
      continue;
    }
    for (const c of await listClassesByStage(s)) {
      out.push({ stage: s, stageName: STUDENT_STAGE_NAME[s], id: c.id, name: c.name });
    }
  }
  return out;
}

export { STUDENT_STAGES };
