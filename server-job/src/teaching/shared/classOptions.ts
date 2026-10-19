/**
 * 共享：统一班级下拉
 * ============================================================
 *
 * 【为什么提到 shared】
 *   出勤域先做了「班级下拉」，考试域、成绩域、退费域……**每个域都要**。
 *   如果不提出来，每个域各写一遍 → 又变成新的重复（我们正在消灭的那种）。
 *
 * 【它做的事】
 *   三个学段的班级表不同（初高/大学都叫 t_class_info 但在不同库，
 *   实训叫 t_job_class），这里统一成 {stage, stageName, id, name}。
 */

import { db as classJhDb } from '../../class-jh/utils/db';
import { db as classDb } from '../../class/db';
import { db as jobDb } from '../../utils/db';
import { tbl } from './uniTable';
import type { TeachingStage } from './dto';
import { TEACHING_STAGE_NAME } from './dto';

export interface ClassOption {
  stage: TeachingStage;
  stageName: string;
  id: string;
  name: string;
  /**
   * ★ 2026-10-16：带上班级的「部门」和「阶段」，供学生档案在选了班级后
   *   自动带出「部门 / 阶段」（跟随学生所在班级）。
   */
  deptCode?: number;
  phaseCode?: number;
}

/** 三张班级表都有 dept_code / stage 两列，统一取出来 */
const pick = (r: any) => ({
  id: String(r.id),
  name: String(r.name ?? ''),
  deptCode: r.dept_code === null || r.dept_code === undefined ? undefined : Number(r.dept_code),
  phaseCode: r.stage === null || r.stage === undefined ? undefined : Number(r.stage),
});

/**
 * 取某学段的班级列表
 *
 * ★ 第 4 期步骤 2：改走 `tbl()` 路由（开关开=读统一表）
 *   这个函数被出勤/考试/成绩/退费/宿舍五个域共用，
 *   班级下拉取不到数据 → 五个域的界面同时空掉，
 *   所以它是切读的关键一环，不能漏。
 */
export async function listClassesByStage(
  stage: TeachingStage | 'emp',
): Promise<Array<{ id: string; name: string; deptCode?: number; phaseCode?: number }>> {
  if (stage === 'jh') {
    const rows = (await tbl(classJhDb, 'sms_class_jh', 't_class_info', stage)
      .where('is_deleted', 0)
      .select('id', 'class_name as name', 'dept_code', 'stage')) as Array<{ id: string; name: string }>;
    return rows.map(pick);
  }
  if (stage === 'class') {
    const rows = (await tbl(classDb, 'sms_class', 't_class_info', stage)
      .where('is_deleted', 0)
      .select('id', 'class_name as name', 'dept_code', 'stage')) as Array<{ id: string; name: string }>;
    return rows.map(pick);
  }
  // ★ 2026-10-19：实训与就业部共用 t_job_class、dept 都是 3，靠 stage_key 区分
  const qb = tbl(jobDb, 'sms_job', 't_job_class', stage).where('is_deleted', 0);
  qb.andWhere('stage_key', stage === 'emp' ? 'emp' : 'job');
  const rows = (await qb.select('id', 'class_name as name', 'dept_code', 'stage')) as Array<{
    id: string;
    name: string;
  }>;
  return rows.map(pick);
}

/** 取多个学段的班级，打上学段标签 */
export async function listClassesOfStages(stages: TeachingStage[]): Promise<ClassOption[]> {
  const out: ClassOption[] = [];
  for (const s of stages) {
    for (const c of await listClassesByStage(s)) {
      out.push({ stage: s, stageName: TEACHING_STAGE_NAME[s], id: c.id, name: c.name });
    }
  }
  return out;
}

/** 按 id 反查班级名（同一时刻只在给定学段里找） */
export async function classNameOf(stage: TeachingStage, classId: string): Promise<string> {
  const list = await listClassesByStage(stage);
  return list.find((c) => c.id === classId)?.name ?? '';
}
