/**
 * 共享：阶段方案（方案 + 阶段明细）只读取数
 * ============================================================
 *
 * 【为什么单独一个文件】
 *   学生档案的「阶段」筛选要**实时**跟随「系统设置 · 阶段方案」里配的阶段，
 *   而设置页写的是 `t_class_stage_scheme`（方案）+ `t_class_stage_scheme_stage`
 *   （方案下的阶段明细，阶段名称是自由文本、没有数字码）。
 *
 *   注意与 `stagePlans.ts` 区别：那个读的是**老的阶段字典**
 *   （`t_class_stage_plan` + `t_class_stage`，阶段带 int 码），
 *   给班级/学生**表单**的「阶段码」下拉用。两套表并存，别混。
 *
 * 【数据在哪】
 *   两个部门的方案都在初高库 `sms_class_jh` 里（历史如此，老阶段字典也一样）。
 */

import { db as classJhDb } from '../../class-jh/utils/db';
import type { SchemeStageOption } from './dto';

const SCHEME_T = 't_class_stage_scheme';
const STAGE_T = 't_class_stage_scheme_stage';

/** 学生学段 → 部门编码（jh 1 / class 2 / emp 3） */
export const SCHEME_DEPT_OF_STAGE: Record<string, number> = {
  jh: 1,
  class: 2,
  emp: 3,
};

/**
 * 读阶段方案下的全部阶段（可按部门过滤）
 *
 * 排序：部门 → 方案 sort_no → 阶段 sort_no，保证下拉顺序稳定（与设置页一致）。
 * 表没建好 / 库没起来时返回空数组 —— 前端会落到「未设置」，不白屏。
 */
export async function loadSchemeStageOptions(deptCode?: number): Promise<SchemeStageOption[]> {
  try {
    const q = classJhDb(SCHEME_T).where('is_deleted', false);
    if (deptCode) q.andWhere('dept_code', deptCode);
    const schemes = (await q
      .select('id', 'scheme_name', 'dept_code', 'sort_no')
      .orderBy('dept_code', 'asc')
      .orderBy('sort_no', 'asc')
      .orderBy('create_time', 'asc')) as Array<Record<string, any>>;
    if (!schemes.length) return [];

    const schemeMap = new Map<string, Record<string, any>>();
    for (const s of schemes) schemeMap.set(String(s.id), s);

    const stages = (await classJhDb(STAGE_T)
      .whereIn(
        'scheme_id',
        schemes.map((s) => s.id),
      )
      .where('is_deleted', false)
      .select('id', 'scheme_id', 'stage_name', 'study_months', 'sort_no')
      .orderBy('sort_no', 'asc')
      .orderBy('create_time', 'asc')) as Array<Record<string, any>>;

    const out: SchemeStageOption[] = [];
    for (const st of stages) {
      const sc = schemeMap.get(String(st.scheme_id));
      if (!sc) continue;
      out.push({
        id: String(st.id),
        name: String(st.stage_name ?? ''),
        schemeId: String(sc.id),
        schemeName: String(sc.scheme_name ?? ''),
        deptCode: Number(sc.dept_code),
        studyMonths: st.study_months === null || st.study_months === undefined ? null : Number(st.study_months),
        sortNo: Number(st.sort_no ?? 0),
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** 某学段所属部门的方案阶段（学段 → 部门 → 方案阶段） */
export async function loadSchemeStagesForStage(stage: string): Promise<SchemeStageOption[]> {
  const dept = SCHEME_DEPT_OF_STAGE[stage];
  if (!dept) return [];
  return loadSchemeStageOptions(dept);
}

/**
 * ★ 2026-10-22 部门 → 阶段码起始值（方案里第 1 个阶段对应的阶段码）
 *
 * 「阶段方案」里的阶段只有名称和 sort_no，没有数字码；而班级表 `stage_code`
 * 是 NOT NULL、且下游（学生档案/咨询分配班级/缴费台账）都按它判阶段。
 * 所以建班只选了方案阶段时，按 `起始值 + sort_no` 推导：
 *   初高部（dept=1）：预科 101 / 初中部1~3期 102~104 / 高中部1~3期 105~107
 *   大学部（dept=2）：一阶段~六阶段 201~206
 * 两张种子方案的阶段顺序与这套码恰好一一对应。
 */
export const FIRST_PHASE_OF_DEPT: Record<number, number> = { 1: 101, 2: 201 };

/**
 * 由「阶段方案阶段 id」推导阶段码
 *
 * @returns 推导不出（没选方案阶段 / 方案里找不到 / 越界）→ undefined，由调用方兜底
 *
 * ⚠️ 不要退回 `Object.keys(PHASE_NAME)[0]` 这类兜底：数字键按数值升序，
 *    大学部 PHASE_NAME 里 13（实训）比 201 小，取「第一个」会静默拿到实训。
 */
/**
 * ★ 2026-10-23：按「方案 + 阶段码」反查**方案里的阶段名**。
 *
 *   同一编码在不同方案里叫法不同（201 在全局字典叫「一阶段」，方案「大学2」里叫
 *   「拉丝机」）。班级绑定方案后要显示方案里的名字，保存时把名字一起落库
 *   （scheme_stage_name），列表按它显示。放服务端解析 → 前端漏传也能落对。
 */
export async function resolveSchemeStageName(
  schemeId: unknown,
  phaseCode: unknown,
): Promise<string | null> {
  const sid = String(schemeId ?? '').trim();
  const code = Number(phaseCode);
  if (!sid || !Number.isFinite(code)) return null;
  try {
    const row = (await classJhDb(STAGE_T)
      .where({ scheme_id: sid, stage_code: code, is_deleted: false })
      .first()) as Record<string, any> | undefined;
    const name = String(row?.stage_name ?? '').trim();
    return name || null;
  } catch {
    return null;
  }
}

export async function resolvePhaseCodeFromScheme(
  deptCode: unknown,
  schemeStageId: unknown,
): Promise<number | undefined> {
  const dept = Number(deptCode);
  const base = FIRST_PHASE_OF_DEPT[dept];
  const sid = String(schemeStageId ?? '').trim();
  if (!base || !sid) return undefined;
  try {
    const opts = await loadSchemeStageOptions(dept);
    const hit = opts.find((o) => o.id === sid);
    if (!hit) return undefined;
    const code = base + Number(hit.sortNo ?? 0);
    // 只接受本部门合法区间（初高 101~107 / 大学 201~206），越界视为推导失败
    return code >= base && code <= base + 9 ? code : undefined;
  } catch {
    return undefined;
  }
}
