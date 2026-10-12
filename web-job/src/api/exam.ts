/**
 * 考试管理 + 成绩管理 接口调用（就业管理 > 实训阶段）
 *
 * ⚠️ 要点：
 *   1. 路径与后端 /api/job/exam、/api/job/exam-score 完全一致
 *   2. 返回类型从 shared-types 引，字段写错会编译报错
 *   3. 泛型写的是「data 里的类型」（http.xxx 已经帮你解包了）
 */

import { http } from './request';
import type {
  PageData,
  Exam,
  ExamListItem,
  ExamQuery,
  ExamSavePayload,
  ExamScore,
  ExamScoreListItem,
  ExamScoreQuery,
  ExamScoreSavePayload,
  ExamSummary,
} from 'shared-types';

/* ============ 一、考试管理 ============ */

/** 查询考试列表 */
export function fetchExamList(query: ExamQuery): Promise<PageData<ExamListItem>> {
  return http.get<PageData<ExamListItem>>('/api/job/exam/page', query);
}

/**
 * 考试下拉选项（「成绩管理」页专用）
 *
 * ⚠️ 别用 fetchExamList 来做下拉 —— 它走 /api/job/exam 前缀，需要
 *    「考试管理」页面权限，而班主任/教员/助教都没有（考试管理只给校长）。
 *    会弹「您没有该操作的权限」，虽然不影响录分但很吓人。
 */
export function fetchExamOptions(): Promise<ExamListItem[]> {
  return http.get<ExamListItem[]>('/api/job/exam-score/exam-options');
}

/** 查询考试详情 */
export function fetchExamDetail(id: string): Promise<Exam> {
  return http.get<Exam>('/api/job/exam/detail', { id });
}

/** 新建考试（后端会自动带出所选班级全体学生到成绩表） */
export function addExam(payload: ExamSavePayload): Promise<{ id: string; studentCount: number }> {
  return http.post<{ id: string; studentCount: number }>('/api/job/exam/add', payload);
}

/** 编辑考试 */
export function updateExam(payload: ExamSavePayload & { id: string }): Promise<null> {
  return http.put<null>('/api/job/exam/update', payload);
}

/** 删除考试（逻辑删除，级联删成绩） */
export function deleteExam(id: string): Promise<null> {
  return http.delete<null>(`/api/job/exam/delete/${id}`);
}

/** 成绩汇总（按班级统计） */
export function fetchExamSummary(id: string): Promise<ExamSummary> {
  return http.get<ExamSummary>('/api/job/exam/summary', { id });
}

/* ============ 二、成绩管理 ============ */

/** 查询成绩列表 */
export function fetchExamScoreList(query: ExamScoreQuery): Promise<PageData<ExamScoreListItem>> {
  return http.get<PageData<ExamScoreListItem>>('/api/job/exam-score/page', query);
}

/** 录入 / 修改分数（后端自动重算两个均分） */
export function updateExamScore(payload: ExamScoreSavePayload): Promise<ExamScore> {
  return http.put<ExamScore>('/api/job/exam-score/update', payload);
}

/**
 * 标末班（★ 改版：选目标班 + 填原因 → 自动转班 + 通知目标班班主任）
 *
 * 后端一次做完 6 件事：标状态 / 原班离班 / 目标班入班 / 学生改班级 / 次数+1 / 发通知
 */
export function markRepeat(
  id: string,
  payload: { targetClassId: string; repeatReason: string; repeatDate?: string },
): Promise<{
  repeatCount: number;
  targetClassName: string;
  targetHeadTeacherName: string | null;
  leftFromClassName: string | null;
  noticeId: string | null;
  notified: boolean;
}> {
  return http.post(`/api/job/exam-score/repeat/${id}`, payload);
}

/**
 * 撤销末班（★ 改版：状态回退 + 次数 -1 + 学生转回原班）
 *
 * rollbackClass = 是否真的回退了班级；false 表示没找到原班记录，班级未动
 */
export function cancelRepeat(id: string): Promise<{
  repeatCount: number;
  rollbackClass: boolean;
  restoredClassName: string | null;
}> {
  return http.post(`/api/job/exam-score/cancel-repeat/${id}`);
}
