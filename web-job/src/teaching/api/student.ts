/**
 * 统一学生档案接口（第 2 期）· 前端封装
 * ============================================================
 *
 * 一套接口服务**四个学段**（比别的域多一个「教务/edu」），学段由 `stage` 区分。
 *
 * 【「全部」的语义】不传 stage = 合并当前账号可见的学段 + 按学号去重。
 *   —— 这正是原来「教务」页提供的「全校总台账」能力（原页自己拼了三个库）。
 */

import { http } from '@/api/request';

export type StudentStage = 'jh' | 'class' | 'job' | 'edu';

export interface StudentRow {
  stage: StudentStage;
  stageName: string;
  studentId: string;
  studentNo: string;
  studentName: string;
  gender: number;
  genderName: string;
  age: number | null;
  deptCode: number | null;
  deptName: string;
  classId: string | null;
  className: string | null;
  phaseCode: number | null;
  phaseName: string;
  headTeacherId: string | null;
  headTeacherName: string | null;
  teacherId: string | null;
  teacherName: string | null;
  assistantId: string | null;
  assistantName: string | null;
  studentStatus: number;
  studentStatusName: string;
  phone: string | null;
  /** 家长姓名（2026-10-15 学生档案改版新增） */
  parentName: string | null;
  parentPhone: string | null;
  education: string | null;
  enrollDate: string | null;
  dormId: string | null;
  dormNo: string | null;
  bedNo: string | null;
  bedLabel: string | null;
  attendanceRate: number | null;
  repeatCount: number;
  idCard: string | null;
  nativePlace: string | null;
  graduateSchool: string | null;
  homeAddress: string | null;
  recruitTeacherName: string | null;
  recruitTeacherPhone: string | null;
  consultTeacherName: string | null;
  consultTeacherPhone: string | null;
  remark: string | null;
  createTime: string | null;
}

export interface StudentDetail {
  base: StudentRow;
  profile: {
    birthDate: string | null;
    nativePlace: string | null;
    idCard: string | null;
    graduateSchool: string | null;
    homeAddress: string | null;
    idPhotoUrl: string | null;
    householdPhotoUrl: string | null;
  };
  market: {
    recruitTeacherName: string | null;
    recruitTeacherPhone: string | null;
    consultTeacherName: string | null;
    consultTeacherPhone: string | null;
  };
  dorm: {
    dormId: string | null;
    dormNo: string | null;
    bedNo: string | null;
    bedLabel: string | null;
    building: string | null;
  } | null;
  quality: Record<string, unknown> | null;
  net: Record<string, unknown> | null;
  resume: Record<string, unknown> | null;
  flows: Array<Record<string, unknown>>;
  repeats: Array<Record<string, unknown>>;
  extra: Record<string, unknown> | null;
}

export interface StudentListParams {
  stage?: StudentStage;
  classId?: string;
  deptCode?: number;
  studentStatus?: number;
  phaseCode?: number;
  keyword?: string;
  unassigned?: boolean;
  page?: number;
  size?: number;
}

export interface StudentSaveBody {
  stage: StudentStage;
  id?: string;
  studentNo?: string;
  studentName: string;
  gender: number;
  birthDate?: string | null;
  age?: number | null;
  nativePlace?: string | null;
  deptCode?: number | null;
  classId?: string | null;
  className?: string | null;
  phaseCode?: number | null;
  studentStatus?: number;
  education?: string | null;
  graduateSchool?: string | null;
  enrollDate?: string | null;
  phone?: string | null;
  /** 家长姓名（2026-10-15 学生档案改版新增） */
  parentName?: string | null;
  parentPhone?: string | null;
  homeAddress?: string | null;
  idCard?: string | null;
  recruitTeacherName?: string | null;
  recruitTeacherPhone?: string | null;
  consultTeacherName?: string | null;
  consultTeacherPhone?: string | null;
  dormId?: string | null;
  dormNo?: string | null;
  bedNo?: string | null;
  /** 校园网账号（初高表有列；留空时系统自动生成） */
  netAccount?: string | null;
  netInitPassword?: string | null;
  remark?: string | null;
  extra?: Record<string, unknown> | null;
}

export interface StudentSaveResult {
  id: string;
  frozenCount?: number;
  unfrozenCount?: number;
}

/** 详情扩展区块（2026-10-15 详情分签改版）：考试信息 / 调宿记录 / 宿舍长 */
export interface StudentExtras {
  scores: Array<{
    id: string;
    examId: string;
    examName: string;
    examDate: string | null;
    examType?: number | null;
    examTypeName?: string | null;
    studentId: string;
    studentNo: string | null;
    studentName: string | null;
    writtenScore: number | null;
    machineScore: number | null;
    interviewScore: number | null;
    totalScore: number | null;
    remark: string | null;
  }>;
  dormChanges: Array<{
    changeId: string;
    bizType: number;
    bizTypeName: string;
    studentId: string;
    oldDormNo: string | null;
    oldBedNo: string | null;
    newDormNo: string | null;
    newBedNo: string | null;
    changeDate: string;
    changeReason: string;
    approvalStatus: number;
    approvalStatusName: string;
  }>;
  dormOwnerName: string | null;
  dormClassName: string | null;
}

export interface StudentStageMeta {
  stage: StudentStage;
  stageName: string;
  phaseOptions: Array<{ value: number; label: string }>;
  sections: string[];
  supportUnassigned: boolean;
}

export interface StudentSummary {
  total: number;
  studying: number;
  trial: number;
  suspended: number;
  quit: number;
  unassigned: number;
}

export function listStudents(params: StudentListParams) {
  return http.get<{ list: StudentRow[]; total: number; page: number; size: number }>(
    '/api/teaching/student/list',
    params,
  );
}

export function getStudentDetail(stage: StudentStage, id: string) {
  return http.get<StudentDetail>('/api/teaching/student/detail', { stage, id });
}

/** 详情扩展区块：考试信息 / 调宿记录 / 宿舍长（2026-10-15 详情分签改版） */
export function getStudentExtras(stage: StudentStage, id: string) {
  return http.get<StudentExtras>('/api/teaching/student/extras', { stage, id });
}

export function saveStudent(body: StudentSaveBody) {
  return http.post<StudentSaveResult>('/api/teaching/student/save', body);
}

export function deleteStudent(stage: StudentStage, id: string) {
  return http.delete<null>('/api/teaching/student/delete', { stage, id });
}

export function getStudentMeta() {
  return http.get<StudentStageMeta[]>('/api/teaching/student/meta');
}

export function getStudentSummary(params: StudentListParams) {
  return http.get<StudentSummary>('/api/teaching/student/summary', params);
}
