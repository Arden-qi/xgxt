/**
 * 接口契约：班级管理（班级主档 / 师资交接 / 学期）
 *
 * 路径前缀：/api/class/classInfo、/api/class/handover、/api/class/term
 */

import { ApiResponse, PageResponse } from '../common';
import { ClassInfo, ClassHandover, ClassTerm } from '../class';
import { ClassStatus } from '../enums';

/* ---------------- 班级主档 ---------------- */

/** 班级列表查询参数 */
export interface ClassInfoListQuery {
  page?: number;
  size?: number;
  className?: string;
  stage?: number;
  classStatus?: ClassStatus;
  headTeacherId?: string;
  teacherId?: string;
  keyword?: string;
}

/** 班级列表响应 */
export type ClassInfoListResponse = PageResponse<ClassInfo>;

/** 班级详情（含交接历史 + 学期） */
export interface ClassInfoDetail extends ClassInfo {
  handovers: ClassHandover[];
  terms: ClassTerm[];
  students?: any[];
}

/** 班级详情响应 */
export type ClassInfoDetailResponse = ApiResponse<ClassInfoDetail>;

/** 班级新增/编辑入参 */
export interface ClassInfoSavePayload {
  className: string;
  stage: number;
  headTeacherId: string;
  /** 班主任姓名：NOT NULL 列，必填（班级列表/详情直接展示，避免空串丢失可读性） */
  headTeacherName: string;
  teacherId: string;
  /** 教员姓名：NOT NULL 列，必填 */
  teacherName: string;
  assistantId?: string;
  assistantName?: string;
  classroom?: string;
  openDate?: string;
  deptCode?: number;
  classStatus?: ClassStatus;
  remark?: string;
}

/** 班级新增响应 */
export type ClassInfoAddResponse = ApiResponse<{ id: string }>;

/** 班级修改/删除响应 */
export type ClassInfoUpdateResponse = ApiResponse<null>;
export type ClassInfoDeleteResponse = ApiResponse<null>;

/** 班级下拉选项查询参数（转班/复学/末班用） */
export interface ClassInfoOptionsQuery {
  stage?: number;
  excludeGraduated?: boolean;
}

/** 班级下拉选项响应 */
export type ClassInfoOptionsResponse = ApiResponse<ClassInfo[]>;

/* ---------------- 师资交接 ---------------- */

/** 交接列表查询参数 */
export interface HandoverListQuery {
  page?: number;
  size?: number;
  classId?: string;
  startDate?: string;
  endDate?: string;
}

/** 交接列表响应 */
export type HandoverListResponse = PageResponse<ClassHandover>;

/** 交接新增入参 */
export interface HandoverSavePayload {
  classId: string;
  handoverRole: number;
  toUserId: string;
  /** 接管人姓名：NOT NULL 列，必填（会回写班级与学生冗余姓名） */
  toUserName: string;
  handoverReason?: string;
  handoverContent: string;
}

/** 交接新增响应 */
export type HandoverAddResponse = ApiResponse<{ id: string }>;

/* ---------------- 学期 ---------------- */

/** 学期列表响应 */
export type ClassTermListResponse = ApiResponse<ClassTerm[]>;

/** 学期新增入参 */
export interface ClassTermSavePayload {
  classId: string;
  termName: string;
  startDate?: string;
  endDate?: string;
  remark?: string;
}

/** 学期新增响应 */
export type ClassTermAddResponse = ApiResponse<{ id: string }>;
