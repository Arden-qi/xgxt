/**
 * 统一班级信息接口（第 2 期）· 前端封装
 * ============================================================
 *
 * 一套接口服务**三个学段**，学段由 `stage` 区分（jh / class / job）。
 *
 * 【★ 三个学段字段不同，前端必须靠 meta 隐藏不适用的输入框】
 *   hasClassCode —— 只有实训有「班级编号」（另两段那两张表根本没这列）
 *   hasCloseDate —— 只有实训有「结业日期」
 *   classroomLabel —— 大学叫"教室"、实训叫"教室地点"、初高叫"教室"
 *
 * 【★ 出勤率有两种口径，不能混看】
 *   attendanceRateKind='today'（初高）→ 今日出勤率
 *   attendanceRateKind='total'（大学/实训）→ 累计出勤率
 *   列头要按 kind 动态改字，否则会误读。
 */

import { http } from '@/api/request';

export type ClassStage = 'jh' | 'class' | 'job';

export type AttendanceRateKind = 'today' | 'total' | null;

export interface ClassRow {
  stage: ClassStage;
  stageName: string;
  classId: string;
  className: string;
  /** ★ 只有实训有；其它学段恒 null */
  classCode: string | null;
  deptCode: number | null;
  deptName: string;
  phaseCode: number | null;
  phaseName: string;
  /** ★ 2026-10-16：阶段方案（老班级为 null，回显退回 phaseName） */
  schemeId: string | null;
  schemeStageId: string | null;
  schemeStageName: string | null;
  headTeacherId: string | null;
  headTeacherName: string | null;
  teacherId: string | null;
  teacherName: string | null;
  assistantId: string | null;
  assistantName: string | null;
  projectManagerId: string | null;
  projectManagerName: string | null;
  employmentTeacherId: string | null;
  employmentTeacherName: string | null;
  universityNo: string | null;
  classroom: string | null;
  openDate: string | null;
  /** ★ 只有实训有 */
  closeDate: string | null;
  studentCount: number;
  classStatus: number;
  classStatusName: string;
  canChangeStatus: boolean;
  attendanceRate: number | null;
  /** ★ 这个数字是「今日」还是「累计」 */
  attendanceRateKind: AttendanceRateKind;
  remark: string | null;
  createTime: string | null;
}

export interface ClassRosterRow {
  studentId: string;
  studentNo: string | null;
  studentName: string | null;
  gender: number;
  genderName: string;
  joinType: number | null;
  joinTypeName: string;
  joinDate: string | null;
  inClassStatus: number | null;
  inClassStatusName: string;
}

export interface ClassDetail {
  base: ClassRow;
  roster: ClassRosterRow[];
  /** 当前状态下允许流转到的目标状态 */
  allowedStatus: number[];
  extra: Record<string, unknown> | null;
}

export interface ClassListParams {
  stage?: ClassStage;
  deptCode?: number;
  classStatus?: number;
  phaseCode?: number;
  keyword?: string;
  page?: number;
  size?: number;
}

export interface ClassSaveBody {
  stage: ClassStage;
  id?: string;
  className: string;
  classCode?: string | null;
  deptCode?: number | null;
  phaseCode?: number | null;
  /** ★ 2026-10-16：阶段方案（先选方案、再选阶段；不选则走老的阶段码） */
  schemeId?: string | null;
  schemeStageId?: string | null;
  schemeStageName?: string | null;
  headTeacherId?: string | null;
  headTeacherName?: string | null;
  teacherId?: string | null;
  teacherName?: string | null;
  assistantId?: string | null;
  assistantName?: string | null;
  projectManagerId?: string | null;
  projectManagerName?: string | null;
  employmentTeacherId?: string | null;
  employmentTeacherName?: string | null;
  universityNo?: string | null;
  classroom?: string | null;
  openDate?: string | null;
  closeDate?: string | null;
  classStatus?: number;
  remark?: string | null;
}

export interface ClassStageMeta {
  stage: ClassStage;
  stageName: string;
  hasClassCode: boolean;
  hasCloseDate: boolean;
  hasSealAction: boolean;
  classroomLabel: string;
  phaseOptions: Array<{ value: number; label: string }>;
}

export interface ClassSummary {
  stage: ClassStage;
  stageName: string;
  total: number;
  openCount: number;
  closedCount: number;
  graduatingCount: number;
  graduatedCount: number;
  studentCount: number;
}

export interface ClassOption {
  stage: ClassStage;
  stageName: string;
  classId: string;
  className: string;
  classStatus: number;
  classStatusName: string;
}

export function listClasses(params: ClassListParams) {
  return http.get<{ list: ClassRow[]; total: number; page: number; size: number }>(
    '/api/teaching/class/list',
    params,
  );
}

export function getClassDetail(stage: ClassStage, id: string) {
  return http.get<ClassDetail>('/api/teaching/class/detail', { stage, id });
}

export function getClassRoster(stage: ClassStage, id: string) {
  return http.get<ClassRosterRow[]>('/api/teaching/class/roster', { stage, id });
}

export function saveClass(body: ClassSaveBody) {
  return http.post<{ id: string }>('/api/teaching/class/save', body);
}

export function deleteClass(stage: ClassStage, id: string) {
  return http.delete<null>('/api/teaching/class/delete', { stage, id });
}

export function changeClassStatus(stage: ClassStage, id: string, classStatus: number) {
  return http.post<null>('/api/teaching/class/change-status', { stage, id, classStatus });
}

export function getClassMeta() {
  return http.get<ClassStageMeta[]>('/api/teaching/class/meta');
}

export function getClassSummary(params: ClassListParams) {
  return http.get<ClassSummary[]>('/api/teaching/class/summary', params);
}

export function getClassOptions() {
  return http.get<ClassOption[]>('/api/teaching/class/options');
}

/**
 * ★ 2026-10-16：阶段方案选项（表单「阶段方案 / 阶段」两个下拉的数据源）
 *
 * 方案统一存放在初高库、按部门区分（1 初高部 / 2 大学部）——
 * 三个学段共用这一份，前端按表单里选中的「部门」过滤；
 * 「阶段」下拉的选项 = 选中方案的 stages（阶段名称 + 学制）。
 */
export interface SchemeStageOption {
  id: string;
  stageName: string;
  studyMonths: number | null;
  sortNo: number;
}

export interface SchemeOption {
  id: string;
  schemeName: string;
  deptCode: number;
  deptName: string;
  stages: SchemeStageOption[];
}

export function getSchemeOptions() {
  return http.get<SchemeOption[]>('/api/teaching/class/scheme-options');
}

/** 生成班级编号（只有实训有；其它学段返回 null，前端应隐藏入口） */
export function genClassCode(stage: ClassStage) {
  return http.get<{ classCode: string | null }>('/api/teaching/class/gen-code', { stage });
}

/** 班级状态（★ 三套完全一致，无需映射） */
export const CLASS_STATUS_NAME: Record<number, string> = {
  1: '开放',
  2: '封班',
  3: '待结业',
  4: '已结业',
};

/** 状态 → Element Plus tag 类型 */
export const CLASS_STATUS_TAG: Record<number, string> = {
  1: 'success',
  2: 'info',
  3: 'warning',
  4: 'danger',
};

export const CLASS_STAGE_NAME: Record<ClassStage, string> = {
  jh: '初高',
  class: '大学',
  job: '实训',
};

export const CLASS_STAGES: ClassStage[] = ['jh', 'class', 'job'];

export const DEPT_OPTIONS = [
  { value: 1, label: '初高部' },
  { value: 2, label: '大学部' },
];