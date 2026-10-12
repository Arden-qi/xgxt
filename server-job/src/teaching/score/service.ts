/**
 * 成绩适配器（Adapter）· 与出勤/考试域同构
 * ============================================================
 * ⚠️ 本域的权限码三套写法完全不同，不是简单加前缀：
 *     初高 classjh:score:view / 大学 class:grade:view / 实训 job:examScore:view
 */

import { BizCode } from 'shared-types';
import { BizError } from '../../middleware/errorHandler';
import * as repoClassJh from './repo.classJh';
import * as repoClass from './repo.class';
import * as repoJob from './repo.job';
import type {
  ScoreEntry,
  ScoreListQuery,
  ScoreRow,
  ScoreSaveBody,
  ScoreSummaryItem,
  TeachingStage,
} from '../shared/dto';
import { TEACHING_STAGE_NAME } from '../shared/dto';
import { assertStageCode, visibleStagesBy, type StageCodeMap } from '../shared/stageAccess';
import { getScoreFormula } from '../shared/conf';

type Repo = {
  list: (q: ScoreListQuery) => Promise<ScoreRow[]>;
  entry: (examId: string, classId: string) => Promise<ScoreEntry>;
  save: (b: ScoreSaveBody, userId: string) => Promise<{ saved: number }>;
};

const REPOS: Record<TeachingStage, Repo> = {
  jh: repoClassJh,
  class: repoClass,
  job: repoJob,
};

/** 各学段成绩页的权限码（★ 三套写法都不同，别想当然） */
const CODES: StageCodeMap = {
  jh: 'classjh:score:view',
  class: 'class:grade:view',
  job: 'job:examScore:view',
};
const LABEL = '成绩管理';

export function assertStageView(user: any, stage: TeachingStage): Promise<void> {
  return assertStageCode(user, stage, CODES, LABEL);
}
export function visibleStages(user: any): Promise<TeachingStage[]> {
  return visibleStagesBy(user, CODES, LABEL);
}

export async function listScores(
  q: ScoreListQuery,
  user: any,
): Promise<{ total: number; page: number; size: number; list: ScoreRow[] }> {
  const stages: TeachingStage[] = q.stage ? [q.stage] : await visibleStages(user);
  if (!stages.length) throw new BizError(BizCode.NO_OPERATION_PERMISSION, '没有成绩管理的访问权限');
  if (q.stage) await assertStageView(user, q.stage);

  const parts = await Promise.all(stages.map((s) => REPOS[s].list(q)));
  const merged = parts.flat();
  merged.sort((a, b) => (a.studentNo ?? '').localeCompare(b.studentNo ?? '', 'zh-Hans-CN'));

  const start = (q.page - 1) * q.size;
  return { total: merged.length, page: q.page, size: q.size, list: merged.slice(start, start + q.size) };
}

export async function getEntry(
  stage: TeachingStage,
  examId: string,
  classId: string,
  user: any,
): Promise<ScoreEntry> {
  await assertStageView(user, stage);
  return REPOS[stage].entry(examId, classId);
}

export async function saveScores(body: ScoreSaveBody, user: any) {
  await assertStageView(user, body.stage);
  if (!body.examId) throw new BizError(BizCode.PARAM_ERROR, '缺少考试ID');
  if (!body.rows?.length) throw new BizError(BizCode.PARAM_ERROR, '成绩数据不能为空');
  return REPOS[body.stage].save(body, user?.userId || 'system');
}

export async function scoreSummary(
  q: { stage?: TeachingStage; examId?: string; classId?: string },
  user: any,
): Promise<ScoreSummaryItem[]> {
  const stages: TeachingStage[] = q.stage ? [q.stage] : await visibleStages(user);
  if (q.stage) await assertStageView(user, q.stage);
  const formulas = await getScoreFormula();

  const out: ScoreSummaryItem[] = [];
  for (const s of stages) {
    const rows = await REPOS[s].list({ ...q, stage: s, page: 1, size: Number.MAX_SAFE_INTEGER });
    const entered = rows.filter((r) => r.totalScore !== null && r.totalScore !== undefined);
    const totalSum = entered.reduce((a, r) => a + Number(r.totalScore ?? 0), 0);
    const pass = rows.filter((r) => r.examResult === 1).length;
    const fail = rows.filter((r) => r.examResult === 2).length;
    out.push({
      stage: s,
      stageName: TEACHING_STAGE_NAME[s],
      totalStudents: rows.length,
      enteredCount: entered.length,
      avgTotal: entered.length ? Number((totalSum / entered.length).toFixed(2)) : 0,
      passCount: pass,
      failCount: fail,
      passRate: entered.length ? Number(((pass / entered.length) * 100).toFixed(2)) : 0,
    });
  }
  // formulas 仅用于确保配置可读（后续可按学段展示"口径说明"）
  void formulas;
  return out;
}
