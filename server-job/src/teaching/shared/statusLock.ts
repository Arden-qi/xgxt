/**
 * 学生状态锁（2026-10-21 批注）
 * ============================================================
 * 批注原文（班级管理 · 详情 · 花名册「状态」列，红框圈整列）：
 *   「学生状态为【退学】的，任何操作都不可更改该状态」
 *
 * 【口径】
 *   · 退学(7) = **永久锁**：一旦学生落到 7，任何入口都不允许再把他改成别的值
 *     （编辑学生档案、升实训、升就业、标记已就业…）。
 *   · 与 `leave/service.ts#TERMINAL_STUDENT_STATUSES` 的区别：
 *     那个是「能不能再给他办学籍异动单子」（退学/流失/已就业都算，是**入口收窄**）；
 *     这里是「状态字段本身能不能被改写」，目前**只有退学**一个值，是**写保护**。
 *     ⚠️ 两个常量职责不同，不要合并：流失(11)/已就业(10) 仍走各自的既有链路。
 *
 * ⚠️ 只在后端拦是不够的：前端对应的状态下拉要同时 disabled（见
 *    `web-job/src/teaching/views/TeachingStudent.vue#isStatusLocked`），
 *    否则用户能选、点了才报错，白填一遍表单。
 */

import { BizCode, StudentStatus } from 'shared-types';
import { BizError } from '../../middleware/errorHandler';

/** 一旦落到这些状态，学生状态字段就被锁死（目前只有「退学」） */
export const LOCKED_STUDENT_STATUSES: readonly number[] = [StudentStatus.QUIT];

/** 该状态是否已被锁定（null/undefined 视为未锁定，新增学生不受影响） */
export function isStatusLocked(status: unknown): boolean {
  if (status === null || status === undefined || status === '') return false;
  const n = Number(status);
  if (!Number.isFinite(n)) return false;
  return LOCKED_STUDENT_STATUSES.includes(n);
}

/** 锁定时的统一提示文案 */
export function lockedStatusMessage(subject = '该学生'): string {
  return `${subject}已「退学」，学生状态不可更改（退学状态为终态）`;
}

/** 状态已锁定 → 抛业务异常（不锁则静默返回） */
export function assertStatusUnlocked(current: unknown, subject = '该学生'): void {
  if (!isStatusLocked(current)) return;
  throw new BizError(BizCode.PARAM_ERROR, lockedStatusMessage(subject));
}
