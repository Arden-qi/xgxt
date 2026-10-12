/**
 * 考试与成绩相关类型（就业管理 > 实训阶段）
 *
 * ⚠️ 字段来源：`docs/考试成绩-字段定稿.md`
 *    后端返回、前端展示都必须用这里的类型，不许自己编字段名。
 */

import { ExamType, ExamResult } from './enums';
import { BaseEntity, PageQuery } from './common';

/* ============================================================
 * 一、考试（t_job_exam）
 * ============================================================ */

/** 考试实体（完整） */
export interface Exam extends BaseEntity {
  /** 考试名称，如「一期月考」 */
  examName: string;
  examType: ExamType;
  /** 考试时间 YYYY-MM-DD HH:mm:ss */
  examTime: string;
  /** 考试班级ID，英文逗号拼接，如 "C001,C002" */
  classIds: string;
  /** 考试班级名快照，英文逗号拼接 */
  classNames: string;
  /** 考试内容，英文逗号拼接。本期固定 "1,2,3"（笔试+机试+面试） */
  contentTypes: string;
  creatorId?: string;
  creatorName?: string;
  remark?: string;
}

/** 考试列表项（列表页用） */
export interface ExamListItem {
  examId: string;
  examName: string;
  examType: ExamType;
  /** 双返回，前端直接显示 */
  examTypeName: string;
  examTime: string;
  classIds: string;
  classNames: string;
  contentTypes: string;
  /** 双返回，如 "笔试、机试、面试" */
  contentTypesName: string;
  creatorName?: string;
  /** 该场考试已录入成绩的人数（有分数的） */
  scoredCount?: number;
  /** 该场考试学生总数 */
  totalCount?: number;
  remark?: string;
  createTime?: string;
}

/** 考试查询参数 */
export interface ExamQuery extends PageQuery {
  examName?: string;
  examType?: ExamType;
  /** YYYY-MM-DD */
  startDate?: string;
  /** YYYY-MM-DD */
  endDate?: string;
  keyword?: string;
}

/** 考试新增/编辑参数 */
export interface ExamSavePayload {
  examName: string;
  examType: ExamType;
  examTime: string;
  /** 班级ID数组，后端拼成逗号字符串存库 */
  classIds: string[];
  /** 与 classIds 一一对应的班级名，后端拼成快照 */
  classNames?: string[];
  /** 本期固定 [1,2,3] */
  contentTypes?: number[];
  remark?: string;
}

/* ============================================================
 * 二、成绩（t_job_exam_score）
 * ============================================================ */

/** 成绩实体（完整） */
export interface ExamScore extends BaseEntity {
  examId: string;
  examName: string;
  studentId: string;
  studentNo: string;
  studentName: string;
  /** 班级快照（考试当时所在班） */
  classId?: string;
  className?: string;
  /** 卷面成绩 0-100 */
  paperScore?: number;
  /** 机试成绩 0-100 */
  machineScore?: number;
  /** 笔试部分均分（自动算：卷面×50% + 机试×50%），两项都填才有值 */
  writtenAvg?: number;
  /** 面试成绩 0-100 */
  interviewScore?: number;
  /** 综合成绩（自动算：笔试均分×50% + 面试×50%），三项都填才有值 */
  totalScore?: number;
  /** 考试结果：1通过 2未通过(末班)；null/undefined = 未判断 */
  examResult?: ExamResult;
  remark?: string;
  entryBy?: string;
  entryByName?: string;
  /** 录入时间 YYYY-MM-DD HH:mm:ss */
  entryTime?: string;
}

/** 成绩列表项（列表页用） */
export interface ExamScoreListItem {
  scoreId: string;
  examId: string;
  examName: string;
  studentId: string;
  studentNo: string;
  studentName: string;
  classId?: string;
  className?: string;
  paperScore?: number;
  machineScore?: number;
  writtenAvg?: number;
  interviewScore?: number;
  totalScore?: number;
  examResult?: ExamResult;
  /** 双返回，如 "未通过"；未判断时为空串 */
  examResultName: string;
  /** 该生当前末班次数（从学生表带过来，便于老师判断） */
  repeatCount?: number;
  remark?: string;
  entryByName?: string;
  entryTime?: string;
}

/** 成绩查询参数 */
export interface ExamScoreQuery extends PageQuery {
  examId?: string;
  classId?: string;
  studentNo?: string;
  studentName?: string;
  /** 考试结果筛选：1通过 2未通过 */
  examResult?: ExamResult;
  /** true = 只看未录入成绩的（分数为空） */
  onlyUnscored?: boolean;
}

/** 成绩录入/修改参数 */
export interface ExamScoreSavePayload {
  id: string;
  paperScore?: number;
  machineScore?: number;
  interviewScore?: number;
  remark?: string;
}

/* ============================================================
 * 三、成绩汇总（只读统计）
 * ============================================================ */

/** 按班级统计的一行 */
export interface ExamSummaryRow {
  classId?: string;
  className: string;
  /** 该班学生总数 */
  studentCount: number;
  /** 已录入成绩人数 */
  scoredCount: number;
  /** 综合成绩平均分（保留 2 位），无数据时为 null */
  avgScore: number | null;
  /** 综合成绩最高分 */
  maxScore: number | null;
  /** 综合成绩最低分 */
  minScore: number | null;
  /** 标为末班的人数 */
  repeatCount: number;
}

/** 成绩汇总响应 */
export interface ExamSummary {
  examId: string;
  examName: string;
  examTime: string;
  classNames: string;
  /** 全部班合计 */
  total: ExamSummaryRow;
  /** 分班明细 */
  rows: ExamSummaryRow[];
}
