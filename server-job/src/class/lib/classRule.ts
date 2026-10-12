import { ClassStatus } from 'shared-types/class';
import { Errors } from '../http/response';

/**
 * 班级状态相关的业务规则（需求：班级状态为「封班 / 开放」）
 *
 * 规则：**封班的班级不再接收新生，但可以接收末班 / 重修学生。**
 *
 * 之所以把这条规则抽出来单放，是因为「往班级里塞学生」的入口不止一个：
 *  - 新增学生（student/add）
 *  - 修改学生（student/update，改班级时）
 *  - 咨询接收建档（consult/receive）
 *  - 成绩管理「末班」→ 待接收学员 → 同意入班（grade/repeat-handoff → consult/receive）
 * 任何一处漏判都会让封班失效，因此统一走这里。
 */

/** 该学生是否为「末班 / 重修」学生（重复就读次数 > 0） */
export function isRepeatStudent(student: { repeatCount?: number | null; repeat_count?: number | null } | null | undefined): boolean {
  if (!student) return false;
  const n = student.repeatCount ?? student.repeat_count ?? 0;
  return Number(n) > 0;
}

/**
 * 断言该班级当前可以接收学生。
 *
 * @param cls 班级记录（需含 class_status / class_name）
 * @param allowRepeat 本次接收的学员是否属于「末班 / 重修」（true 则封班也放行）
 */
export function assertClassAcceptStudent(
  cls: Record<string, unknown> | null | undefined,
  allowRepeat: boolean,
): void {
  if (!cls) return;
  const status = Number(cls.class_status);
  if (status === ClassStatus.CLOSED && !allowRepeat) {
    throw Errors.param(
      `班级「${String(cls.class_name ?? '')}」已封班，不再接收新生（仅可接收末班 / 重修学生）`,
    );
  }
}
