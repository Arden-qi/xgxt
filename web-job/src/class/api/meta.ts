import { get } from './request';

/**
 * 枚举字典（公开接口）
 *
 * 后端 `/api/class/meta/dict` 把《01-公共数据字典》里的枚举一次性给前端，
 * 前端不再各页面各写一份映射（避免「机试 / 素质分析」这类叫法不一致）。
 */
export type DictGroup = Record<string, string>;

export interface DictData {
  gender: DictGroup;
  deptCode: DictGroup;
  studentStatus: DictGroup;
  classStatus: DictGroup;
  feeType: DictGroup;
  payStatus: DictGroup;
  refundStatus: DictGroup;
  refundStatusHandlerRole: DictGroup;
  suspendStatus: DictGroup;
  suspendStatusHandlerRole: DictGroup;
  applyType: DictGroup;
  upgradeStatus: DictGroup;
  outerSyncStatus: DictGroup;
  examType: DictGroup;
  examResult: DictGroup;
  examContentType: DictGroup;
  applyStatus: DictGroup;
  dormType: DictGroup;
  notifyType: DictGroup;
  stage: DictGroup;
  /** 部门 → 该部门下可选的学习阶段（后端按月/按部门分组） */
  stageByDept: Record<string, number[]>;
  /** 咨询接收状态：1 待接收 / 2 已接收 / 3 已驳回 */
  consultStatus: DictGroup;
}

let cache: DictData | null = null;

export async function loadDict(): Promise<DictData> {
  if (cache) return cache;
  cache = await get<DictData>('/api/class/meta/dict');
  return cache;
}

/** 取某个枚举的显示名；查不到时回退成原值，避免页面出现空白 */
export function labelOf(group: DictGroup | undefined, value: unknown): string {
  if (!group || value === null || value === undefined || value === '') return '—';
  return group[String(value)] ?? String(value);
}

/** 把枚举对象转成 Element Plus 的 options */
export function toOptions(group: DictGroup | undefined): Array<{ label: string; value: number }> {
  if (!group) return [];
  return Object.keys(group)
    .filter((k) => /^\d+$/.test(k))
    .map((k) => ({ label: group[k], value: Number(k) }));
}

/* ---------------- 人员选项 ---------------- */

export interface StaffOption {
  userId: string;
  userName: string;
  deptCode: number;
  roles: string[];
}

/** 人员分组短名（后端 ROLE_GROUPS 的 key） */
export type StaffGroup =
  | 'headTeacher'
  | 'teacher'
  | 'assistant'
  // ★ 2026-10-04：建班 5 岗位（项目经理 / 就业指导老师）
  | 'projectManager'
  | 'employmentTeacher'
  | 'studyManager'
  | 'principal'
  | 'eduAdmin'
  | 'finance'
  | 'market'
  | 'all';

/**
 * 按分组取人员（建班选班主任、班级交接、退费链选财务 …）
 *
 * 结果按分组做了内存缓存：这些下拉在一屏里会出现多次
 * （建班弹窗里就有班主任 / 教员 / 助教三个），不缓存会连打三遍 8001。
 */
const staffCache = new Map<string, StaffOption[]>();

export async function staffOptions(group: StaffGroup = 'all'): Promise<StaffOption[]> {
  const hit = staffCache.get(group);
  if (hit) return hit;
  const res = await get<{ list: StaffOption[]; total: number }>('/api/class/meta/staff', { group });
  const list = res.list ?? [];
  staffCache.set(group, list);
  return list;
}

/** 新增人员后让缓存失效（目前建班不涉及建人，留个口子给以后） */
export function clearStaffCache(): void {
  staffCache.clear();
}
