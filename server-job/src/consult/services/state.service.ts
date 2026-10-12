/**
 * ⭐ 咨询学生状态流转服务（本模块的业务中枢）
 *
 * ⚠️ 这个文件承载了三条跨模块规则里的第 1 条：
 *    规则1：学生状态转「休学」→ 财务自动冻结餐费/住宿费
 *
 *    实现方式：任何状态变更都走 changeState()，
 *    它内部会调财务 /freeze/sync。这样不管是「发起退费」「转正式」还是
 *    以后加的新流转入口，都不会漏掉同步。
 *
 * ⚠️ 为什么不直接让前端调财务的 sync？
 *    ① 前端不知道怎么映射咨询状态 → 学籍状态
 *    ② 同步失败不该阻断主流程（退费申请必须能提交）
 *    ③ 集中一处做，将来加日志/重试只改这里
 */

import {
  ConsultState,
  CONSULT_STATE_NAME,
  CONSULT_TO_STUDENT_STATUS,
} from 'shared-types/consult';
import { db } from '../utils/db';
import { STUDENT_TABLE, addHistory, findStudent, formatTime } from './student.service';
import { financeClient } from './finance.client';

/** 状态变更的附带信息 */
export interface ChangeStateOptions {
  /** 操作人姓名 */
  byName: string;
  /** 操作人岗位 */
  byTitle?: string;
  /** 要写入跟进历史的描述 */
  historyText?: string;
  /** 动作标识 */
  action?: string;
  /** 额外要更新的字段（如 class_name / trial_start / loss_reason / student_status） */
  extraFields?: Record<string, any>;
  /**
   * 是否同步学籍状态给财务模块
   * ⚠️ 默认 true。只有一种情况传 false：
   *    变更本身就是财务触发的（如财务打款后回写状态），避免来回调用
   */
  syncFinance?: boolean;
}

/**
 * ⭐ 变更咨询状态（唯一入口）
 *
 * 做四件事：
 *   1. 更新 t_consult_student 的状态字段
 *   2. 写一条跟进历史
 *   3. 映射成学籍状态 → 调财务 /freeze/sync（规则1）
 *   4. 返回同步结果（不抛错，只记录）
 */
export async function changeState(
  consultStudentId: string,
  nextState: ConsultState,
  opts: ChangeStateOptions,
): Promise<{ synced: boolean; syncMessage?: string; freezeCount?: number; unfreezeCount?: number }> {
  const stu = await findStudent(consultStudentId);
  if (!stu) {
    return { synced: false, syncMessage: '学生不存在' };
  }

  const studentStatus = CONSULT_TO_STUDENT_STATUS[nextState];

  // ---- 1. 更新状态 ----
  await db(STUDENT_TABLE)
    .where({ id: consultStudentId })
    .update({
      consult_state: nextState,
      student_status: studentStatus,
      update_time: new Date(),
      update_by: opts.byName,
      ...(opts.extraFields || {}),
    });

  // ---- 2. 写跟进历史 ----
  if (opts.historyText) {
    await addHistory(consultStudentId, opts.byName, opts.historyText, opts.byTitle, opts.action);
  }

  // ---- 3. 同步财务（规则1 的落点）----
  if (opts.syncFinance === false) {
    return { synced: false, syncMessage: '按调用方要求跳过同步' };
  }

  try {
    const res = await financeClient.syncStudentStatus({
      studentId: consultStudentId,
      studentStatus,
      changeTime: formatTime(new Date()),
      studentNo: stu.student_no || undefined,
      studentName: stu.student_name || undefined,
      classId: stu.class_id || undefined,
      className: stu.class_name || undefined,
      deptCode: stu.dept_code || undefined,
    });

    // 有冻结/解冻动作时，补一条历史，让学生详情页能看到财务侧发生了什么
    if (res.freezeCount > 0) {
      await addHistory(
        consultStudentId,
        '财务模块',
        `因学籍状态变更，财务自动冻结 ${res.freezeCount} 条餐费/住宿费缴费单`,
        '系统',
        'FINANCE_FREEZE',
      );
    }
    if (res.unfreezeCount > 0) {
      await addHistory(
        consultStudentId,
        '财务模块',
        `学籍状态恢复，财务自动解冻 ${res.unfreezeCount} 条缴费单`,
        '系统',
        'FINANCE_UNFREEZE',
      );
    }

    return {
      synced: true,
      syncMessage: res.message,
      freezeCount: res.freezeCount,
      unfreezeCount: res.unfreezeCount,
    };
  } catch (err: any) {
    // ⚠️ 关键设计：同步失败**不阻断**主流程，只记历史 + 返回状态
    //    理由：财务服务可能临时没起，但学生的退费申请不能因此提交不了
    const msg = err?.message || '未知错误';
    await addHistory(
      consultStudentId,
      '系统',
      `⚠️ 学籍状态同步财务失败：${msg}（数据已保存，可稍后在财务侧手工处理）`,
      '系统',
      'SYNC_FAILED',
    );
    console.error('[财务同步失败]', consultStudentId, msg);
    return { synced: false, syncMessage: msg };
  }
}

/**
 * 直接从学籍状态变更（不经过咨询状态）
 *
 * ⚠️ 用途：休学/退学这类由外部（教务模块）发起的状态变更，
 *    只影响财务冻结，不改咨询流转状态。
 */
export async function syncStudentStatusOnly(
  consultStudentId: string,
  studentStatus: number,
  byName: string,
  historyText?: string,
): Promise<{ synced: boolean; syncMessage?: string }> {
  const stu = await findStudent(consultStudentId);
  if (!stu) return { synced: false, syncMessage: '学生不存在' };

  await db(STUDENT_TABLE).where({ id: consultStudentId }).update({
    student_status: studentStatus,
    update_time: new Date(),
    update_by: byName,
  });

  try {
    const res = await financeClient.syncStudentStatus({
      studentId: consultStudentId,
      studentStatus,
      changeTime: formatTime(new Date()),
      studentNo: stu.student_no || undefined,
      studentName: stu.student_name || undefined,
      classId: stu.class_id || undefined,
      className: stu.class_name || undefined,
      deptCode: stu.dept_code || undefined,
    });
    if (historyText) {
      await addHistory(consultStudentId, byName, historyText);
    }
    return { synced: true, syncMessage: res.message };
  } catch (err: any) {
    const msg = err?.message || '未知错误';
    await addHistory(consultStudentId, '系统', `⚠️ 学籍状态同步财务失败：${msg}`);
    return { synced: false, syncMessage: msg };
  }
}

/** 取状态中文名（供消息拼接） */
export function stateName(s: ConsultState): string {
  return CONSULT_STATE_NAME[s] || String(s);
}
