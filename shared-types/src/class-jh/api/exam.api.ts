/**
 * 接口契约：考试管理（考试 / 成绩 / 自定义字段）
 *
 * 路径前缀：/api/class/exam、/api/class/examScore
 */

import { ApiResponse, PageResponse } from '../common';
import { Exam, ExamScore, ExamField } from '../class';
import { ExamStatus } from '../enums';

/* ---------------- 考试 ---------------- */

/** 考试列表查询参数 */
export interface ExamListQuery {
  page?: number;
  size?: number;
  examType?: number;
  classId?: string;
  startDate?: string;
  endDate?: string;
  headTeacherId?: string;
  teacherId?: string;
  examStatus?: ExamStatus;
  keyword?: string;
}

/** 考试列表响应 */
export type ExamListResponse = PageResponse<Exam>;

/** 考试详情（含自定义字段 + 成绩汇总） */
export interface ExamDetail extends Exam {
  fields: ExamField[];
  scoreSummary?: {
    totalCount: number;
    passCount: number;
    failCount: number;
    avgScore: number;
  };
}

/** 考试详情响应 */
export type ExamDetailResponse = ApiResponse<ExamDetail>;

/** 考试新增/编辑入参 */
export interface ExamSavePayload {
  examName: string;
  examType: number;
  examDate: string;
  classId: string;
  examContentTypes: number[];
  contentFullScore?: Record<string, number>;
  customFields?: Array<{ fieldName: string; fieldType: number; sortNo?: number }>;
  scoreTeacherIds?: string[];
  judgeIds?: string[];
  remark?: string;
}

/** 考试新增响应 */
export type ExamAddResponse = ApiResponse<{ id: string }>;

/** 考试修改 / 提交响应 */
export type ExamUpdateResponse = ApiResponse<null>;
export type ExamSubmitResponse = ApiResponse<null>;

/* ---------------- 考试成绩 ---------------- */

/** 成绩列表查询参数 */
export interface ExamScoreListQuery {
  page?: number;
  size?: number;
  examId?: string;
  classId?: string;
  keyword?: string;
}

/** 成绩列表响应 */
export type ExamScoreListResponse = PageResponse<ExamScore>;

/** 成绩录入单项 */
export interface ExamScoreSaveItem {
  studentId: string;
  scoreWritten?: number;
  scoreMachine?: number;
  scoreInterview?: number;
  scoreOther?: number;
  scoreTeacherId?: string;
  customValues?: Record<string, any>;
  remark?: string;
}

/** 成绩录入入参 */
export interface ExamScoreSavePayload {
  examId: string;
  classId: string;
  scores: ExamScoreSaveItem[];
}

/** 成绩录入响应 */
export type ExamScoreSaveResponse = ApiResponse<{ saved: number }>;

/** 结业成绩审批入参（经理决定 isPassed） */
export interface ExamApprovePayload {
  examId: string;
  studentId?: string;
  isPassed: boolean;
}

/** 结业成绩审批响应 */
export type ExamApproveResponse = ApiResponse<null>;
