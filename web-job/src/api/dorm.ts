/**
 * 宿舍管理 接口调用（就业管理 > 实训阶段）
 *
 * ⚠️ 路径与后端 /api/job/dorm 完全一致
 *
 * 【页面共用说明】
 *   班主任   → 只能发起 + 撤回（看不到审批按钮）
 *   教务老师 → 只能审批（看不到发起按钮）
 *   按钮显隐由后端返回的 canApprove / canCancel 控制。
 */

import { http } from './request';
import type {
  PageData,
  DormListItem,
  DormDetail,
  DormQuery,
  DormPayload,
  DormBedOption,
  DormStudentBedItem,
  DormStudentBedQuery,
  DormAssignStudent,
  DormAssignQuery,
  DormAssignPayload,
  DormChangeListItem,
  DormChangeDetail,
  DormChangeQuery,
  DormChangePayload,
  DormStudentOption,
  DormSummary,
} from 'shared-types';

/* ============================================================
 * 一、宿舍主档
 * ============================================================ */

/** 宿舍列表 */
export function fetchDormList(query: DormQuery): Promise<PageData<DormListItem>> {
  return http.get<PageData<DormListItem>>('/api/job/dorm/page', query);
}

/** 宿舍详情（含所有床位） */
export function fetchDormDetail(id: string): Promise<DormDetail> {
  return http.get<DormDetail>('/api/job/dorm/detail', { id });
}

/** 新建宿舍 */
export function createDorm(payload: DormPayload): Promise<{ id: string; dormNo: string }> {
  return http.post<{ id: string; dormNo: string }>('/api/job/dorm/create', payload);
}

/** 编辑宿舍 */
export function updateDorm(payload: DormPayload): Promise<null> {
  return http.post<null>('/api/job/dorm/update', payload);
}

/** 删除宿舍（逻辑删除） */
export function deleteDorm(id: string): Promise<null> {
  return http.post<null>('/api/job/dorm/delete', { id });
}

/** 楼栋列表（下拉用） */
export function fetchBuildings(): Promise<string[]> {
  return http.get<string[]>('/api/job/dorm/buildings');
}

/** 可选床位（调换 / 换宿时选新床位；只返回空闲床位） */
export function fetchBedOptions(params?: {
  keyword?: string;
  dormGender?: number;
  /** ★ 2026-10-03：传学生 ID → 只返回与该学生**性别相符**的床位（男生只出男寝） */
  studentId?: string;
  excludeStudentId?: string;
  excludeBedId?: string;
  /** ★ 2026-10-02：只看某个宿舍下的床位（「修改学生」里先选宿舍再选床） */
  dormId?: string;
}): Promise<DormBedOption[]> {
  return http.get<DormBedOption[]>('/api/job/dorm/bed-options', params);
}

/* ============================================================
 * 二、调换 / 退宿 申请单
 * ============================================================ */

/** 可发起调换/退宿的学生（只列当前有宿舍的） */
export function fetchDormStudentOptions(params?: {
  keyword?: string;
  limit?: number;
  /** ★ 2026-10-03：1=调换 2=退宿。退宿时会把**休学学生**也列出来（他还占着床位没退） */
  bizType?: number;
}): Promise<DormStudentOption[]> {
  return http.get<DormStudentOption[]>('/api/job/dorm/student-options', params);
}

/** 申请单列表 */
export function fetchDormChangeList(
  query: DormChangeQuery,
): Promise<PageData<DormChangeListItem>> {
  return http.get<PageData<DormChangeListItem>>('/api/job/dorm/change/page', query);
}

/** 申请单详情（含轨迹 + 流程条 + 历史） */
export function fetchDormChangeDetail(id: string): Promise<DormChangeDetail> {
  return http.get<DormChangeDetail>('/api/job/dorm/change/detail', { id });
}

/** 新建申请单 */
export function createDormChange(
  payload: DormChangePayload & { submit?: boolean },
): Promise<{ id: string }> {
  return http.post<{ id: string }>('/api/job/dorm/change/create', payload);
}

/** 提交申请单 */
export function submitDormChange(id: string): Promise<{ approvalStatus: number }> {
  return http.post<{ approvalStatus: number }>('/api/job/dorm/change/submit', { id });
}

/** 同意（教务老师） */
export function approveDormChange(
  id: string,
  comment?: string,
): Promise<{ finished: boolean; approvalStatus: number; approvalStatusName: string }> {
  return http.post('/api/job/dorm/change/approve', { id, comment });
}

/** 驳回（教务老师） */
export function rejectDormChange(id: string, reason: string): Promise<{ approvalStatus: number }> {
  return http.post<{ approvalStatus: number }>('/api/job/dorm/change/reject', { id, reason });
}

/** 撤回（申请人本人） */
export function cancelDormChange(id: string): Promise<{ approvalStatus: number }> {
  return http.post<{ approvalStatus: number }>('/api/job/dorm/change/cancel', { id });
}

/** 统计 */
export function fetchDormSummary(): Promise<DormSummary> {
  return http.get<DormSummary>('/api/job/dorm/change/summary');
}

/**
 * 入住明细（按学生看）—— 斌哥 2026-09-30
 *
 *   房间视角回答"这间房还有几张空床"；这个接口回答"张三住哪"。
 *   宿舍管理页的「入住情况」Tab 用它。
 */
export function fetchStudentBeds(
  params?: DormStudentBedQuery,
): Promise<PageData<DormStudentBedItem>> {
  return http.get<PageData<DormStudentBedItem>>('/api/job/dorm/student-bed/page', params);
}

/* ============================================================
 * ★ 分派宿舍（2026-10-01 新增 · 斌哥）
 *
 *   用途：学生**休学期间若已退宿**，复学后宿舍是空的 ——
 *        由**复学班的班主任**在这里分一个床位。
 *   口径：只列【没宿舍】且【实训中】的学生；班主任只看自己带的班。
 *   ⚠️ **不走审批** —— 选了床位直接生效。
 * ============================================================ */

/** 待分派的学生（没宿舍的在校生） */
export function fetchAssignStudents(
  params?: DormAssignQuery,
): Promise<PageData<DormAssignStudent>> {
  return http.get<PageData<DormAssignStudent>>('/api/job/dorm/assign/page', params);
}

/** 分派宿舍（直接生效，不走审批） */
export function assignDorm(
  payload: DormAssignPayload,
): Promise<{ dormNo: string; bedNo: string; bedNoText?: string; bedLabel?: string }> {
  return http.post<{ dormNo: string; bedNo: string; bedNoText?: string; bedLabel?: string }>(
    '/api/job/dorm/assign',
    payload,
  );
}
