/**
 * 接口契约：宿舍管理（楼栋 / 房间 / 床位 / 入住 / 调宿 / 退宿）
 *
 * 路径前缀：/api/class/dorm、/api/class/dormApply
 */

import { ApiResponse, PageResponse } from '../common';
import { DormBuilding, DormRoom, DormBed, DormResident, DormApply } from '../class';
import { ApplyStatus, DormType } from '../enums';

/* ---------------- 楼栋 ---------------- */

/** 楼栋列表查询参数 */
export interface DormBuildingListQuery {
  page?: number;
  size?: number;
  keyword?: string;
}

/** 楼栋列表响应 */
export type DormBuildingListResponse = PageResponse<DormBuilding>;

/** 楼栋新增 / 修改入参 */
export interface DormBuildingSavePayload {
  /** 修改时必传；新增不传 */
  buildingId?: string;
  /** 楼栋名称 ★ */
  buildingName: string;
  /** 所属校区 */
  campusName?: string;
  /** 楼层数 */
  floorCount?: number;
  /** 楼管姓名 */
  managerName?: string;
  /** 楼管电话 */
  managerPhone?: string;
  /** 对接部门 */
  deptName?: string;
  /** 状态 使用中/停用 */
  buildingStatus?: string;
}

/** 楼栋新增 / 修改响应 */
export type DormBuildingSaveResponse = ApiResponse<{ buildingId: string }>;

/* ---------------- 房间 ---------------- */

/** 房间列表查询参数 */
export interface DormRoomListQuery {
  page?: number;
  size?: number;
  classId?: string;
  dormType?: DormType;
  roomStatus?: string;
  occupiedCountMin?: number;
}

/** 房间列表响应 */
export type DormRoomListResponse = PageResponse<DormRoom>;

/** 房间详情（含床位） */
export interface DormRoomDetail extends DormRoom {
  beds: DormBed[];
}

/** 房间详情响应 */
export type DormRoomDetailResponse = ApiResponse<DormRoomDetail>;

/**
 * 房间新增 / 修改入参
 *
 * 说明：床位由「房间 + 床位数」自动生成/同步，前端不逐个维护床位，只传 bedCount。
 */
export interface DormRoomSavePayload {
  /** 修改时必传；新增不传 */
  roomId?: string;
  /** 所属楼栋 ★ */
  buildingId: string;
  /** 房间号（如 3-201）★ */
  roomNo: string;
  /** 楼层 */
  floorNo?: number;
  /** 宿舍类型 1 男宿舍 / 2 女宿舍 ★（创建时必选） */
  dormType: DormType;
  /** 床位数 ★ */
  bedCount: number;
  /** 负责人 */
  ownerName?: string;
  /** 状态 使用中/空置/维修/停用 */
  roomStatus?: string;
  /** 所属班级（混班留空） */
  classId?: string;
  className?: string;
}

/** 房间新增 / 修改响应 */
export type DormRoomSaveResponse = ApiResponse<{ roomId: string }>;

/* ---------------- 入住 ---------------- */

/** 入住列表查询参数 */
export interface DormResidentListQuery {
  page?: number;
  size?: number;
  roomId?: string;
  classId?: string;
  keyword?: string;
}

/** 入住列表响应 */
export type DormResidentListResponse = PageResponse<DormResident>;

/** 床位分派入参 */
export interface DormDispatchPayload {
  studentId: string;
  roomId: string;
  bedId: string;
  checkInDate?: string;
}

/** 床位分派响应 */
export type DormDispatchResponse = ApiResponse<{ residentId: string }>;

/** 退宿入参 */
export interface DormCheckoutPayload {
  studentId: string;
  roomId?: string;
  bedId?: string;
  checkoutReason?: string;
}

/** 退宿响应 */
export type DormCheckoutResponse = ApiResponse<{ checkoutId: string }>;

/* ---------------- 调宿申请 ---------------- */

/** 调宿列表查询参数 */
export interface DormApplyListQuery {
  page?: number;
  size?: number;
  applyStatus?: ApplyStatus;
  classId?: string;
  keyword?: string;
}

/** 调宿列表响应 */
export type DormApplyListResponse = PageResponse<DormApply>;

/** 调宿申请入参 */
export interface DormApplySavePayload {
  studentId: string;
  fromRoomId: string;
  fromBedId?: string;
  toRoomId: string;
  toBedId: string;
  applyReason: string;
}

/** 调宿申请响应 */
export type DormApplyAddResponse = ApiResponse<{ id: string }>;

/** 调宿审批入参 */
export interface DormApprovePayload {
  id: string;
  isItemIntact: boolean;
}

/** 调宿驳回入参 */
export interface DormRejectPayload {
  id: string;
  rejectReason: string;
}

/** 调宿审批 / 驳回响应 */
export type DormApproveResponse = ApiResponse<null>;
export type DormRejectResponse = ApiResponse<null>;
