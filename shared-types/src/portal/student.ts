/**
 * 学生相关类型（全系统核心实体）
 */

import { Gender, StudentStatus, DeptCode } from './enums';
import { BaseEntity, PageQuery } from './common';

/** 学生实体（完整） */
export interface Student extends BaseEntity {
  /** 学号 S20260001 */
  studentNo: string;
  /** 姓名 */
  studentName: string;
  gender: Gender;
  age?: number;
  deptCode: DeptCode;
  classId?: string;
  className?: string;
  headTeacherId?: string;
  headTeacherName?: string;
  teacherId?: string;
  teacherName?: string;
  assistantId?: string;
  assistantName?: string;
  studentStatus: StudentStatus;
  /** 学习阶段 */
  stage?: number;
  phone?: string;
  parentPhone?: string;
  dormId?: string;
  dormNo?: string;
  /** 学历 */
  education?: string;
  /** 入学时间 YYYY-MM-DD */
  enrollDate?: string;
  /** 出勤率 */
  attendanceRate?: number;
  /** 末班次数 */
  repeatCount?: number;
  remark?: string;
}

/** 学生列表项（列表页用，字段从简） */
export interface StudentListItem {
  studentId: string;
  studentNo: string;
  studentName: string;
  gender: Gender;
  /** 双返回，前端直接显示 */
  genderName: string;
  className?: string;
  studentStatus: StudentStatus;
  /** 双返回 */
  studentStatusName: string;
  phone?: string;
  headTeacherName?: string;
}

/** 学生查询参数 */
export interface StudentQuery extends PageQuery {
  studentNo?: string;
  studentName?: string;
  classId?: string;
  deptCode?: DeptCode;
  studentStatus?: StudentStatus;
  keyword?: string;
}

/** 学生新增/编辑参数 */
export interface StudentSavePayload {
  studentNo: string;
  studentName: string;
  gender: Gender;
  age?: number;
  deptCode: DeptCode;
  classId?: string;
  phone?: string;
  parentPhone?: string;
  education?: string;
  enrollDate?: string;
  remark?: string;
}
