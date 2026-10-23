/**
 * 共享：阶段方案取数（★ 2026-10-16 新增，2026-10-22 改读带编码的新模型）
 * ============================================================
 *
 * 【背景】
 *   原「阶段字典」是一张平铺表（一行 = 一个阶段）。改版后一个**方案**可以包含
 *   多个**阶段**（方案名称 + 所属部门 + 若干「阶段名称 / 学制 / 阶段编码」）。
 *
 *   班级管理 / 学生档案的「阶段」下拉随之改成「先选方案，再选阶段」，
 *   所以这两个域的 meta 里要把方案清单一起下发。
 *
 * 【数据源（2026-10-22 起）】
 *   sms_class_jh.t_class_stage_scheme（方案）
 *   sms_class_jh.t_class_stage_scheme_stage（阶段明细，自带 stage_code）
 *   ⚠️ 初高 / 大学 / 就业**三个部门**的方案都在这两张表里（初高库），
 *      所以本函数与「当前学段」无关，直接返回全部方案，由调用方按 deptCode 过滤。
 *
 *   旧的 t_class_stage_plan（方案）+ t_class_stage.plan_id（关联）已不再读 ——
 *   那套接口 2026-10-22 整套删除，t_class_stage 只剩「编码 → 中文名」字典用途。
 */

import { db as classJhDb } from '../../class-jh/utils/db';
import type { StagePlanOption } from './dto';

/* ★ 2026-10-21：改读「设置页真正在写」的新模型
 *   旧实现读的是 t_class_stage_plan + t_class_stage.plan_id，
 *   而 P8 已把阶段字典归一成 t_uni_stage_def、方案改版成
 *   t_class_stage_scheme(+_stage) —— 旧表早就不存在，导致方案下拉恒空、
 *   就业部/实训的阶段选项一个都出不来。
 *
 * ★ 2026-10-22：阶段编码改成【读方案明细自带的 stage_code】
 *   原来靠「阶段名称」去 t_uni_stage_def 反查编码，查不到就 `continue` 丢掉 ——
 *   用户填「实训」「1」这种字典里没有的名字，整条阶段就被静默吞掉：
 *     · 班级表单选完方案后「阶段」下拉是空的
 *     · 班级管理点「升实训」，就业部阶段显示「无数据」
 *   现在方案明细自己带编码（保存时分配并回填），这里直接取；
 *   只有历史数据没编码时才回退到「按名称查旧字典 t_class_stage」。
 */
const SCHEME_T = 't_class_stage_scheme';
const SCHEME_STAGE_T = 't_class_stage_scheme_stage';
/** 旧阶段字典：名称 → 编码（仅在方案明细没有 stage_code 时兜底） */
const STAGE_DICT_T = 't_class_stage';

/** 读全部阶段方案（含每个方案下的阶段，按 sort_no 排序） */
export async function loadStagePlanOptions(): Promise<StagePlanOption[]> {
  try {
    const plans = (await classJhDb(SCHEME_T)
      .where('is_deleted', false)
      .select('id', 'scheme_name', 'dept_code', 'sort_no')
      .orderBy('sort_no', 'asc')
      .orderBy('create_time', 'asc')) as Array<Record<string, any>>;
    if (!plans.length) return [];

    const stages = (await classJhDb(SCHEME_STAGE_T)
      .where('is_deleted', false)
      .select('scheme_id', 'stage_name', 'stage_code', 'sort_no')
      .orderBy('sort_no', 'asc')) as Array<Record<string, any>>;

    const deptOfPlan = new Map<string, number>();
    for (const p of plans) deptOfPlan.set(String(p.id), Number(p.dept_code));

    /* 兜底用：老字典里 (部门, 阶段名) → 编码。
       ⚠️ 只对 stage_code 为空的旧行生效；新保存的方案都带编码。 */
    const nameToCode = new Map<string, number>();
    try {
      const dict = (await classJhDb(STAGE_DICT_T)
        .where('is_deleted', false)
        .select('dept_code', 'stage_code', 'stage_name')) as Array<Record<string, any>>;
      for (const d of dict) {
        nameToCode.set([String(Number(d.dept_code)), String(d.stage_name ?? '').trim()].join('|'), Number(d.stage_code));
      }
    } catch {
      /* 字典表缺失：没有编码的旧行会被跳过，不影响新数据 */
    }

    const byPlan = new Map<string, Array<{ value: number; label: string }>>();
    for (const s of stages) {
      const schemeId = String(s.scheme_id ?? '');
      const name = String(s.stage_name ?? '');
      const dept = deptOfPlan.get(schemeId);
      if (!dept) continue;

      let code = s.stage_code === null || s.stage_code === undefined ? NaN : Number(s.stage_code);
      if (!Number.isFinite(code)) code = nameToCode.get([String(dept), name.trim()].join('|')) ?? NaN;
      if (!Number.isFinite(code)) continue;

      if (!byPlan.has(schemeId)) byPlan.set(schemeId, []);
      byPlan.get(schemeId)!.push({ value: code, label: name });
    }

    return plans.map((p) => ({
      id: String(p.id),
      name: String(p.scheme_name ?? ''),
      deptCode: Number(p.dept_code),
      phases: byPlan.get(String(p.id)) ?? [],
    }));
  } catch {
    // 表还没建好 / 库没起来：静默降级（前端回落到 phaseOptions）
    return [];
  }
}

/** 学段 → 部门编码（jh 1 / class 2；★ 实训与就业部共用 3） */
const STAGE_DEPT_CODE: Record<string, number> = { jh: 1, class: 2, job: 3, emp: 3 };

/**
 * ★ 2026-10-19 就业部接入阶段方案：把「本部门方案里的阶段」作为 meta.phaseOptions
 *
 * 【口径】方案表是唯一权威，四个部门一视同仁（就业部/实训共用 dept_code=3）。
 *   只有在本部门一套方案都没有时（表没建好 / 还没配）才回落到仓储常量，
 *   且只留本部门段位的编码（1xx / 2xx / 3xx）——
 *   ⚠️ 仓储常量是**全量字典**（jh 的清单里也有 201~204），直接并进来会出现
 *   「初高部能筛到大学部阶段」，所以必须按段位过滤，不能整份并。
 */
export function mergePhaseOptions(
  stage: string,
  baseOptions: Array<{ value: number; label: string }> | undefined,
  planOptions: StagePlanOption[],
): Array<{ value: number; label: string }> {
  const deptCode = STAGE_DEPT_CODE[stage];
  const fromPlans = planOptions.filter((p) => p.deptCode === deptCode).flatMap((p) => p.phases);
  if (fromPlans.length) return fromPlans;
  const base = deptCode === 1 ? 100 : deptCode === 2 ? 200 : 300;
  return (baseOptions ?? []).filter((p) => p.value >= base && p.value < base + 100);
}
