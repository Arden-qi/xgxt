/**
 * 阶段方案读写（t_class_stage_scheme + t_class_stage_scheme_stage）
 * ============================================================
 *
 * 【是什么】原「阶段字典」（一条记录 = 一个阶段）升级为「阶段方案」：
 *   一个方案 = 方案名称 + 所属部门 + N 个阶段（阶段名称 + 学制月数）。
 *   例：方案一（初高部）→ 一阶段 学制2月 / 二阶段 学制2月 / 三阶段 学制2月。
 *
 * 【谁在用】
 *   ① 教学管理 · 系统设置 · 阶段方案页（class-jh/setting.route.ts，增删改查）
 *   ② 统一班级页的表单（teaching/class/*，只读方案选项给「阶段方案 / 阶段」两个下拉）
 *   ③ 实训/大学部的班级表单同样复用 ② 的接口 —— 方案虽然存在初高库里，
 *      但按部门区分（1 初高部 / 2 大学部），三个学段各自只看到本部门的方案。
 *
 * 【删除保护】方案被班级引用时禁止删除：三张班级表（初高/大学/实训）都查一遍。
 *   跨库查询用裸 SQL + try/catch —— 某张表不存在（未部署该学段）时跳过，不误伤。
 */

import { randomUUID } from 'crypto';
import { BizCode, DEPT_NAME } from 'shared-types/class-jh';
import { BizError } from '../middleware/errorHandler';
import { db } from './db';
import { refreshStageDict } from './stageDict';

const SCHEME_TABLE = 't_class_stage_scheme';
const SCHEME_STAGE_TABLE = 't_class_stage_scheme_stage';
/** 旧「阶段字典」表 —— 只用来存「编码 → 中文名」，随方案保存自动同步 */
const STAGE_DICT_TABLE = 't_class_stage';

/** 各部门的阶段号段起点（1xx 初高 / 2xx 大学 / 3xx 就业） */
const BASE_OF_DEPT: Record<number, number> = { 1: 100, 2: 200, 3: 300 };

/** 方案被哪些班级表引用（跨库） */
const CLASS_TABLES = ['sms_class_jh.t_class_info', 'sms_class.t_class_info', 'sms_job.t_job_class'];

/* ============================================================
 * 类型
 * ============================================================ */

/** 方案下的阶段明细（回给前端） */
export interface SchemeStageItem {
  id: string;
  stageName: string;
  /**
   * 阶段编码（1xx 初高 / 2xx 大学 / 3xx 就业）
   *
   * ★ 2026-10-22：班级 / 学生表的 `stage` 存的就是这个编码。
   *   以前这里没有编码，靠「阶段名称」去字典里反查，
   *   用户自定义的名字（实训、1…）查不到就被丢掉 →
   *   班级表单的阶段下拉为空、升实训显示「无数据」。
   */
  stageCode: number | null;
  /** 学制月数 */
  studyMonths: number | null;
  sortNo: number;
}

/** 阶段方案（含阶段明细） */
export interface StageSchemeItem {
  id: string;
  schemeName: string;
  deptCode: number;
  deptName: string;
  stages: SchemeStageItem[];
}

/** 方案保存入参（新增 / 修改共用；修改时阶段明细整体覆盖） */
export interface StageSchemeSaveInput {
  schemeName: string;
  deptCode: number;
  /**
   * stageCode 可选：前端一般不用传，后端按「同名沿用 → 原位置沿用 → 字典同名 → 号段分配」
   * 自己算；传了就以此为准（给以后的「手动指定阶段码」留口子）。
   */
  stages: Array<{ stageName: string; studyMonths?: number | null; stageCode?: number | null }>;
}

/* ============================================================
 * 工具
 * ============================================================ */

function mapStage(r: Record<string, any>): SchemeStageItem {
  return {
    id: String(r.id),
    stageName: String(r.stage_name ?? ''),
    stageCode: r.stage_code === null || r.stage_code === undefined ? null : Number(r.stage_code),
    studyMonths: r.study_months === null || r.study_months === undefined ? null : Number(r.study_months),
    sortNo: Number(r.sort_no ?? 0),
  };
}

function mapScheme(r: Record<string, any>, stages: SchemeStageItem[]): StageSchemeItem {
  const deptCode = Number(r.dept_code);
  return {
    id: String(r.id),
    schemeName: String(r.scheme_name ?? ''),
    deptCode,
    deptName: DEPT_NAME[deptCode] ?? '',
    stages,
  };
}

/** 同部门下方案名是否重复（排除指定 id，供修改时用） */
async function nameDuplicated(schemeName: string, deptCode: number, excludeId?: string): Promise<boolean> {
  const q = db(SCHEME_TABLE).where({ scheme_name: schemeName, dept_code: deptCode, is_deleted: false });
  if (excludeId) q.andWhereNot('id', excludeId);
  const row = await q.first();
  return !!row;
}

/* ============================================================
 * 读
 * ============================================================ */

/** 方案列表（含阶段明细），可按部门筛选 */
export async function listSchemes(deptCode?: number): Promise<StageSchemeItem[]> {
  const q = db(SCHEME_TABLE).where('is_deleted', false);
  if (deptCode) q.andWhere('dept_code', deptCode);
  const schemes = await q.orderBy('dept_code', 'asc').orderBy('sort_no', 'asc').orderBy('create_time', 'asc');
  if (!schemes.length) return [];

  const stages = await db(SCHEME_STAGE_TABLE)
    .whereIn('scheme_id', schemes.map((s: any) => s.id))
    .where('is_deleted', false)
    .orderBy('sort_no', 'asc')
    .orderBy('create_time', 'asc');

  const byScheme = new Map<string, SchemeStageItem[]>();
  for (const s of stages) {
    const key = String(s.scheme_id);
    if (!byScheme.has(key)) byScheme.set(key, []);
    byScheme.get(key)!.push(mapStage(s));
  }

  return schemes.map((s: any) => mapScheme(s, byScheme.get(String(s.id)) ?? []));
}

/** 方案详情（含阶段明细） */
export async function getScheme(id: string): Promise<StageSchemeItem | null> {
  const r = await db(SCHEME_TABLE).where({ id, is_deleted: false }).first();
  if (!r) return null;
  const stages = await db(SCHEME_STAGE_TABLE)
    .where({ scheme_id: id, is_deleted: false })
    .orderBy('sort_no', 'asc')
    .orderBy('create_time', 'asc');
  return mapScheme(r, stages.map(mapStage));
}

/* ============================================================
 * 写
 * ============================================================ */

/**
 * 读某部门的旧阶段字典：名称 → 编码、以及该部门已占用的编码集合
 *
 * 【为什么要读它】
 *   阶段编码沿用的是老约定（101 预科 / 102 初中部1期 / 201 一阶段 / 301 …）。
 *   用户在新方案里填「预科」这种和字典同名的阶段时，必须复用 101，
 *   否则历史上按 101 存的班级/学生会跟新编码错位。
 */
async function loadDeptDict(deptCode: number): Promise<{
  nameToCode: Map<string, number>;
  usedCodes: Set<number>;
}> {
  const nameToCode = new Map<string, number>();
  const usedCodes = new Set<number>();
  try {
    const rows = (await db(STAGE_DICT_TABLE)
      .where({ dept_code: deptCode, is_deleted: false })
      .select('stage_code', 'stage_name')) as Array<Record<string, any>>;
    for (const r of rows) {
      const code = Number(r.stage_code);
      if (!Number.isFinite(code)) continue;
      usedCodes.add(code);
      const name = String(r.stage_name ?? '').trim();
      if (name) nameToCode.set(name, code);
    }
  } catch {
    /* 字典表缺失：退化成「按号段分配」 */
  }
  return { nameToCode, usedCodes };
}

/** 保证「编码 → 名称」在旧字典里有记录（新分配的号码才能显示出中文名） */
async function ensureDictRow(
  deptCode: number,
  code: number,
  stageName: string,
  studyMonths: number | null,
  userId: string,
): Promise<void> {
  try {
    const existed = (await db(STAGE_DICT_TABLE)
      .where({ dept_code: deptCode, stage_code: code })
      .first()) as Record<string, any> | undefined;
    const now = new Date();
    if (existed) {
      if (String(existed.stage_name ?? '') !== stageName) {
        await db(STAGE_DICT_TABLE).where({ id: existed.id }).update({
          stage_name: stageName,
          update_time: now,
          update_by: userId || 'system',
        });
      }
      return;
    }
    await db(STAGE_DICT_TABLE).insert({
      id: randomUUID(),
      stage_code: code,
      stage_name: stageName,
      dept_code: deptCode,
      study_months: studyMonths,
      sort_no: 0,
      plan_id: null,
      is_deleted: false,
      create_time: now,
      create_by: userId || 'system',
    });
  } catch {
    /* 字典写失败不影响方案本身：方案明细里已经存了编码 */
  }
}

/**
 * 给方案里的每个阶段分配阶段编码
 *
 * 顺序（★ 2026-10-22 用户口径 + 兼容历史数据的取舍）：
 *   ① 入参显式给了 stageCode → 用它
 *   ② 同名沿用：这个方案里原来就有同名阶段 → 用原编码（改名不影响）
 *   ③ 原位置沿用：第 i 个阶段原来有编码 → 沿用（改了名字、位置没动）
 *   ④ 字典同名：本部门字典里有同名阶段 → 复用（预科 → 101）
 *   ⑤ 号段分配：本部门号段（1xx/2xx/3xx）里第一个没被字典占用、本次也没分配过的号
 */
async function assignStageCodes(
  schemeId: string | null,
  deptCode: number,
  stages: StageSchemeSaveInput['stages'],
  userId: string,
): Promise<Array<number | null>> {
  const prevByName = new Map<string, number>();
  const prevBySort: Array<number | null> = [];
  if (schemeId) {
    const current = (await db(SCHEME_STAGE_TABLE)
      .where({ scheme_id: schemeId, is_deleted: false })
      .orderBy('sort_no', 'asc')
      .select('stage_name', 'stage_code')) as Array<Record<string, any>>;
    for (const c of current) {
      const code = c.stage_code === null || c.stage_code === undefined ? null : Number(c.stage_code);
      const name = String(c.stage_name ?? '').trim();
      if (code !== null && Number.isFinite(code) && name) prevByName.set(name, code);
      prevBySort.push(code !== null && Number.isFinite(code) ? code : null);
    }
  }

  const { nameToCode, usedCodes } = await loadDeptDict(deptCode);
  const assigned = new Set<number>();
  const base = BASE_OF_DEPT[deptCode] ?? 100;

  const out: Array<number | null> = [];
  stages.forEach((s, i) => {
    const name = String(s.stageName ?? '').trim();
    let code: number | null = null;

    if (s.stageCode !== undefined && s.stageCode !== null && Number.isFinite(Number(s.stageCode))) {
      code = Number(s.stageCode);
    }
    if (code === null && name && prevByName.has(name)) code = prevByName.get(name)!;
    if (code === null && prevBySort[i] !== null && prevBySort[i] !== undefined) code = prevBySort[i]!;
    if (code !== null && assigned.has(code)) code = null; // 同一方案内不许重码
    if (code === null && name && nameToCode.has(name)) code = nameToCode.get(name)!;
    if (code === null || assigned.has(code)) {
      let n = base + 1;
      while ((usedCodes.has(n) || assigned.has(n)) && n < base + 100) n += 1;
      code = n;
    }

    assigned.add(code!);
    out.push(code);
  });

  return out;
}

/** 阶段明细入库（先逻辑删旧的，再插新的 —— 修改时整体覆盖） */
async function replaceStages(
  schemeId: string,
  stages: StageSchemeSaveInput['stages'],
  userId: string,
  deptCode: number,
): Promise<void> {
  const now = new Date();
  const codes = await assignStageCodes(schemeId, deptCode, stages, userId);

  await db(SCHEME_STAGE_TABLE).where({ scheme_id: schemeId, is_deleted: false }).update({
    is_deleted: true,
    update_time: now,
    update_by: userId || 'system',
  });

  const rows = stages.map((s, i) => ({
    id: randomUUID(),
    scheme_id: schemeId,
    stage_name: s.stageName,
    stage_code: codes[i] ?? null,
    study_months: s.studyMonths ?? null,
    sort_no: i,
    is_deleted: false,
    create_time: now,
    create_by: userId || 'system',
  }));
  if (rows.length) await db(SCHEME_STAGE_TABLE).insert(rows);

  // 新号码要能在列表里显示中文名；顺便让内存里的阶段字典跟着更新
  for (let i = 0; i < rows.length; i += 1) {
    const code = rows[i].stage_code;
    if (code === null) continue;
    await ensureDictRow(
      deptCode,
      code,
      String(rows[i].stage_name ?? '').trim(),
      rows[i].study_months === null || rows[i].study_months === undefined ? null : Number(rows[i].study_months),
      userId,
    );
  }
  await refreshStageDict();
}

/** 新增方案（含阶段明细） */
export async function createScheme(input: StageSchemeSaveInput, userId: string): Promise<{ id: string }> {
  if (await nameDuplicated(input.schemeName, input.deptCode)) {
    throw new BizError(BizCode.BUSINESS_RULE_VIOLATION, '该部门下已有同名方案');
  }

  const id = randomUUID();
  const now = new Date();
  await db(SCHEME_TABLE).insert({
    id,
    scheme_name: input.schemeName,
    dept_code: input.deptCode,
    sort_no: 0,
    is_deleted: false,
    create_time: now,
    create_by: userId || 'system',
  });
  await replaceStages(id, input.stages, userId, input.deptCode);
  return { id };
}

/** 修改方案（阶段明细整体覆盖） */
export async function updateScheme(id: string, input: StageSchemeSaveInput, userId: string): Promise<{ id: string }> {
  const existed = await db(SCHEME_TABLE).where({ id, is_deleted: false }).first();
  if (!existed) throw new BizError(BizCode.SETTING_NOT_FOUND, '方案不存在');
  if (await nameDuplicated(input.schemeName, input.deptCode, id)) {
    throw new BizError(BizCode.BUSINESS_RULE_VIOLATION, '该部门下已有同名方案');
  }

  await db(SCHEME_TABLE).where({ id }).update({
    scheme_name: input.schemeName,
    dept_code: input.deptCode,
    update_time: new Date(),
    update_by: userId || 'system',
  });
  await replaceStages(id, input.stages, userId, input.deptCode);
  return { id };
}

/** 方案是否仍被班级引用（初高 / 大学 / 实训三张班级表都查） */
export async function schemeUsedByClass(id: string): Promise<boolean> {
  for (const table of CLASS_TABLES) {
    try {
      const rows = await db.raw(
        `SELECT id FROM ${table} WHERE scheme_id = ? AND is_deleted = 0 LIMIT 1`,
        [id],
      );
      const first = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0][0] : undefined;
      if (first) return true;
    } catch {
      // 表不存在（该学段未部署）或权限不足 → 跳过，不影响删除判定
    }
  }
  return false;
}

/** 删除方案（逻辑删除；仍被班级引用时拒绝） */
export async function removeScheme(id: string, userId: string): Promise<void> {
  const existed = await db(SCHEME_TABLE).where({ id, is_deleted: false }).first();
  if (!existed) throw new BizError(BizCode.SETTING_NOT_FOUND, '方案不存在');

  if (await schemeUsedByClass(id)) {
    throw new BizError(BizCode.BUSINESS_RULE_VIOLATION, '该方案已被班级使用，禁止删除');
  }

  const now = new Date();
  await db(SCHEME_TABLE).where({ id }).update({
    is_deleted: true,
    update_time: now,
    update_by: userId || 'system',
  });
  await db(SCHEME_STAGE_TABLE).where({ scheme_id: id, is_deleted: false }).update({
    is_deleted: true,
    update_time: now,
    update_by: userId || 'system',
  });
}
