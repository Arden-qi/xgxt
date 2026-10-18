/**
 * 宿舍适配器（Adapter）
 * ============================================================
 *
 * 【与班级域的关键差异】
 *   ① **三学段共用一份仓储实现**（repo.uni.ts 的 makeRepo(stage)）
 *      —— 斌哥 2026-10-10 拍板：「初高中、大学、实训都在一个界面，
 *      那就都采用实训那套就行」。原先的 repo.classJh.ts（初高 varchar 状态机）、
 *      repo.class.ts（大学只读同步表）两份实现**已下线**，不再维护。
 *      「大学是教务同步的只读数据」这个设定作废：两张同步表实测均为 0 行，
 *      大学宿舍页面本来就是空的。现在三学段一样，数据自己录入，教务要读就读。
 *   ② **审批链统一用实训那套**（斌哥 2026-10-09 拍板，行为变更）：
 *      初高/大学原来的简易 3 态（apply_status 1待审核/2已同意/3已驳回）
 *      只用于**读旧单据**，新单据一律走 t_job_approval 通用审批链。
 *
 *
 * 【权限码 = 合并前各学段原页面的权限码，一个都没改】
 *   jh classjh:dorm:view / class class:dorm:view / job job:dorm:view
 */

import { BizCode } from 'shared-types';
import { BizError } from '../../middleware/errorHandler';
import { makeRepo } from './repo.uni';
import type {
  DormAssignBody,
  DormChangeCreateBody,
  DormChangeRow,
  DormListQuery,
  DormResidentRow,
  DormRow,
  DormSaveBody,
  DormStageMeta,
  DormSummary,
  TeachingStage,
} from '../shared/dto';
import { TEACHING_STAGES, TEACHING_STAGE_NAME, DORM_CATEGORY_NAME } from '../shared/dto';
import { assertStageCode, visibleStagesBy } from '../shared/stageAccess';
import type { DormRepo } from './types';

/**
 * ★ 三学段各生成一个实例（只有 edu_stage 不同），但**实现是同一份代码**
 *   斌哥 2026-10-10 拍板：「初高中、大学、实训都在一个界面，那就都采用实训那套就行」
 */
const REPOS: Record<TeachingStage, DormRepo> = {
  jh: makeRepo('jh'),
  class: makeRepo('class'),
  job: makeRepo('job'),
};

const CODES: Record<TeachingStage, string> = {
  jh: 'classjh:dorm:view',
  class: 'class:dorm:view',
  job: 'job:dorm:view',
};

const LABEL = '宿舍管理';

export function assertStageView(user: any, stage: TeachingStage): Promise<void> {
  return assertStageCode(user, stage, CODES, LABEL);
}

export function visibleStages(user: any): Promise<TeachingStage[]> {
  return visibleStagesBy(user, CODES, LABEL);
}

function pick(stage: TeachingStage): DormRepo {
  const r = REPOS[stage];
  if (!r) throw new BizError(BizCode.PARAM_ERROR, `stage 只能是 jh / class / job`);
  return r;
}

export function assertStage(v: unknown): TeachingStage {
  if (v !== 'jh' && v !== 'class' && v !== 'job') {
    throw new BizError(BizCode.PARAM_ERROR, 'stage 只能是 jh / class / job');
  }
  return v;
}

/**
 * 写操作守卫：三学段现在都可写（`hasCreate` 恒为 true），
 * 这里保留是为了将来若某学段要设只读，只改 meta() 一处即可，不用改适配器。
 */
function assertWritable(stage: TeachingStage): void {
  if (!REPOS[stage].meta().hasCreate) {
    throw new BizError(
      BizCode.NO_OPERATION_PERMISSION,
      `${TEACHING_STAGE_NAME[stage]}的宿舍数据不允许在这里新增/修改/删除`,
    );
  }
}

/* ============================================================
 * 房间列表
 * ============================================================ */

/**
 * ★ 关键字匹配：把一行宿舍「拍平」成能搜的文本（2026-10-18）
 *
 * 取的是**列表上显示出来的值**，不是库里的原始列 —— 这样用户在屏幕上看到
 * 「男寝」「停用」就能搜「男寝」「停用」；看到「3/4」也能搜「3/4」。
 * 反过来若取原始列，dorm_gender=1、room_status=1 这种 int 码，
 * 用户搜「男寝」永远命中不了。
 *
 * 入住率两种写法都收（"50" 和 "50%"），因为列表里显示成「50%」，
 * 用户很可能连百分号一起复制进来搜。
 */
function searchTextOf(r: DormRow): string {
  /**
   * ★ 类别的取法必须和列表显示**完全一致**（前端 categoryName 是
   *   `DORM_CATEGORY_NAME[dormType] ?? dormTypeName`），否则列表显示「男寝」、
   *   后端却按「男生宿舍」建索引，用户搜「男寝」永远 0 条。
   */
  const category = DORM_CATEGORY_NAME[r.dormType] ?? r.dormTypeName ?? '不限';
  return [
    category,
    r.buildingName,
    r.roomNo,
    `${r.occupiedCount}/${r.bedCount}`,
    `${r.occupancyRate}%`,
    r.roomStatusName,
    r.remark ?? '',
  ]
    .join(' ')
    .toLowerCase();
}

/** 关键字 + 入住率：两个都是「算出来/翻译出来」的，只能内存过滤 */
function applyRowFilters(rows: DormRow[], q: DormListQuery): DormRow[] {
  let out = rows;
  const kw = String(q.keyword ?? '').trim().toLowerCase();
  if (kw) out = out.filter((r) => searchTextOf(r).includes(kw));
  if (q.occupancyRate !== undefined && q.occupancyRate !== null) {
    out = out.filter((r) => Number(r.occupancyRate) === Number(q.occupancyRate));
  }
  return out;
}

async function mergedRows(
  q: DormListQuery,
  user: any,
): Promise<{ rows: DormRow[]; stages: TeachingStage[] }> {
  const stages: TeachingStage[] = q.stage ? [q.stage] : await visibleStages(user);
  if (!stages.length) throw new BizError(BizCode.NO_OPERATION_PERMISSION, '没有宿舍管理的访问权限');
  if (q.stage) await assertStageView(user, q.stage);

  const parts = await Promise.all(stages.map((s) => REPOS[s].list(q, user)));
  let rows = parts.flat();

  // ★ 关键字 / 入住率：在合并之后过滤（口径见 applyRowFilters）
  rows = applyRowFilters(rows, q);

  // 学段顺序固定（初高 → 大学 → 实训），再按楼栋 + 房间号排
  rows.sort((a, b) => {
    const sa = TEACHING_STAGES.indexOf(a.stage);
    const sb = TEACHING_STAGES.indexOf(b.stage);
    if (sa !== sb) return sa - sb;
    if (a.buildingName !== b.buildingName) {
      return a.buildingName.localeCompare(b.buildingName, 'zh-Hans-CN');
    }
    return a.roomNo.localeCompare(b.roomNo, 'zh-Hans-CN', { numeric: true });
  });
  return { rows, stages };
}

/**
 * ★ 入住率可选项：**实时从当前数据里算**，不写死档位
 *
 * 【为什么不写死 0/25/50/75/100 或「<50% / 50~80% / >80%」】
 *   入住率 = 已住/床位，取值完全取决于床位总数（4 床的房是 0/25/50/75/100，
 *   6 床的房是 0/17/33/50/67/83/100）。写死档位必然出现「选了 25% 却一条都没有」。
 *   → 直接从列表里去重：当前筛出来的房间有哪些入住率，下拉就给哪些。
 *
 * 【★ 为什么要先把 occupancyRate 摘掉再算】
 *   否则：先选 50% → 结果只剩 50% 的房 → 下拉里就只剩 50% 一项 →
 *   用户再也选不回其它值，等于把自己锁死在某个筛选里出不来。
 *   → 算选项时忽略「入住率」这个条件本身，但**保留楼栋/类别/状态/关键字**，
 *     于是选了「1号楼」之后，下拉只给 1号楼 真实存在的入住率 —— 这才是想要的联动。
 */
export async function listOccupancyRates(
  q: DormListQuery,
  user: any,
): Promise<Array<{ value: number; label: string }>> {
  const { rows } = await mergedRows({ ...q, occupancyRate: undefined }, user);
  const rates = [...new Set(rows.map((r) => Number(r.occupancyRate) || 0))].sort((a, b) => a - b);
  return rates.map((v) => ({ value: v, label: `${v}%` }));
}

export async function listDorms(
  q: DormListQuery,
  user: any,
): Promise<{ list: DormRow[]; total: number; page: number; size: number; stages: TeachingStage[] }> {
  const { rows, stages } = await mergedRows(q, user);
  const total = rows.length;
  const start = (q.page - 1) * q.size;
  return { list: rows.slice(start, start + q.size), total, page: q.page, size: q.size, stages };
}

export async function getDormDetail(
  stage: TeachingStage,
  id: string,
  user: any,
): Promise<DormRow | null> {
  await assertStageView(user, stage);
  return pick(stage).detail(id, user);
}

/** 床位（含在住学生） */
export async function listBeds(
  stage: TeachingStage,
  dormId: string,
  user: any,
): Promise<{ beds: Awaited<ReturnType<DormRepo['beds']>>; dorm: DormRow | null }> {
  await assertStageView(user, stage);
  const r = pick(stage);
  const [beds, dorm] = await Promise.all([r.beds(dormId, user), r.detail(dormId, user)]);
  return { beds, dorm };
}

/** 在住学生名单 */
export async function listResidents(
  q: DormListQuery,
  user: any,
): Promise<DormResidentRow[]> {
  const stages: TeachingStage[] = q.stage ? [q.stage] : await visibleStages(user);
  if (!stages.length) throw new BizError(BizCode.NO_OPERATION_PERMISSION, '没有宿舍管理的访问权限');
  if (q.stage) await assertStageView(user, q.stage);
  const parts = await Promise.all(stages.map((s) => REPOS[s].residents(q, user)));
  return parts.flat();
}

/** 楼栋下拉（合并三学段，同名去重 —— 楼栋名只是个标签，不是实体） */
export async function listBuildings(
  stage: TeachingStage | undefined,
  user: any,
): Promise<Array<{ value: string; label: string }>> {
  const stages: TeachingStage[] = stage ? [stage] : await visibleStages(user);
  if (!stages.length) return [];
  if (stage) await assertStageView(user, stage);
  const parts = await Promise.all(stages.map((s) => REPOS[s].buildings(user)));
  const seen = new Set<string>();
  const out: Array<{ value: string; label: string }> = [];
  for (const p of parts) {
    for (const b of p) {
      if (!b.value || seen.has(b.value)) continue;
      seen.add(b.value);
      out.push(b);
    }
  }
  return out;
}

/** 元信息：只返回当前用户可见的学段 */
export async function listDormMeta(
  stage: TeachingStage | undefined,
  user: any,
): Promise<DormStageMeta[]> {
  const stages: TeachingStage[] = stage ? [stage] : await visibleStages(user);
  if (stage) await assertStageView(user, stage);
  return stages.map((s) => REPOS[s].meta());
}

/** 统计（口径与列表一致） */
export async function summaryDorms(q: DormListQuery, user: any): Promise<DormSummary[]> {
  const stages: TeachingStage[] = q.stage ? [q.stage] : await visibleStages(user);
  if (!stages.length) return [];
  if (q.stage) await assertStageView(user, q.stage);
  return Promise.all(stages.map((s) => REPOS[s].summary(q, user)));
}

/* ============================================================
 * 写操作
 * ============================================================ */

export async function saveDorm(body: DormSaveBody, user: any): Promise<{ id: string }> {
  await assertStageView(user, body.stage);
  assertWritable(body.stage);
  return pick(body.stage).save(body, user?.userId || '');
}

export async function removeDorm(stage: TeachingStage, id: string, user: any): Promise<void> {
  await assertStageView(user, stage);
  assertWritable(stage);
  return pick(stage).remove(id, user?.userId || '');
}

export async function assignBed(body: DormAssignBody, user: any): Promise<void> {
  await assertStageView(user, body.stage);
  // ★ 大学床位是同步来的，只能走申请
  assertWritable(body.stage);
  return pick(body.stage).assign(body, user?.userId || '');
}

export async function checkoutBed(
  stage: TeachingStage,
  dormId: string,
  bedId: string,
  user: any,
): Promise<void> {
  await assertStageView(user, stage);
  assertWritable(stage);
  return pick(stage).checkout(dormId, bedId, user?.userId || '');
}

/* ============================================================
 * 调宿 / 退宿申请
 * ============================================================ */

export async function listDormChanges(
  q: DormListQuery,
  user: any,
): Promise<DormChangeRow[]> {
  const stages: TeachingStage[] = q.stage ? [q.stage] : await visibleStages(user);
  if (!stages.length) return [];
  if (q.stage) await assertStageView(user, q.stage);
  const parts = await Promise.all(stages.map((s) => REPOS[s].changeList(q, user)));
  const rows = parts.flat();
  rows.sort((a, b) => {
    const sa = TEACHING_STAGES.indexOf(a.stage);
    const sb = TEACHING_STAGES.indexOf(b.stage);
    if (sa !== sb) return sa - sb;
    return (a.createTime || '') < (b.createTime || '') ? 1 : -1;
  });
  return rows;
}

/** 发起申请（三个学段都写自己的申请表，但状态口径统一成「待审批」） */
export async function createDormChange(
  body: DormChangeCreateBody,
  user: any,
): Promise<{ id: string }> {
  await assertStageView(user, body.stage);
  if (body.bizType !== 1 && body.bizType !== 2) {
    throw new BizError(BizCode.PARAM_ERROR, '业务类型只能是 1 调换宿舍 / 2 退宿');
  }
  if (!body.changeReason || !body.changeReason.trim()) {
    throw new BizError(BizCode.PARAM_ERROR, '原因必填');
  }
  if (!body.changeDate) {
    throw new BizError(BizCode.PARAM_ERROR, '日期必填');
  }
  // 换宿/退宿申请三学段都可提交（ rooms 可写，申请当然也可写）
  return pick(body.stage).changeCreate(body, user?.userId || '');
}
