/**
 * 宿舍管理 接口响应类型
 */

import type {
  DormListItem,
  DormDetail,
  DormChangeListItem,
  DormChangeDetail,
  DormStudentOption,
  DormBedOption,
  DormSummary,
  DormStudentBedItem,
} from '../dorm.js';

/** 宿舍列表响应 */
export interface DormListResp {
  list: DormListItem[];
  total: number;
  page: number;
  size: number;
}

/** 宿舍详情响应 */
export type DormDetailResp = DormDetail;

/** 宿舍新增/编辑响应 */
export interface DormSaveResp {
  id: string;
  dormNo: string;
}

/** 调换/退宿列表响应 */
export interface DormChangeListResp {
  list: DormChangeListItem[];
  total: number;
  page: number;
  size: number;
}

/** 调换/退宿详情响应 */
export type DormChangeDetailResp = DormChangeDetail;

/** 调换/退宿新增响应 */
export interface DormChangeSaveResp {
  id: string;
  changeNo: string;
}

/** 审批动作结果 */
export interface DormChangeApprovalResult {
  finished: boolean;
  approvalStatus: number;
  approvalStatusName: string;
}

/** 统计卡片 */
export type DormChangeSummary = DormSummary;

/** 可选学生 */
export type DormStudentOptionResp = DormStudentOption;

/** 可选床位 */
export type DormBedOptionResp = DormBedOption;

/** 入住明细（按学生看） */
export type DormStudentBedResp = DormStudentBedItem;
