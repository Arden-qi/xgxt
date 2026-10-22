/**
 * 宿舍管理接口
 *
 * 对应后端 server-edu/src/routes/dorm.route.ts
 * 路径前缀 /api/edu/dorm（走 Vite proxy 转发到 8002）
 */

import { http } from '../request';
import type {
  PageData,
  DormRoomItem,
  DormQuery,
  DormListStats,
  DormApprovalStats,
  ChangeApplyItem,
  QuitApplyItem,
  CheckoutItem,
  ApplyQuery,
  ApplyStatus,
  DormCategory,
  DormAssignQuery,
  DormAssignClassRow,
  DormAssignCandidate,
  DormAssignStats,
  DormAssignPayload,
} from 'shared-types/edu';

/**
 * 宿舍列表（按「间」分页，每间含 8 个床位）
 *
 * ★ 2026-10-22：补了可选 config —— 学生档案页只是拿宿舍号/床位号下拉的候选，
 *   属于「后台预取」，调用方传 { silent: true }，账号没有教务板块时就不会弹无权限提示。
 */
export function fetchDormList(
  query: DormQuery,
  config?: { silent?: boolean },
): Promise<PageData<DormRoomItem>> {
  return http.get<PageData<DormRoomItem>>('/api/edu/dorm/list', query as any, config);
}

/** 宿舍总名单 Tab 的统计数字 */
export function fetchDormStats(): Promise<DormListStats> {
  return http.get<DormListStats>('/api/edu/dorm/stats');
}

/**
 * 楼栋下拉选项（和「类别」联动）
 * 传 category 就只返回该类别下的楼栋，不传返回全部
 */
export function fetchDormBuildings(category?: number): Promise<string[]> {
  return http.get<string[]>('/api/edu/dorm/buildings', { category });
}

/* ============================================================
 * 分派宿舍（班级 ↔ 宿舍）
 * ============================================================ */

/** 按班级分组的分派列表 */
export function fetchAssignList(query: DormAssignQuery): Promise<DormAssignClassRow[]> {
  return http.get<DormAssignClassRow[]>('/api/edu/dorm/assign/list', query as any);
}

/** 分派弹窗里的候选宿舍 */
export function fetchAssignRooms(query: DormAssignQuery): Promise<DormAssignCandidate[]> {
  return http.get<DormAssignCandidate[]>('/api/edu/dorm/assign/rooms', query as any);
}

/** 分派宿舍页统计数字 */
export function fetchAssignStats(): Promise<DormAssignStats> {
  return http.get<DormAssignStats>('/api/edu/dorm/assign/stats');
}

/** 给班级分派宿舍（一次可以多间） */
export function assignRooms(payload: DormAssignPayload): Promise<{ added: number }> {
  return http.post<{ added: number }>('/api/edu/dorm/assign', payload);
}

/** 覆盖某个班级的宿舍清单（弹窗保存用） */
export function replaceAssign(payload: DormAssignPayload): Promise<{ added: number; removed: number }> {
  return http.post<{ added: number; removed: number }>('/api/edu/dorm/assign/replace', payload);
}

/** 取消单间宿舍的分派 */
export function removeAssign(id: string): Promise<null> {
  return http.post<null>('/api/edu/dorm/assign/remove', { id });
}

/** 清空某个班级的全部分派 */
export function clearAssign(className: string): Promise<{ removed: number }> {
  return http.post<{ removed: number }>('/api/edu/dorm/assign/clear', { className });
}

/** 申请审批 Tab 的统计数字 */
export function fetchApprovalStats(): Promise<DormApprovalStats> {
  return http.get<DormApprovalStats>('/api/edu/dorm/approval-stats');
}

/** 新增宿舍 */
export function addDormRoom(payload: {
  category: DormCategory;
  building: string;
  room: string;
  capacity: number;
}): Promise<{ id: string }> {
  return http.post<{ id: string }>('/api/edu/dorm/room/add', payload);
}

/** 修改宿舍信息（类别/楼栋/房号/额定） */
export function updateDormRoomInfo(payload: {
  id: string;
  category: DormCategory;
  building: string;
  room: string;
  capacity: number;
}): Promise<null> {
  return http.put<null>('/api/edu/dorm/room/info', payload);
}

/** 修改入住学生（整间 8 个床位一起覆盖） */
export function updateDormOccupants(payload: {
  id: string;
  occupants: { bedNo: string; studentName?: string; className?: string; headTeacherName?: string }[];
}): Promise<null> {
  return http.put<null>('/api/edu/dorm/room/occupants', payload);
}

/** 删除宿舍（必须 0 人入住） */
export function deleteDormRoom(id: string): Promise<null> {
  return http.delete<null>(`/api/edu/dorm/room/delete/${id}`);
}

/** 换宿申请列表 */
export function fetchChangeApplies(query: ApplyQuery): Promise<PageData<ChangeApplyItem>> {
  return http.get<PageData<ChangeApplyItem>>('/api/edu/dorm/change/list', query as any);
}

/** 退宿申请列表 */
export function fetchQuitApplies(query: ApplyQuery): Promise<PageData<QuitApplyItem>> {
  return http.get<PageData<QuitApplyItem>>('/api/edu/dorm/quit/list', query as any);
}

function audit(type: 'change' | 'quit', action: 'approve' | 'reject', payload: { id: string; reason?: string }) {
  return http.post<null>(`/api/edu/dorm/${type}/${action}`, payload);
}

export const approveChange = (id: string) => audit('change', 'approve', { id });
export const rejectChange = (id: string, reason: string) => audit('change', 'reject', { id, reason });
export const approveQuit = (id: string) => audit('quit', 'approve', { id });
export const rejectQuit = (id: string, reason: string) => audit('quit', 'reject', { id, reason });

/** 退宿名单 */
export function fetchCheckoutList(query: {
  page?: number;
  size?: number;
  className?: string;
  building?: string;
}): Promise<PageData<CheckoutItem>> {
  return http.get<PageData<CheckoutItem>>('/api/edu/dorm/checkout/list', query as any);
}

/** 导出退宿名单（返回全部数据，前端转 CSV） */
export function exportCheckoutList(query: {
  className?: string;
  building?: string;
}): Promise<CheckoutItem[]> {
  return http.post<CheckoutItem[]>('/api/edu/dorm/checkout/export', query);
}
