/**
 * 学生相关类型（全系统核心实体）—— 教务版
 *
 * ⚠️ 与主包 student.ts 同名接口（Student / StudentListItem…），
 *    所以放在 edu 子模块里，独立命名空间，不并进主 index。
 */

import { Gender, StudentStatus, DeptCode, Stage } from './edu-enums.js';
import { BaseEntity, PageQuery } from '../common.js';

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
  /** 重修次数 */
  repeatCount?: number;
  /** 末班次数（大学部用，原型字段 lastClassCount） */
  lastClassCount?: number;
  remark?: string;
  /** 综合素养（长文本评价） */
  quality?: string;
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

  // ===== 下面是「学生档案」页要展示的字段（取自原型）=====
  deptCode?: DeptCode;
  age?: number;
  parentPhone?: string;
  dormNo?: string;
  education?: string;
  enrollDate?: string;
  /** 出勤率，例：92.00（初高中部用） */
  attendanceRate?: number;
  /** 末班次数（大学部用） */
  lastClassCount?: number;
  stage?: Stage;
  /** 双返回，前端直接显示 */
  stageName?: string;
  remark?: string;
  /**
   * 综合素养（长文本评价）
   * ⚠️ 2026-10-03：大学部的列表已按「班级信息管理」的口径把这项并入「备注」，
   *    列表/详情不再单列（初高中部仍单列）。数据字段保留，避免历史数据丢失。
   */
  quality?: string;
  /**
   * 有没有未缴清的费用 → 前端显示「欠费」标记
   *
   * ★ 2026-10-03：与「班级信息管理」（就业）同一字段名、同一展示方式
   *   · edu（教务自己的学生）→ 教务缴费表 t_edu_payment 里有「未缴」且未冻结的记录
   *   · job（实训同步来的）→ 就业库催费单 t_job_fee_call 有未缴清的（call_status != 3）
   */
  hasUnpaid?: boolean;

  // ===== ★ 2026-10-03 合并：来源标记 =====
  /** edu = 教务自己的学生（可编辑）/ job = 实训同步来的（**只读**） */
  source?: 'edu' | 'job';
  /** 来源中文名：教务 / 实训 */
  sourceName?: string;
  /** true = 本页不能编辑（实训学生的唯一数据源在就业模块） */
  readonly?: boolean;
}

/** 学生查询参数 */
export interface StudentQuery extends PageQuery {
  studentNo?: string;
  studentName?: string;
  classId?: string;
  className?: string;
  deptCode?: DeptCode;
  studentStatus?: StudentStatus;
  stage?: Stage;
  keyword?: string;
}

/**
 * 学生档案页统计卡数据（对应原型 renderStats）
 *
 * 口径跟原型一致：
 *   - total    当前部门总人数
 *   - active   状态名含「在读」的（预在读 / 正式在读）
 *   - trial    试学中
 *   - inactive 休学 + 退学
 */
export interface StudentStats {
  total: number;
  active: number;
  trial: number;
  inactive: number;
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

  // ===== 学生档案页涉及的字段（原型）=====
  className?: string;
  dormNo?: string;
  quality?: string;
  stage?: Stage;
  attendanceRate?: number;
  lastClassCount?: number;

  /**
   * 学生状态（见 StudentStatus）
   * ⚠️ 别小看这个字段：改成休学(6)/退学(7) 会连带把该学生的缴费记录自动冻结
   */
  studentStatus?: number;
}
