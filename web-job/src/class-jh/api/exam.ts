/**
 * 考试管理接口调用（考试 / 成绩）
 */

import { http } from './request';
import type {
  PageData,
  Exam,
  ExamDetail,
  ExamListQuery,
  ExamSavePayload,
  ExamScore,
  ExamScoreListQuery,
  ExamScoreSavePayload,
  ExamApprovePayload,
} from 'shared-types/class-jh';

/* ---------------- 考试 ---------------- */

/** 考试列表 */
export function fetchExamList(query: ExamListQuery): Promise<PageData<Exam>> {
  return http.get<PageData<Exam>>('/api/class-jh/exam/list', query);
}

/** 考试详情（含自定义字段 + 成绩汇总） */
export function fetchExamDetail(id: string): Promise<ExamDetail> {
  return http.get<ExamDetail>('/api/class-jh/exam/detail', { id });
}

/** 新增考试 */
export function addExam(payload: ExamSavePayload): Promise<{ id: string }> {
  return http.post<{ id: string }>('/api/class-jh/exam/add', payload);
}

/** 修改考试 */
export function updateExam(payload: ExamSavePayload & { id: string }): Promise<null> {
  return http.put<null>('/api/class-jh/exam/update', payload);
}

/** 提交考试（草稿→已提交） */
export function submitExam(id: string): Promise<null> {
  return http.post<null>('/api/class-jh/exam/submit', { id });
}

/* ---------------- 成绩 ---------------- */

/** 成绩列表 */
export function fetchExamScoreList(query: ExamScoreListQuery): Promise<PageData<ExamScore>> {
  return http.get<PageData<ExamScore>>('/api/class-jh/examScore/list', query);
}

/** 成绩录入（自动判定 examResult） */
export function saveExamScores(payload: ExamScoreSavePayload): Promise<{ saved: number }> {
  return http.post<{ saved: number }>('/api/class-jh/examScore/save', payload);
}

/** 结业成绩审批（经理决定 isPassed） */
export function approveExam(payload: ExamApprovePayload): Promise<null> {
  return http.post<null>('/api/class-jh/examScore/approve', payload);
}
