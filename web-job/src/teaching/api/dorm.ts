/**
 * 统一宿舍接口封装 · /api/teaching/dorm/*
 * ============================================================
 *
 * 与 class.ts 同构。前端**只认这里的类型**，
 * 不关心数据来自初高 / 大学 / 实训哪个库。
 *
 * 【★ 大学的特殊性】
 *   `/meta` 下发的 `hasCreate=false` —— 大学的宿舍是教务同步来的，
 *   前端据此隐藏新建/编辑/删除/分派按钮（后端还会再拦一次，双保险）。
 */

import { http } from '@/api/request';

export type DormStage = 'jh' | 'class' | 'job';

export const CLASS_DORM_STAGES: DormStage[] = ['jh', 'class', 'job'];

export const DORM_STAGE_NAME: Record<DormStage, string> = {
  jh: '初高',
  class: '大学',
  job: '实训',
};

/** 统一房间状态 1 使用中 / 2 空置 / 3 维修 / 4 停用 */
export const DORM_STATUS_NAME: Record<number, string> = {
  1: '使用中',
  2: '空置',
  3: '维修',
  4: '停用',
};

export const DORM_STATUS_TAG: Record<number, 'success' | 'info' | 'warning' | 'danger'> = {
  1: 'success',
  2: 'info',
  3: 'warning',
  4: 'danger',
};

/** 宿舍性别限制 0 不限 / 1 男 / 2 女 */
export const DORM_GENDER_OPTIONS = [
  { value: 0, label: '不限' },
  { value: 1, label: '男生宿舍' },
  { value: 2, label: '女生宿舍' },
];

/** 床位状态 1 空闲 / 2 已占用 / 3 停用 */
export const DORM_BED_STATUS_NAME: Record<number, string> = {
  1: '空闲',
  2: '已占用',
  3: '停用',
};

export const DORM_CHANGE_NAME: Record<number, string> = {
  1: '调换宿舍',
  2: '退宿',
};

/** 统一审批状态（与审批域同一套口径） */
export const DORM_APPROVAL_NAME: Record<number, string> = {
  1: '待提交',
  2: '待审批',
  3: '待校长',
  4: '已通过',
  5: '已驳回',
  6: '已撤销',
};

export const DORM_APPROVAL_TAG: Record<number, 'success' | 'info' | 'warning' | 'danger'> = {
  1: 'info',
  2: 'warning',
  3: 'warning',
  4: 'success',
  5: 'danger',
  6: 'info',
};

export interface DormRow {
  stage: DormStage;
  stageName: string;
  dormId: string;
  buildingName: string;
  roomNo: string;
  floorNo: number | null;
  dormType: number;
  dormTypeName: string;
  bedCount: number;
  occupiedCount: number;
  occupancyRate: number;
  roomStatus: number;
  roomStatusName: string;
  ownerName: string | null;
  className: string | null;
  remark: string | null;
}

export interface DormBedRow {
  bedId: string;
  bedNo: string;
  bedLabel: string;
  bedStatus: number;
  bedStatusName: string;
  studentId: string | null;
  studentNo: string | null;
  studentName: string | null;
  gender: number | null;
  checkInDate: string | null;
  className: string | null;
}

export interface DormResidentRow {
  /** 所属学段 */
  stage: DormStage;
  studentId: string;
  studentNo: string;
  studentName: string;
  gender: number;
  genderName: string;
  dormId: string;
  roomNo: string;
  bedId: string;
  bedNo: string;
  bedLabel: string;
  checkInDate: string | null;
  classId: string | null;
  className: string | null;
}

export interface DormChangeRow {
  stage: DormStage;
  stageName: string;
  changeId: string;
  bizType: number;
  bizTypeName: string;
  studentId: string;
  studentNo: string | null;
  studentName: string | null;
  gender: number | null;
  phone: string | null;
  classId: string | null;
  className: string | null;
  headTeacherName: string | null;
  oldDormId: string | null;
  oldDormNo: string | null;
  oldBedNo: string | null;
  newDormId: string | null;
  newDormNo: string | null;
  newBedNo: string | null;
  changeDate: string;
  changeReason: string;
  approvalStatus: number;
  approvalStatusName: string;
  canApprove: boolean;
  canCancel: boolean;
  createTime: string | null;
}

export interface DormStageMeta {
  stage: DormStage;
  stageName: string;
  /** ★ 该学段能否新建/编辑房间（大学=false） */
  hasCreate: boolean;
  hasFloor: boolean;
  hasOwner: boolean;
  hasClass: boolean;
  hasRemark: boolean;
  /** 是否有独立床位表（大学=false，床位是虚拟编号） */
  hasBedTable: boolean;
  roomStatusIsInt: boolean;
}

export interface DormSummary {
  stage: DormStage;
  stageName: string;
  roomCount: number;
  bedCount: number;
  occupiedCount: number;
  occupancyRate: number;
  vacantBeds: number;
}

export interface DormQuery {
  stage?: DormStage;
  building?: string;
  dormType?: number;
  roomStatus?: number;
  keyword?: string;
  onlyVacant?: boolean;
  page?: number;
  size?: number;
}

const BASE = '/api/teaching/dorm';

function qs(params: Record<string, unknown>): string {
  const usp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    usp.append(k, String(v));
  });
  const s = usp.toString();
  return s ? `?${s}` : '';
}

/** 1. 房间列表 */
export async function listDorms(q: DormQuery) {
  const r = await http.get(`${BASE}/list${qs(q as Record<string, unknown>)}`);
  return r as unknown as {
    list: DormRow[];
    total: number;
    page: number;
    size: number;
  };
}

/** 2. 房间详情 */
export async function getDormDetail(stage: DormStage, id: string) {
  const r = await http.get(`${BASE}/detail${qs({ stage, id })}`);
  return r as unknown as DormRow;
}

/** 3. 床位列表（含在住学生） */
export async function getDormBeds(stage: DormStage, dormId: string) {
  const r = await http.get(`${BASE}/beds${qs({ stage, dormId })}`);
  return r as unknown as { beds: DormBedRow[]; dorm: DormRow | null };
}

/** 4. 在住学生名单 */
export async function listDormResidents(q: DormQuery) {
  const r = await http.get(`${BASE}/residents${qs(q as Record<string, unknown>)}`);
  return r as unknown as DormResidentRow[];
}

/** 5. 楼栋下拉 */
export async function listDormBuildings(stage?: DormStage) {
  const r = await http.get(`${BASE}/buildings${qs({ stage })}`);
  return r as unknown as Array<{ value: string; label: string }>;
}

/** 6. 元信息 —— 前端靠它隐藏不适用按钮 */
export async function getDormMeta(stage?: DormStage) {
  const r = await http.get(`${BASE}/meta${qs({ stage })}`);
  return r as unknown as DormStageMeta[];
}

/** 7. 统计卡片 */
export async function getDormSummary(q: DormQuery) {
  const r = await http.get(`${BASE}/summary${qs(q as Record<string, unknown>)}`);
  return r as unknown as DormSummary[];
}

/** 8. 保存（新增/修改）—— 大学后端会拦 */
export async function saveDorm(body: Record<string, unknown>) {
  return http.post(`${BASE}/save`, body);
}

/** 9. 删除 —— 大学后端会拦 */
export async function deleteDorm(stage: DormStage, id: string) {
  return http.delete(`${BASE}/delete${qs({ stage, id })}`);
}

/** 10. 分派床位 —— 大学后端会拦 */
export async function assignBed(body: Record<string, unknown>) {
  return http.post(`${BASE}/assign`, body);
}

/** 11. 退宿（直接生效）—— 大学后端会拦 */
export async function checkoutBed(body: Record<string, unknown>) {
  return http.post(`${BASE}/checkout`, body);
}

/** 12. 调宿/退宿申请列表 */
export async function listDormChanges(q: DormQuery) {
  const r = await http.get(`${BASE}/change/list${qs(q as Record<string, unknown>)}`);
  return r as unknown as DormChangeRow[];
}

/** 13. 发起调宿/退宿申请（三学段都允许，含大学） */
export async function createDormChange(body: Record<string, unknown>) {
  return http.post(`${BASE}/change/create`, body);
}
