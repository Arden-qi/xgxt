/**
 * 宿舍管理接口调用（楼栋 / 房间 / 床位 / 入住 / 调宿 / 退宿）
 */

import { http } from './request';
import type {
  PageData,
  DormBuilding,
  DormBuildingListQuery,
  DormBuildingSavePayload,
  DormRoom,
  DormRoomDetail,
  DormRoomListQuery,
  DormRoomSavePayload,
  DormResident,
  DormResidentListQuery,
  DormDispatchPayload,
  DormCheckoutPayload,
  DormApply,
  DormApplyListQuery,
  DormApplySavePayload,
  DormApprovePayload,
  DormRejectPayload,
} from 'shared-types/class-jh';

/* ---------------- 楼栋 / 房间 / 入住 ---------------- */

/** 楼栋列表 */
export function fetchBuildingList(query: DormBuildingListQuery): Promise<PageData<DormBuilding>> {
  return http.get<PageData<DormBuilding>>('/api/class-jh/dorm/building/list', query);
}

/** 新增楼栋 */
export function addBuilding(payload: DormBuildingSavePayload): Promise<{ buildingId: string }> {
  return http.post<{ buildingId: string }>('/api/class-jh/dorm/building/add', payload);
}

/** 修改楼栋 */
export function updateBuilding(payload: DormBuildingSavePayload & { buildingId: string }): Promise<{ buildingId: string }> {
  return http.put<{ buildingId: string }>('/api/class-jh/dorm/building/update', payload);
}

/** 房间列表 */
export function fetchRoomList(query: DormRoomListQuery): Promise<PageData<DormRoom>> {
  return http.get<PageData<DormRoom>>('/api/class-jh/dorm/room/list', query);
}

/** 房间详情（含床位） */
export function fetchRoomDetail(id: string): Promise<DormRoomDetail> {
  return http.get<DormRoomDetail>('/api/class-jh/dorm/room/detail', { id });
}

/** 新增房间（床位按床位数自动生成） */
export function addRoom(payload: DormRoomSavePayload): Promise<{ roomId: string }> {
  return http.post<{ roomId: string }>('/api/class-jh/dorm/room/add', payload);
}

/** 修改房间（床位数变化会同步床位） */
export function updateRoom(payload: DormRoomSavePayload & { roomId: string }): Promise<{ roomId: string }> {
  return http.put<{ roomId: string }>('/api/class-jh/dorm/room/update', payload);
}

/** 入住名单 */
export function fetchResidentList(query: DormResidentListQuery): Promise<PageData<DormResident>> {
  return http.get<PageData<DormResident>>('/api/class-jh/dorm/resident/list', query);
}

/** 分派床位 */
export function dispatchDorm(payload: DormDispatchPayload): Promise<{ residentId: string }> {
  return http.post<{ residentId: string }>('/api/class-jh/dorm/dispatch/add', payload);
}

/** 退宿（释放床位） */
export function checkoutDorm(payload: DormCheckoutPayload): Promise<{ checkoutId: string }> {
  return http.post<{ checkoutId: string }>('/api/class-jh/dorm/checkout', payload);
}

/* ---------------- 调宿申请 ---------------- */

/** 调宿列表 */
export function fetchDormApplyList(query: DormApplyListQuery): Promise<PageData<DormApply>> {
  return http.get<PageData<DormApply>>('/api/class-jh/dormApply/list', query);
}

/** 新增调宿申请 */
export function addDormApply(payload: DormApplySavePayload): Promise<{ id: string }> {
  return http.post<{ id: string }>('/api/class-jh/dormApply/add', payload);
}

/** 调宿审批（须物品完好） */
export function approveDormApply(payload: DormApprovePayload): Promise<null> {
  return http.post<null>('/api/class-jh/dormApply/approve', payload);
}

/** 调宿驳回 */
export function rejectDormApply(payload: DormRejectPayload): Promise<null> {
  return http.post<null>('/api/class-jh/dormApply/reject', payload);
}
