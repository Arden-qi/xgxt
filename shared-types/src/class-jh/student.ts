/**
 * 学生相关类型（全系统核心实体）
 *
 * 教学管理（初高）模块在原有基础上补全字段（见 ARCH §4.3）：
 *   - StudentListItem 追加展示字段（age/stage/parentPhone/dormNo…）
 *   - Student 追加档案字段（birthDate/homeAddress/idCardNo…）
 *   - 新增 StudentSavePayload（本模块允许修改的字段白名单）
 */

import { Gender, StudentStatus, DeptCode, AgreementStatus, FlowType } from './enums';
import { BaseEntity, PageQuery } from './common';

/** 学生实体（完整） */
export interface Student extends BaseEntity {
  /** 学号 S20260001 */
  studentNo: string;
  /** 姓名 */
  studentName: string;
  gender: Gender;
  /** 性别中文名（双返回，列表/详情返回） */
  genderName?: string;
  /** 出生日期 YYYY-MM-DD */
  birthDate?: string;
  age?: number;
  /** 籍贯 */
  nativePlace?: string;
  deptCode: DeptCode;
  /** 部门中文名（双返回，列表/详情返回） */
  deptName?: string;
  classId?: string;
  className?: string;
  headTeacherId?: string;
  headTeacherName?: string;
  teacherId?: string;
  teacherName?: string;
  assistantId?: string;
  assistantName?: string;
  studentStatus: StudentStatus;
  /** 学生状态中文名（双返回，列表/详情返回） */
  studentStatusName?: string;
  /** 审批中的流程类型 ★ */
  pendingFlowType?: FlowType;
  /** 审批中流程类型中文名（双返回，列表/详情返回） */
  pendingFlowTypeName?: string;
  /** 学习阶段 101~107 / 201~204 */
  stage?: number;
  /** 学习阶段中文名（双返回，列表/详情返回） */
  stageName?: string;
  /** 学历 */
  education?: string;
  /** 毕业院校 ★ */
  graduateSchool?: string;
  /** 入学时间 YYYY-MM-DD */
  enrollDate?: string;
  phone?: string;
  parentPhone?: string;
  /** 家庭住址 ★ */
  homeAddress?: string;
  /** 身份证号 ★ */
  idCardNo?: string;
  /** 就业协议状态 ★ */
  agreementStatus?: AgreementStatus;
  /** 证件照 ★ */
  idPhotoUrl?: string;
  /** 户口本照片 ★ */
  householdPhotoUrl?: string;
  /** 校园网账号 ★ */
  netAccount?: string;
  /** 校园网初始密码 ★ */
  netInitPassword?: string;
  /** 招生老师姓名/电话 ★ */
  recruitTeacherName?: string;
  recruitTeacherPhone?: string;
  /** 咨询老师姓名/电话 ★ */
  consultTeacherName?: string;
  consultTeacherPhone?: string;
  dormId?: string;
  dormNo?: string;
  /** 床位号 ★ */
  bedNo?: string;
  /** 出勤率 */
  attendanceRate?: number;
  /** 末班次数 */
  repeatCount?: number;
  remark?: string;
  /** 综合素养（自由文本） */
  literacyDesc?: string;
}

/** 学生列表项（列表页用，含展示所需冗余字段） */
export interface StudentListItem {
  studentId: string;
  studentNo: string;
  studentName: string;
  gender: Gender;
  /** 双返回，前端直接显示 */
  genderName: string;
  age?: number;
  deptCode: DeptCode;
  /** 双返回 */
  deptName: string;
  classId?: string;
  className?: string;
  headTeacherName?: string;
  studentStatus: StudentStatus;
  /** 双返回 */
  studentStatusName: string;
  stage?: number;
  /** 双返回 */
  stageName: string;
  phone?: string;
  parentPhone?: string;
  dormNo?: string;
  education?: string;
  enrollDate?: string;
  attendanceRate?: number;
  literacyDesc?: string;
  repeatCount?: number;
  pendingFlowType?: FlowType;
  /** 双返回 */
  pendingFlowTypeName?: string;
  remark?: string;
}

/** 学生查询参数 */
export interface StudentQuery extends PageQuery {
  studentNo?: string;
  studentName?: string;
  classId?: string;
  deptCode?: DeptCode;
  studentStatus?: StudentStatus;
  stage?: number;
  keyword?: string;
}

/**
 * 学生修改白名单（本模块允许改的字段）
 * ⚠️ 不含 classId/stage/studentStatus/dormId —— 这些只能走流程入口改。
 */
export interface StudentSavePayload {
  studentName: string;
  gender: Gender;
  birthDate?: string;
  nativePlace?: string;
  education?: string;
  graduateSchool?: string;
  enrollDate?: string;
  homeAddress?: string;
  phone?: string;
  parentPhone?: string;
  agreementStatus?: AgreementStatus;
  remark?: string;
  literacyDesc?: string;
  idCardNo?: string;
}
