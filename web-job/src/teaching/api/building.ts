/**
 * 宿舍楼栋设置接口 · /api/teaching/building/*
 * ============================================================
 *
 * 【一份字典、两个入口】
 *   ① 教学管理 → 系统设置 →「楼栋设置」页签（增删改）
 *   ② 教学管理 → 宿舍管理 → 楼栋筛选 / 新增房间的楼栋下拉（只读）
 *
 *   两边调用的都是这里的三个函数、打的都是同一张 `t_dorm_building`，
 *   所以在设置页新增「4号楼」，宿舍管理那边刷新就多一项，**不需要改任何代码**。
 *
 * 【为什么要单独一个文件，不塞进 teaching/api/dorm.ts】
 *   dorm.ts 是「宿舍管理页」的私有接口层（房间/床位/换宿单）。
 *   楼栋设置会被「系统设置页」引用 —— 让系统设置页去 import 宿舍页的接口文件，
 *   是一条不该存在的跨模块依赖（宿舍页改名/重构会连带打挂设置页）。
 */

import { http } from '@/api/request';

export interface DormBuildingRow {
  id: string;
  buildingName: string;
  /** 1 男寝 / 2 女寝 / null 未分类 */
  category: number | null;
  sortNo: number;
  remark: string | null;
}

export interface DormBuildingSavePayload {
  id?: string;
  buildingName: string;
  category: number;
  sortNo?: number;
  remark?: string;
}

const BASE = '/api/teaching/building';

/** 1. 楼栋列表（设置页 + 宿舍下拉共用） */
export async function listDormBuildings(): Promise<DormBuildingRow[]> {
  const r = await http.get(`${BASE}/list`);
  return (r as unknown as DormBuildingRow[]) || [];
}

/** 2. 新增 / 修改楼栋 */
export function saveDormBuilding(body: DormBuildingSavePayload): Promise<unknown> {
  return http.post(`${BASE}/save`, body);
}

/** 3. 删除楼栋（名下还有宿舍时后端会拒绝） */
export function deleteDormBuilding(id: string): Promise<unknown> {
  return http.delete(`${BASE}/delete`, { id });
}
