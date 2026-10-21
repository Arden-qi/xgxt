/**
 * 班级 · 学生换班（末班 / 升班）
 * ============================================================
 * 【业务口径（2026-10-20 用户确认）】
 *   末班：成绩不好 → 转到「进度相同或更慢」的班重修（进度 = 阶段码 stage_code）
 *   升班：成绩好 → 跳到「进度更快」的班
 *
 * 【数据落点】全部在 sms_common 的统一表，可放同一个事务里：
 *   · t_uni_student        学生的班籍（class_id/class_name + 目标班三岗老师快照）
 *   · t_uni_class_student  实训侧的成员表（job 才有行，jh/class 为空）
 *   · t_uni_class_transfer 换班留痕（from → to + 原因 + 时间）
 *   · t_uni_repeat         末班记录（含本场考试快照）+ 学生 repeat_count + 1
 *
 * ⚠️ 这里是「直接生效」，不走 `t_class_consult_push` 的待接收审批流。
 *    若要走审批，应改为 push + 目标班主任接收。
 */

import { randomUUID } from 'crypto';
import { BizCode } from 'shared-types';
import { BizError } from '../../middleware/errorHandler';
import { uniDb } from '../shared/uniTable';
import { assertClassInScope } from '../shared/dataScope';
import type { ClassStage } from '../shared/dto';

export type TransferMode = 'repeat' | 'promote';

type ClassRow = {
  id: string;
  class_name: string;
  stage_code: number | null;
  class_status: number | null;
  head_teacher_id: string | null;
  head_teacher_name: string | null;
  teacher_id: string | null;
  teacher_name: string | null;
  assistant_id: string | null;
  assistant_name: string | null;
};

/** 已结业（CLASS_STATUS 4）的班不再作为换班目标 */
const CLOSED_STATUS = 4;

async function classOf(stage: ClassStage, id: string): Promise<ClassRow> {
  const row = (await uniDb('t_uni_class')
    .where({ id, edu_stage: stage, is_deleted: 0 })
    .first()) as Record<string, any> | undefined;
  if (!row) throw new BizError(BizCode.PARAM_ERROR, '班级不存在');
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    id: String(row.id),
    class_name: String(row.class_name ?? ''),
    stage_code: n(row.stage_code),
    class_status: n(row.class_status),
    head_teacher_id: (row.head_teacher_id as string) ?? null,
    head_teacher_name: (row.head_teacher_name as string) ?? null,
    teacher_id: (row.teacher_id as string) ?? null,
    teacher_name: (row.teacher_name as string) ?? null,
    assistant_id: (row.assistant_id as string) ?? null,
    assistant_name: (row.assistant_name as string) ?? null,
  };
}

/**
 * 可选目标班级
 * @param mode repeat = 末班（进度 ≤ 当前）；promote = 升班（进度 > 当前）
 */
export async function transferTargets(
  stage: ClassStage,
  fromClassId: string,
  mode: TransferMode,
): Promise<Array<{ id: string; name: string; stageCode: number | null; headTeacherName: string | null }>> {
  const from = await classOf(stage, fromClassId);
  const rows = (await uniDb('t_uni_class')
    .where({ edu_stage: stage, is_deleted: 0 })
    .select('id', 'class_name', 'stage_code', 'class_status', 'head_teacher_name')) as Array<Record<string, any>>;

  return rows
    .filter((r) => String(r.id) !== from.id)
    .filter((r) => Number(r.class_status ?? 0) !== CLOSED_STATUS)
    .filter((r) => {
      if (from.stage_code === null) return true; // 进度未知 → 不拦，人工判断
      const sc = r.stage_code === null || r.stage_code === undefined ? null : Number(r.stage_code);
      if (sc === null) return true;
      return mode === 'repeat' ? sc <= from.stage_code : sc > from.stage_code;
    })
    .map((r) => ({
      id: String(r.id),
      name: String(r.class_name ?? ''),
      stageCode: r.stage_code === null || r.stage_code === undefined ? null : Number(r.stage_code),
      headTeacherName: (r.head_teacher_name as string) ?? null,
    }))
    .sort((a, b) => (b.stageCode ?? 0) - (a.stageCode ?? 0));
}

export async function transferStudent(
  body: {
    stage: ClassStage;
    studentId: string;
    fromClassId: string;
    toClassId: string;
    mode: TransferMode;
    reason?: string | null;
    /** 末班留成绩快照时传（后端按该场考试读这名学生的成绩） */
    examId?: string | null;
  },
  user: any,
): Promise<{ ok: true; toClassName: string }> {
  const { stage, studentId, fromClassId, toClassId, mode } = body;
  if (!studentId || !fromClassId || !toClassId) {
    throw new BizError(BizCode.PARAM_ERROR, '缺少学生或班级参数');
  }
  if (fromClassId === toClassId) throw new BizError(BizCode.PARAM_ERROR, '目标班级不能与当前班级相同');

  // 只能动自己带的班（交棒模型的数据范围）
  await assertClassInScope(stage, fromClassId, user, '该班级成绩');

  const from = await classOf(stage, fromClassId);
  const to = await classOf(stage, toClassId);

  if (from.stage_code !== null && to.stage_code !== null) {
    if (mode === 'repeat' && to.stage_code > from.stage_code) {
      throw new BizError(BizCode.PARAM_ERROR, '末班只能转到进度相同或更慢的班级');
    }
    if (mode === 'promote' && to.stage_code <= from.stage_code) {
      throw new BizError(BizCode.PARAM_ERROR, '升班只能转到进度更快的班级');
    }
  }

  const stu = (await uniDb('t_uni_student')
    .where({ id: studentId, edu_stage: stage, is_deleted: 0 })
    .first()) as Record<string, any> | undefined;
  if (!stu) throw new BizError(BizCode.PARAM_ERROR, '学生不存在');
  if (String(stu.class_id ?? '') !== fromClassId) {
    throw new BizError(BizCode.PARAM_ERROR, '该学生已不在原班级，请刷新后重试');
  }

  // 末班：带上本场考试成绩快照（有就带）
  let examName: string | null = null;
  let written: number | null = null;
  let interview: number | null = null;
  let comp: number | null = null;
  if (mode === 'repeat' && body.examId) {
    const sc = (await uniDb('t_uni_exam_score')
      .where({ exam_id: body.examId, student_id: studentId, edu_stage: stage, is_deleted: 0 })
      .first()) as Record<string, any> | undefined;
    if (sc) {
      written = sc.score_written ?? sc.written_score ?? null;
      interview = sc.score_interview ?? null;
      comp = sc.score_total ?? null;
    }
    const ex = (await uniDb('t_uni_exam')
      .where({ id: body.examId, edu_stage: stage, is_deleted: 0 })
      .first()) as Record<string, any> | undefined;
    examName = (ex?.exam_name as string) ?? null;
  }

  const now = new Date();
  const userId = user?.userId || 'system';
  const userName = user?.userName || null;
  const reason = (body.reason || '').trim() || (mode === 'repeat' ? '末班转班重修' : '升班');
  const repeatCount = Number(stu.repeat_count ?? 0) + (mode === 'repeat' ? 1 : 0);

  await uniDb.transaction(async (trx) => {
    /* ① 学生主档：换班 + 同步目标班的三岗老师（学生表上有冗余快照列） */
    await trx('t_uni_student')
      .where({ id: studentId, edu_stage: stage })
      .update({
        class_id: to.id,
        class_name: to.class_name,
        head_teacher_id: to.head_teacher_id,
        head_teacher_name: to.head_teacher_name,
        teacher_id: to.teacher_id,
        teacher_name: to.teacher_name,
        assistant_id: to.assistant_id,
        assistant_name: to.assistant_name,
        repeat_count: repeatCount,
        update_time: now,
        update_by: userId,
      });

    /* ② 实训侧另有成员表（jh/class 的成员关系就在学生主档里，没有这张表的行） */
    if (stage === 'job') {
      const exists = (await trx('t_uni_class_student')
        .where({ student_id: studentId, edu_stage: stage, is_deleted: 0 })
        .first()) as Record<string, any> | undefined;
      if (exists) {
        await trx('t_uni_class_student')
          .where({ id: String(exists.id) })
          .update({ class_id: to.id, class_name: to.class_name, update_time: now, update_by: userId });
      } else {
        await trx('t_uni_class_student').insert({
          id: randomUUID(),
          edu_stage: stage,
          class_id: to.id,
          class_name: to.class_name,
          student_id: studentId,
          student_no: stu.student_no ?? null,
          student_name: stu.student_name ?? null,
          join_date: now,
          status: 1,
          is_deleted: 0,
          create_time: now,
          create_by: userId,
        });
      }
    }

    /* ③ 换班留痕（transfer_type=0 = 学生换班，与老模块「班级信息管理发起换班」一致） */
    await trx('t_uni_class_transfer').insert({
      id: randomUUID(),
      edu_stage: stage,
      student_id: studentId,
      student_no: stu.student_no ?? null,
      student_name: stu.student_name ?? null,
      from_class_id: from.id,
      from_class_name: from.class_name,
      to_class_id: to.id,
      to_class_name: to.class_name,
      transfer_reason: `${mode === 'repeat' ? '末班' : '升班'}：${reason}`,
      transfer_time: now,
      transfer_type: 0,
      create_by_name: userName,
      is_deleted: 0,
      create_time: now,
      create_by: userId,
    });

    /* ④ 末班记录：留痕「由哪个班末到哪个班」+ 成绩快照 */
    if (mode === 'repeat') {
      await trx('t_uni_repeat').insert({
        id: randomUUID(),
        edu_stage: stage,
        student_id: studentId,
        student_no: stu.student_no ?? null,
        student_name: stu.student_name ?? null,
        from_class_id: from.id,
        from_class_name: from.class_name,
        from_stage: from.stage_code,
        to_class_id: to.id,
        to_class_name: to.class_name,
        to_stage: to.stage_code,
        repeat_reason: reason,
        repeat_time: now,
        repeat_count: repeatCount,
        exam_name: examName,
        written_score: written,
        interview_score: interview,
        comp_score: comp,
        is_notified: 0,
        is_deleted: 0,
        create_time: now,
        create_by: userId,
      });
    }
  });

  return { ok: true, toClassName: to.class_name };
}
