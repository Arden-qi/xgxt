import { DeptCode, Gender, StudentStatus } from './enums';
import { BaseEntity } from './common';

/**
 * 学生实体
 *
 * 字段归属（依据需求「学生信息部分由咨询管理同步，剩余部分可由班主任补充」）：
 *  - 同步自市场咨询：studentNo / studentName / gender / deptCode / phone / parentPhone
 *  - 班主任补充：班级 / 班主任 / 学历 / 入学时间 / 档案类字段（出生日期、籍贯、毕业院校、家庭住址、照片）
 */
export interface Student extends BaseEntity {
  /** 学号，格式 S + 年份 + 4 位序号，如 S20260001 */
  studentNo: string;
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
  /** 学习阶段，取值见数据字典 4.4（按部门区分） */
  stage?: number;
  phone?: string;
  parentPhone?: string;
  /** 身份证号（休学 / 退学申请表要用） */
  idCard?: string;
  dormId?: string;
  dormNo?: string;
  /** 学历 */
  education?: string;
  /** 入学时间 YYYY-MM-DD */
  enrollDate?: string;
  attendanceRate?: number;
  /** 末班次数 */
  repeatCount?: number;
  remark?: string;
}

/** 学生列表项（列表页返回的简化版） */
export interface StudentListItem {
  studentId: string;
  studentNo: string;
  studentName: string;
  gender: Gender;
  /** 双返回：前端直接用，不维护映射表 */
  genderName: string;
  age?: number;
  classId?: string;
  className?: string;
  studentStatus: StudentStatus;
  studentStatusName: string;
  phone?: string;
  parentPhone?: string;
  headTeacherName?: string;
}

/** 学生档案补充信息（班主任维护） */
export interface StudentProfile {
  /** 出生日期 YYYY-MM-DD */
  birthDate?: string;
  /** 籍贯 */
  origin?: string;
  /** 毕业院校 */
  graduateSchool?: string;
  /** 家庭住址 */
  homeAddress?: string;
  /** 身份证照片 URL */
  idPhotoUrl?: string;
  /** 户口本照片 URL */
  householdPhotoUrl?: string;
}

/** 学生市场信息（同步自市场咨询，本模块只读） */
export interface StudentMarket {
  recruitTeacherId?: string;
  recruitTeacherName?: string;
  recruitPhone?: string;
  consultTeacherId?: string;
  consultTeacherName?: string;
  consultPhone?: string;
}

/** 学生综合素质（班主任评价） */
export interface StudentQuality {
  studyStatus?: string;
  discipline?: string;
  ability?: string;
  comprehension?: string;
  expression?: string;
  social?: string;
  note?: string;
}

/** 学生查询参数 */
export interface StudentQuery {
  page: number;
  size: number;
  studentNo?: string;
  studentName?: string;
  classId?: string;
  deptCode?: DeptCode;
  studentStatus?: StudentStatus;
  keyword?: string;
}
