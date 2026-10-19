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
import type {
  ClassListQuery,
  ClassRow,
  ClassSaveBody,
  ClassStageMeta,
  ClassSummary,
  TeachingStage,
} from '../shared/dto';
import { TEACHING_STAGES, TEACHING_STAGE_NAME } from '../shared/dto';
import { assertStageCode, visibleStagesBy } from '../shared/stageAccess';
import type { ClassDetail, ClassRepo } from './types';
import { listSchemes, type StageSchemeItem } from '../../class-jh/utils/stageScheme';

const REPOS: Record<TeachingStage, ClassRepo> = {
  jh: repoClassJh.repo,
  class: repoClass.repo,
  job: repoJob.repo,
};

/** 各学段班级页的权限码 */
const CODES: Record<TeachingStage, string> = {
  jh: 'classjh:classInfo:view',
  class: 'class:info:view',
  job: 'job:class:view',
};

const LABEL = '班级信息';

export function assertStageView(user: any, stage: TeachingStage): Promise<void> {
  return assertStageCode(user, stage, CODES, LABEL);
}

export function visibleStages(user: any): Promise<TeachingStage[]> {
  return visibleStagesBy(user, CODES, LABEL);
}

function pick(stage: TeachingStage): ClassRepo {
  const r = REPOS[stage];
  if (!r) throw new BizError(BizCode.PARAM_ERROR, `stage 只能是 jh / class / job`);
  return r;
}

/** 校验 stage 合法 */
export function assertStage(v: unknown): TeachingStage {
  if (v !== 'jh' && v !== 'class' && v !== 'job') {
    throw new BizError(BizCode.PARAM_ERROR, 'stage 只能是 jh / class / job');
  }
  return v;
}

function optStage(v: unknown): TeachingStage | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  return assertStage(v);
}

/* ============================================================
 * 列表（合并 + 分页；统计与列表共用 mergedRows，保证「卡片 = 列表」）
 * ============================================================ */

async function mergedRows(
  q: ClassListQuery,
  user: any,
): Promise<{ rows: ClassRow[]; stages: TeachingStage[] }> {
  const stages: TeachingStage[] = q.stage ? [q.stage] : await visibleStages(user);
  if (!stages.length) throw new BizError(BizCode.NO_OPERATION_PERMISSION, '没有班级信息的访问权限');
  if (q.stage) await assertStageView(user, q.stage);

  const parts = await Promise.all(stages.map((s) => REPOS[s].list(q, user)));
  let rows = parts.flat();

  // 学段顺序固定（初高 → 大学 → 实训），再按创建时间倒序
  rows.sort((a, b) => {
    const sa = TEACHING_STAGES.indexOf(a.stage);
    const sb = TEACHING_STAGES.indexOf(b.stage);
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
): Promise<{ list: ClassRow[]; total: number; page: number; size: number; stages: TeachingStage[] }> {
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
  const stages: TeachingStage[] = q.stage ? [q.stage] : await visibleStages(user);
  if (!stages.length) return [];
  if (q.stage) await assertStageView(user, q.stage);

  // 逐学段统计（每个仓储自己算，口径与它自己的 list 一致）
  return Promise.all(stages.map((s) => REPOS[s].summary(q, user)));
}

/** 详情 */
export async function getClassDetail(
  stage: TeachingStage,
  id: string,
  user: any,
): Promise<ClassDetail | null> {
  await assertStageView(user, stage);
  return pick(stage).detail(id, user);
}

/** 保存 */
export async function saveClass(body: ClassSaveBody, user: any): Promise<{ id: string }> {
  await assertStageView(user, body.stage);
  return pick(body.stage).save(body, user?.userId || '');
}

/** 删除 */
export async function removeClass(stage: TeachingStage, id: string, user: any): Promise<void> {
  await assertStageView(user, stage);
  await pick(stage).remove(id, user?.userId || '');
}

/** 花名册 */
export async function listClassRoster(stage: TeachingStage, id: string, user: any) {
  await assertStageView(user, stage);
  return pick(stage).roster(id, user);
}

/** 改状态 */
export async function changeClassStatus(
  stage: TeachingStage,
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
  return Promise.all(stages.map((s) => REPOS[s].meta()));
}

/**
 * ★ 2026-10-16：阶段方案选项（班级表单的「阶段方案 / 阶段」两个下拉）
 *
 * 方案数据存在初高库（sms_class_jh）的 t_class_stage_scheme，
 * 但按部门区分（1 初高部 / 2 大学部）—— 三个学段的班级表单都取这一份，
 * 前端按表单里选中的「部门」过滤，选完方案后「阶段」下拉 = 该方案的阶段明细。
 */
export async function listSchemeOptions(user: any): Promise<StageSchemeItem[]> {
  const stages = await visibleStages(user);
  if (!stages.length) {
    throw new BizError(BizCode.NO_OPERATION_PERMISSION, '没有班级信息的访问权限');
  }
  return listSchemes();
}

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
    stage: TeachingStage;
    stageName: string;
    classId: string;
    className: string;
    classStatus: number;
    classStatusName: string;
  }> = [];
  for (const s of stages) {
    const rows = await REPOS[s].list({ stage: s, page: 1, size: 200 }, user);
    for (const r of rows) {
      // 已结业的班不作为「可转入」选项
      if (r.classStatus === 4) continue;
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
export async function genClassCodeFor(stage: TeachingStage): Promise<string | null> {
  if (stage !== 'job') return null;
  return repoJob.genClassCode();
}

/** 学段名（给接口回显用） */
export { TEACHING_STAGE_NAME };