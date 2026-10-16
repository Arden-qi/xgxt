/**
 * 共享：阶段方案取数（★ 2026-10-16 新增）
 * ============================================================
 *
 * 【背景】
 *   原「阶段字典」是一张平铺表（一行 = 一个阶段）。改版后一个**方案**可以包含
 *   多个**阶段**（方案名称 + 所属部门 + 若干「阶段名称 / 学制月数」）。
 *
 *   班级管理 / 学生档案的「阶段」下拉随之改成「先选方案，再选阶段」，
 *   所以这两个域的 meta 里要把方案清单一起下发。
 *
 * 【数据源】
 *   sms_class_jh.t_class_stage_plan（方案）+ sms_class_jh.t_class_stage（阶段，plan_id 关联）
 *   ⚠️ 初高部 / 大学部**两个部门**的方案都在这个库里（历史如此，原阶段字典也是）。
 *      所以本函数与「当前学段」无关，直接返回两个部门的全部方案。
 */

import { db as classJhDb } from '../../class-jh/utils/db';
import type { StagePlanOption } from './dto';

const PLAN_T = 't_class_stage_plan';
const STAGE_T = 't_class_stage';

/** 读全部阶段方案（含每个方案下的阶段，按 sort_no 排序） */
export async function loadStagePlanOptions(): Promise<StagePlanOption[]> {
  try {
    const plans = (await classJhDb(PLAN_T)
      .where('is_deleted', false)
      .select('id', 'plan_name', 'dept_code', 'sort_no')
      .orderBy('sort_no', 'asc')
      .orderBy('create_time', 'asc')) as Array<Record<string, any>>;

    const stages = (await classJhDb(STAGE_T)
      .where('is_deleted', false)
      .select('plan_id', 'stage_code', 'stage_name', 'sort_no')
      .orderBy('sort_no', 'asc')
      .orderBy('stage_code', 'asc')) as Array<Record<string, any>>;

    const byPlan = new Map<string, Array<{ value: number; label: string }>>();
    for (const s of stages) {
      const key = String(s.plan_id ?? '');
      if (!byPlan.has(key)) byPlan.set(key, []);
      byPlan.get(key)!.push({ value: Number(s.stage_code), label: String(s.stage_name ?? '') });
    }

    return plans.map((p) => ({
      id: String(p.id),
      name: String(p.plan_name ?? ''),
      deptCode: Number(p.dept_code),
      phases: byPlan.get(String(p.id)) ?? [],
    }));
  } catch {
    // 表还没建好 / 库没起来：静默降级（前端回落到 phaseOptions）
    return [];
  }
}
