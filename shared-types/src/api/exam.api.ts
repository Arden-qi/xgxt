/**
 * 接口契约：考试管理 + 成绩管理（就业管理 > 实训阶段）
 *
 * ⚠️ 这是「接口契约」的写法示范，各模块照这个格式写自己的 xxx.api.ts
 *    前端调用时必须 import 这里的响应类型，字段写错会编译报错。
 */

import { ApiResponse, PageResponse } from '../common';
import {
  Exam,
  ExamListItem,
  ExamScore,
  ExamScoreListItem,
  ExamSummary,
} from '../exam';

/* ============================================================
 * 一、考试管理
 * 提供方：就业管理-实训（马志斌）
 * 路径前缀：/api/job/exam
 * ============================================================ */

/** 接口 1：查询考试列表   GET /api/job/exam/page */
export type ExamListResponse = PageResponse<ExamListItem>;

/** 接口 2：查询考试详情   GET /api/job/exam/detail?id=xxx */
export type ExamDetailResponse = ApiResponse<Exam>;

/** 接口 3：新建考试   POST /api/job/exam/add */
export type ExamAddResponse = ApiResponse<{ id: string; studentCount: number }>;

/** 接口 4：编辑考试   PUT /api/job/exam/update */
export type ExamUpdateResponse = ApiResponse<null>;

/** 接口 5：删除考试（逻辑删除）   DELETE /api/job/exam/delete/:id */
export type ExamDeleteResponse = ApiResponse<null>;

/** 接口 6：成绩汇总   GET /api/job/exam/summary?id=xxx */
export type ExamSummaryResponse = ApiResponse<ExamSummary>;

/* ============================================================
 * 二、成绩管理
 * 路径前缀：/api/job/exam-score
 * ============================================================ */

/** 接口 7：查询成绩列表   GET /api/job/exam-score/page */
export type ExamScoreListResponse = PageResponse<ExamScoreListItem>;

/** 接口 8：录入/修改分数   PUT /api/job/exam-score/update */
export type ExamScoreUpdateResponse = ApiResponse<ExamScore>;

/** 接口 9：标末班   POST /api/job/exam-score/repeat/:id */
export type ExamScoreRepeatResponse = ApiResponse<{ repeatCount: number }>;

/** 接口 10：撤销末班   POST /api/job/exam-score/cancel-repeat/:id */
export type ExamScoreCancelRepeatResponse = ApiResponse<{ repeatCount: number }>;
