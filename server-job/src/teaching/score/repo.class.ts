/**
 * 成绩仓储 · 大学（sms_class）· 表 t_class_grade
 *
 * 特点：字段名无前缀（written_score / comp_score）；exam_name 冗余在本表；
 *      公式 = 笔试×50% + 面试×50%，**缺项按 0 计**；另有素质分析 analysis。
 */

import { randomUUID } from 'crypto';
import { db } from '../../class/db';
import { calcScores } from '../shared/conf';
import type { ScoreEntry, ScoreEntryRow, ScoreListQuery, ScoreRow, ScoreSaveBody } from '../shared/dto';
import { EXAM_RESULT_NAME } from '../shared/dto';
import { tbl, tblIns } from '../shared/uniTable';

const G = 't_class_grade';
const E = 't_class_exam';
const EC = 't_class_exam_content';
const STU = 't_class_student';
const STAGE = 'class' as const;

const num = (v: unknown): number | null =>
  v === null || v === undefined || v === '' ? null : Number(v);

/** 满分合计 = 该场考试内容项满分的和 */
async function fullTotalOf(examId: string): Promise<number> {
  // ★ 切读接入：考试内容项子表 t_class_exam_content → t_uni_exam_content（full_score 同名保留）
  const rows = (await tbl(db, 'sms_class', EC, STAGE)
    .where({ exam_id: examId, is_deleted: 0 })
    .select('full_score')) as Array<Record<string, any>>;
  return rows.reduce((a, r) => a + Number(r.full_score || 0), 0);
}

function mapRow(r: Record<string, any>): ScoreRow {
  return {
    id: String(r.id),
    stage: STAGE,
    stageName: '大学',
    examId: String(r.exam_id ?? ''),
    examName: String(r.exam_name ?? ''),
    examDate: null,
    classId: (r.class_id as string) ?? null,
    className: (r.class_name as string) ?? null,
    studentId: String(r.student_id),
    studentNo: (r.student_no as string) ?? null,
    studentName: (r.student_name as string) ?? null,
    writtenScore: num(r.written_score),
    machineScore: num(r.machine_score),
    interviewScore: num(r.interview_score),
    otherScore: null,
    writtenAvg: null, // 大学不算笔试均分
    totalScore: num(r.comp_score),
    examResult: r.exam_result === null || r.exam_result === undefined ? null : Number(r.exam_result),
    examResultName: EXAM_RESULT_NAME[Number(r.exam_result)] ?? '—',
    remark: (r.analysis as string) ?? (r.remark as string) ?? null,
  };
}

export async function list(q: ScoreListQuery): Promise<ScoreRow[]> {
  // ★ 切读接入：成绩主表 t_class_grade → t_uni_exam_score。
  //   统一表是老表的超集：written_score / machine_score / interview_score /
  //   comp_score / exam_result / analysis 全部同名保留 → 只换表、不改列名。
  const qb = tbl(db, 'sms_class', G, STAGE).where('is_deleted', 0);
  if (q.examId) qb.andWhere('exam_id', q.examId);
  if (q.classId) qb.andWhere('class_id', q.classId);
  if (q.studentId) qb.andWhere('student_id', q.studentId);
  if (q.keyword) qb.andWhere('student_name', 'like', `%${q.keyword}%`);
  const rows = (await qb.orderBy('student_no')) as Array<Record<string, any>>;
  return rows.map(mapRow);
}

export async function entry(examId: string, classId: string): Promise<ScoreEntry> {
  const exam = (await tbl(db, 'sms_class', E, STAGE).where({ id: examId, is_deleted: 0 }).first()) as
    | Record<string, any>
    | undefined;
  if (!exam) throw new Error('考试不存在');
  const clsId = classId || String(exam.class_id);
  const students = (await tbl(db, 'sms_class', STU, STAGE).where({ class_id: clsId, is_deleted: 0 }).orderBy('student_no')) as Array<
    Record<string, any>
  >;
  const scores = (await tbl(db, 'sms_class', G, STAGE).where({
    exam_id: examId,
    is_deleted: 0,
  })) as Array<Record<string, any>>;
  const smap = new Map(scores.map((s) => [String(s.student_id), s]));

  const rows: ScoreEntryRow[] = students.map((st) => {
    const s = smap.get(String(st.id));
    return {
      studentId: String(st.id),
      studentNo: (st.student_no as string) ?? null,
      studentName: (st.student_name as string) ?? null,
      scoreId: s ? String(s.id) : null,
      writtenScore: num(s?.written_score),
      machineScore: num(s?.machine_score),
      interviewScore: num(s?.interview_score),
      otherScore: null,
      writtenAvg: null,
      totalScore: num(s?.comp_score),
      examResult: s?.exam_result === null || s?.exam_result === undefined ? null : Number(s.exam_result),
      remark: (s?.analysis as string) ?? null,
    };
  });

  return {
    stage: STAGE,
    stageName: '大学',
    examId,
    examName: String(exam.exam_name ?? ''),
    examDate: exam.exam_date ? String(exam.exam_date).slice(0, 10) : null,
    classId: clsId,
    className: String(exam.class_name ?? ''),
    fullTotal: await fullTotalOf(examId),
    hasWrittenAvg: false,
    rows,
  };
}

/** ★ 各分数项的本场满分（内容项表 → {written:150} 这种） */
const FIELD_OF_CONTENT: Record<number, string> = { 1: 'written', 2: 'machine', 3: 'interview', 4: 'other' };
export async function contentFull(examId: string): Promise<Record<string, number>> {
  const rows = (await tbl(db, 'sms_class', EC, STAGE)
    .where({ exam_id: examId, is_deleted: 0 })
    .select('exam_content_type', 'full_score')) as Array<Record<string, any>>;
  const out: Record<string, number> = {};
  for (const r of rows) {
    const f = FIELD_OF_CONTENT[Number(r.exam_content_type)];
    if (f && r.full_score !== null && r.full_score !== undefined) out[f] = Number(r.full_score);
  }
  return out;
}

export async function save(body: ScoreSaveBody, userId: string) {
  const exam = (await tbl(db, 'sms_class', E, STAGE).where({ id: body.examId, is_deleted: 0 }).first()) as
    | Record<string, any>
    | undefined;
  if (!exam) throw new Error('考试不存在');
  const fullTotal = await fullTotalOf(body.examId);
  const now = new Date();
  let saved = 0;

  for (const r of body.rows) {
    const vals = {
      written: r.writtenScore ?? null,
      machine: r.machineScore ?? null,
      interview: r.interviewScore ?? null,
      other: r.otherScore ?? null,
    };
    const { totalScore, examResult } = await calcScores(STAGE, vals, fullTotal);
    // ★ 大学 judgeMode='manual'：老师手选。该列 NOT NULL → 未传时默认「通过」。
    const finalResult = r.examResult ?? examResult ?? 1;

    const existed = (await tbl(db, 'sms_class', G, STAGE)
      .where({ exam_id: body.examId, student_id: r.studentId, is_deleted: 0 })
      .first()) as Record<string, any> | undefined;

    const payload = {
      written_score: vals.written,
      machine_score: vals.machine,
      interview_score: vals.interview,
      comp_score: totalScore,
      exam_result: finalResult,
      analysis: r.remark ?? null,
      update_time: now,
      update_by: userId,
    };

    if (existed) {
      // update 走 tbl()（已带 edu_stage 过滤）→ 不会跨学段误更新
      await tbl(db, 'sms_class', G, STAGE).where({ id: existed.id }).update(payload);
    } else {
      const stu = (await tbl(db, 'sms_class', STU, STAGE).where({ id: r.studentId, is_deleted: 0 }).first()) as
        | Record<string, any>
        | undefined;
      // insert 必须走 tblIns：统一表 edu_stage 是 NOT NULL 且无默认值，
      // 由路由层按开关补（开关关时原样透传，零行为变化）
      await tblIns(db, 'sms_class', G, STAGE, {
        id: randomUUID(),
        exam_id: body.examId,
        exam_name: exam.exam_name,
        class_id: exam.class_id,
        class_name: exam.class_name,
        student_id: r.studentId,
        student_no: stu?.student_no ?? null,
        student_name: stu?.student_name ?? null,
        ...payload,
        is_deleted: 0,
        create_time: now,
        create_by: userId,
      });
    }
    saved += 1;
  }
  return { saved };
}
