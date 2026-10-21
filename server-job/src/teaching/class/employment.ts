/**
 * 升就业（2026-10-21 批注）
 * ============================================================
 * 批注原文（班级管理页，红框在操作列的「升实训」）：
 *   「【升实训】操作之后出现【升就业】，点击【升就业】该操作弹出
 *     是否将该班级学生状态改为（待就业）」
 *
 * 【口径】
 *   ① 入口只在**实训班**（`t_job_class` 里 `stage_key='job'`）上出现 ——
 *      这些班就是「升实训」造出来的，所以「升实训之后才有升就业」天然成立。
 *   ② 只改**学生状态**：班里每个学生 `t_student_base.student_status`
 *      实训中(8) → 待就业(9)；班级本身不搬、不改名、不换部门。
 *      （学生档案页 / 班级详情花名册读的都是这份状态，三处自动一致。）
 *   ③ 已经是「待就业(9)」的跳过（重复点不重复写），
 *      已经是「已就业(10)」的**不降级** —— 已就业是终态，不能被一次误点拉回待就业。
 *
 * ⚠️ 与「升实训」不同：这里不跨库、不建班、不写花名册，只是批量改状态，
 *    所以不放进 training.ts，单独一个文件更不容易误改到搬迁逻辑。
 */

import { BizCode, StudentStatus } from 'shared-types';
import { BizError } from '../../middleware/errorHandler';
import { db } from '../../utils/db';
import { tbl } from '../shared/uniTable';
import { assertStageView } from './service';

const T = 't_job_class';
const ROSTER_T = 't_job_class_student';
const STUDENT_T = 't_student_base';
const STAGE = 'job' as const;

export interface EmploymentUpgradeInput {
  classId: string;
}

export interface EmploymentUpgradeResult {
  className: string;
  /** 本次真正改成「待就业」的人数 */
  updated: number;
  /** 已经是待就业 / 已就业，跳过的学生数 */
  skipped: number;
}

export async function upgradeClassToEmployment(
  input: EmploymentUpgradeInput,
  user: any,
): Promise<EmploymentUpgradeResult> {
  // 升就业只发生在实训班，权限按「实训」学段校验
  await assertStageView(user, 'job');

  const classId = String(input.classId ?? '').trim();
  if (!classId) throw new BizError(BizCode.PARAM_ERROR, '缺少班级ID');

  const cls = (await tbl(db, 'sms_job', T, STAGE)
    .where({ id: classId, is_deleted: 0 })
    .first()) as Record<string, any> | undefined;
  if (!cls) throw new BizError(BizCode.CLASS_NOT_FOUND, '班级不存在或已删除');
  if (String(cls.stage_key ?? '') !== 'job') {
    throw new BizError(BizCode.PARAM_ERROR, '「升就业」只能用于实训班级');
  }

  const roster = (await tbl(db, 'sms_job', ROSTER_T, STAGE)
    .where({ class_id: classId, is_deleted: 0 })
    .select('student_id')) as Array<Record<string, any>>;
  const ids = roster.map((r) => String(r.student_id)).filter(Boolean);
  if (!ids.length) throw new BizError(BizCode.PARAM_ERROR, '该班级没有学生');

  // 只动「还没到待就业/已就业」的学生
  const updated = await tbl(db, 'sms_job', STUDENT_T, STAGE)
    .whereIn('id', ids)
    .whereNotIn('student_status', [StudentStatus.WAIT_EMPLOY, StudentStatus.EMPLOYED])
    .update({
      student_status: StudentStatus.WAIT_EMPLOY,
      update_time: new Date(),
      update_by: user?.userId || 'system',
    });

  return {
    className: String(cls.class_name ?? ''),
    updated: Number(updated) || 0,
    skipped: Math.max(ids.length - (Number(updated) || 0), 0),
  };
}
