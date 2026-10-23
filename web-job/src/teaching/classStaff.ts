/**
 * 教学管理 · 岗位选人（2026-10-23 批注）
 * ============================================================
 *
 * 批注原文：
 *   「将每个人员的选择改成职位：比如班主任姓名，改为班主任，教员姓名改为教员，
 *     同时同步职位列表，根据职位名称+部门进行选择：例如部门我选择初高中部，
 *     班主任选择就只会显示初高部的班主任，例如若没有部门，项目经理，
 *     那就根据项目经理职位名称，同步职位只显示项目经理人员进行的选择，
 *     【教学管理根据框选的所有职位按照要求进行更改】」
 *
 * 【一套口径，三处复用】
 *   ① 班级新增/编辑弹窗的 班主任 / 教员 / 助教 / 项目经理 / 就业老师
 *   ② 班级交接弹窗的「新负责人」五个岗位
 *   ③ 升实训弹窗的 项目经理 / 就业老师
 *
 * 【过滤规则】
 *   一级：该账号的**职位**必须是这个岗位（按职位名；职位被改名时兜底按职位码）
 *   二级：该账号的**部门**要包含当前教学部门（1 初高部 / 2 大学部 / 3 就业部）
 *   兜底：该部门下这个职位一个人都没有（典型：项目经理只在实训教学部，
 *         而当前部门选的是大学部）→ **退回只按职位名筛**，否则下拉是空的选不了人。
 *         批注里「若没有部门，项目经理，那就根据项目经理职位名称」说的就是这个。
 *
 * 【为什么列表在前端过滤】
 *   账号总共十几个，staff-options 一次拉全量（含职位与部门码），
 *   部门下拉一改就能立刻重算，不用每次都打接口。
 *   部门码换算（权限管理「教学部 → 初中/高中/大学部」）在后端做完再下发，
 *   前端只认 1/2/3，不用关心权限管理的部门树。
 */
import type { StaffOption } from '@/teaching/api/class';

/** 五个岗位（与班级表字段一一对应） */
export type StaffKind = 'headTeacher' | 'teacher' | 'assistant' | 'projectManager' | 'employmentTeacher';

/**
 * 岗位 → 权限管理里的职位。
 *   name 是「职位管理」界面看到的职位名（改名前的老口径）；
 *   code 是 role_code，职位被改名后仍能对上。
 */
export const STAFF_POSITION: Record<StaffKind, { name: string; code: string }> = {
  headTeacher: { name: '班主任', code: 'TEACH_HEAD' },
  teacher: { name: '教员', code: 'TEACH_TUTOR' },
  assistant: { name: '助教', code: 'TEACH_ASSIST' },
  projectManager: { name: '项目经理', code: 'RM_PROJECT' },
  employmentTeacher: { name: '就业老师', code: 'JOB_STAFF' },
};

/** 学段 → 教学部门码（交接 / 升实训没有 deptCode 字段，只能从学段推） */
export const STAGE_DEPT_CODE: Record<string, number> = { jh: 1, class: 2, job: 3, emp: 3 };

/** 这个账号是不是这个岗位的人 */
export function isStaffOfPosition(u: StaffOption, kind: StaffKind): boolean {
  const p = STAFF_POSITION[kind];
  return (u.roleNames || []).includes(p.name) || (u.roleCodes || []).includes(p.code);
}

/**
 * 取出某个岗位在当前部门下可选的人。
 *
 * @param list      全量人员（GET /teaching/class/staff-options）
 * @param kind      岗位
 * @param deptCode  教学部门码 1/2/3；空 = 不限部门（还没选部门时）
 * @param keepId    编辑老数据时的当前值 —— 不在候选里也要补一条，否则显示成空
 * @param keepName  上面那条的名字
 */
export function staffOf(
  list: StaffOption[],
  kind: StaffKind,
  deptCode?: number | null,
  keepId?: string | null,
  keepName?: string | null,
): StaffOption[] {
  const byPosition = (list || []).filter((u) => isStaffOfPosition(u, kind));
  const dc = Number(deptCode) || 0;
  let out = dc ? byPosition.filter((u) => (u.deptCodes || []).includes(dc)) : byPosition;
  // 该部门没有这个职位的人 → 退回「只按职位」
  if (!out.length) out = byPosition;
  if (keepId && !out.some((u) => u.id === keepId)) {
    out = [{ id: keepId, userName: keepName || keepId, deptId: null, deptName: null, roleNames: [], roleCodes: [], deptCodes: [] }, ...out];
  }
  return out;
}
