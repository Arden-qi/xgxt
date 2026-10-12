import { BaseEntity } from './common';
import { ApplyStatus, DormType, OuterSyncStatus } from './enums';

/**
 * 宿舍信息
 *
 * 数据来源：**同步自教务管理**（本模块保存只读副本 t_class_dorm_sync）
 * 依据需求：「宿舍信息接口：同步教务管理的宿舍信息」
 */

/** 宿舍楼栋 */
export interface DormBuilding extends BaseEntity {
  buildingName: string;
  dormType: DormType;
  dormTypeName?: string;
  floorCount: number;
  roomCount: number;
}

/** 宿舍房间 */
export interface DormRoom extends BaseEntity {
  buildingId: string;
  buildingName: string;
  dormType: DormType;
  dormTypeName?: string;
  /** 宿舍号，如 A栋-301 */
  dormNo: string;
  /** 床位总数 */
  bedCount: number;
  /** 已住人数 */
  usedCount: number;
  /** 是否满员 */
  isFull: boolean;
  /** 宿舍长 */
  leaderStudentId?: string;
  leaderStudentName?: string;
  /** 同步状态 */
  syncStatus: OuterSyncStatus;
  syncStatusName?: string;
  /** 上游数据最后变更时间 */
  sourceUpdateTime?: string;
}

/** 宿舍住宿信息（学员 ↔ 宿舍，同步自教务管理） */
export interface DormLive extends BaseEntity {
  studentId: string;
  studentNo: string;
  studentName: string;
  classId?: string;
  className?: string;
  dormId: string;
  dormNo: string;
  /** 入住日期 YYYY-MM-DD */
  checkInDate?: string;
  syncStatus: OuterSyncStatus;
  syncStatusName?: string;
  sourceUpdateTime?: string;
}

/** 调宿记录 */
export interface DormChangeLog extends BaseEntity {
  studentId: string;
  studentNo: string;
  studentName: string;
  fromDormId?: string;
  fromDormNo?: string;
  toDormId?: string;
  toDormNo?: string;
  changeTime: string;
  changeReason: string;
}

/** 宿舍申请（换宿 / 退宿） */
export interface DormApply extends BaseEntity {
  applyNo: string;
  /** 1 换宿 2 退宿 */
  applyCategory: number;
  applyCategoryName?: string;
  studentId: string;
  studentNo: string;
  studentName: string;
  className?: string;
  fromDormId?: string;
  fromDormNo?: string;
  toDormId?: string;
  toDormNo?: string;
  applyReason: string;
  applyStatus: ApplyStatus;
  applyStatusName?: string;
  /** 驳回原因（applyStatus = REJECTED 时必填） */
  rejectReason?: string;
  /** 物品完好确认（applyStatus = APPROVED 前必须确认） */
  hasGoodsChecked?: boolean;
  applicantName?: string;
  applyTime: string;
  approverName?: string;
  approveTime?: string;
}

export interface DormQuery {
  page: number;
  size: number;
  buildingId?: string;
  dormType?: DormType;
  keyword?: string;
  /** 只看未满员的宿舍 */
  onlyAvailable?: boolean;
}

export interface DormApplyQuery {
  page: number;
  size: number;
  applyCategory?: number;
  applyStatus?: ApplyStatus;
  keyword?: string;
}
