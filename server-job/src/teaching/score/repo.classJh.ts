/**
 * 成绩仓储 · 初高（sms_class_jh）· 表 t_class_exam_score
 *
 * 特点：字段全部带 `score_` 前缀；没有 exam_name（要 join t_class_exam）；
 *      公式 = 各项**直接求和**，再按「总分 ≥ 满分 × 0.6」自动判定通过。
 */

import { randomUUID } from 'crypto';
import { db } from '../../class-jh/utils/db';
import { calcScores } from '../shared/conf';
import type { ScoreEntry, ScoreEntryRow, ScoreListQuery, ScoreRow, ScoreSaveBody } from '../shared/dto';
import { EXAM_RESULT_NAME } from '../shared/dto';
import { tbl, tblIns } from '../shared/uniTable';

/* ★ P6 补切（2026-10-16）：与 repo.job.ts 同批——成绩表此前是裸 db()（teaching 目录被扫描器跳过） */
const S = 't_class_exam_score';
const E = 't_class_exam';
const STU = 't_class_student';
const STAGE = 'jh' as const;
const DB = 'sms_class_jh';

const num = (v: unknown): number | null =>
  v === null || v === undefined || v === '' ? null : Number(v);

/** 该场考试的满分合计（来自 content_full_score 这个 JSON 对象） */
async function fullTotalOf(examId: string): Promise<number> {
  const e = (await tbl(db, 'sms_class_jh', E, STAGE).where({ id: examId, is_deleted: 0 }).first()) as
    | Record<string, any>
    | undefined;
  if (!e?.content_full_score) return 0;
  try {
    const obj = JSON.parse(String(e.content_full_score));
    return Object.values(obj as Record<string, number>).reduce((a, b) => a + Number(b || 0), 0);
  } catch {
    return 0;
  }
}

async function examNames(ids: string[]): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  if (!ids.length) return m;
  const rows = (await tbl(db, 'sms_class_jh', E, STAGE).whereIn('id', ids).select('id', 'exam_name')) as Array<
    Record<string, any>
  >;
  for (const r of rows) m.set(String(r.id), String(r.exam_name ?? ''));
  return m;
}

async function mapRow(r: Record<string, any>, nameMap: Map<string, string>): Promise<ScoreRow> {
  const total = num(r.score_total);
  return {
    id: String(r.id),
    stage: STAGE,
    stageName: '初高',
    examId: String(r.exam_id),
    examName: nameMap.get(String(r.exam_id)) ?? '',
    examDate: r.exam_date ? String(r.exam_date).slice(0, 10) : null,
    classId: (r.class_id as string) ?? null,
    className: null,
    studentId: String(r.student_id),
    studentNo: (r.student_no as string) ?? null,
    studentName: (r.student_name as string) ?? null,
    writtenScore: num(r.score_written),
    machineScore: num(r.score_machine),
    interviewScore: num(r.score_interview),
    otherScore: num(r.score_other),
    writtenAvg: null, // 初高不算笔试均分
    totalScore: total,
    examResult: r.exam_result === null || r.exam_result === undefined ? null : Number(r.exam_result),
    examResultName: EXAM_RESULT_NAME[Number(r.exam_result)] ?? '—',
    remark: (r.remark as string) ?? null,
  };
}

export async function list(q: ScoreListQuery): Promise<ScoreRow[]> {
  const qb = tbl(db, DB, S, STAGE).where('is_deleted', 0);
  if (q.examId) qb.andWhere('exam_id', q.examId);
  if (q.classId) qb.andWhere('class_id', q.classId);
  if (q.studentId) qb.andWhere('student_id', q.studentId);
  if (q.keyword) qb.andWhere('student_name', 'like', `%${q.keyword}%`);
  const rows = (await qb.orderBy('student_no')) as Array<Record<string, any>>;
  const nameMap = await examNames([...new Set(rows.map((r) => String(r.exam_id)))]);
  return Promise.all(rows.map((r) => mapRow(r, nameMap)));
}

export async function entry(examId: string, classId: string): Promise<ScoreEntry> {
  const exam = (await tbl(db, 'sms_class_jh', E, STAGE).where({ id: examId, is_deleted: 0 }).first()) as
    | Record<string, any>
    | undefined;
  if (!exam) throw new Error('考试不存在');
  const clsId = classId || String(exam.class_id);
  const students = (await tbl(db, 'sms_class_jh', STU, STAGE).where({ class_id: clsId, is_deleted: 0 }).orderBy('student_no')) as Array<
    Record<string, any>
  >;
  const scores = (await tbl(db, DB, S, STAGE).where({ exam_id: examId, is_deleted: 0 })) as Array<Record<string, any>>;
  const smap = new Map(scores.map((s) => [String(s.student_id), s]));
  const fullTotal = await fullTotalOf(examId);

  const rows: ScoreEntryRow[] = students.map((st) => {
    const s = smap.get(String(st.id));
    return {
      studentId: String(st.id),
      studentNo: (st.student_no as string) ?? null,
      studentName: (st.student_name as string) ?? null,
      scoreId: s ? String(s.id) : null,
      writtenScore: num(s?.score_written),
      machineScore: num(s?.score_machine),
      interviewScore: num(s?.score_interview),
      otherScore: num(s?.score_other),
      writtenAvg: null,
      totalScore: num(s?.score_total),
      examResult: s?.exam_result === null || s?.exam_result === undefined ? null : Number(s.exam_result),
      remark: (s?.remark as string) ?? null,
    };
  });

  return {
    stage: STAGE,
    stageName: '初高',
    examId,
    examName: String(exam.exam_name ?? ''),
    examDate: exam.exam_date ? String(exam.exam_date).slice(0, 10) : null,
    classId: clsId,
    className: String(exam.class_name ?? ''),
    fullTotal,
    hasWrittenAvg: false,
    rows,
  };
}

/** ★ 各分数项的本场满分（初高存在 content_full_score 这个 JSON 里） */
const FIELD_OF_CONTENT: Record<number, string> = { 1: 'written', 2: 'machine', 3: 'interview', 4: 'other' };
export async function contentFull(examId: string): Promise<Record<string, number>> {
  const e = (await tbl(db, 'sms_class_jh', E, STAGE).where({ id: examId, is_deleted: 0 }).first()) as
    | Record<string, any>
    | undefined;
  if (!e?.content_full_score) return {};
  try {
    const obj = JSON.parse(String(e.content_full_score)) as Record<string, number>;
    const out: Record<string, number> = {};
    for (const [t, v] of Object.entries(obj)) {
      const f = FIELD_OF_CONTENT[Number(t)];
      if (f && v !== null && v !== undefined) out[f] = Number(v);
    }
    return out;
  } catch {
    return {};
  }
}

export async function save(body: ScoreSaveBody, userId: string) {
  const exam = (await tbl(db, 'sms_class_jh', E, STAGE).where({ id: body.examId, is_deleted: 0 }).first()) as
    | Record<string, any>
    | undefined;
  if (!exam) throw new Error('考试不存在');
  const fullTotal = await fullTotalOf(body.examId);
  const now = new Date();
  let saved = 0;

  // ⚠️ t_class_exam_score 的 student_no / student_name 是 **NOT NULL** ——
  //    必须先查学生补上，否则插入直接报 `Column 'student_name' cannot be null`。
  const stuIds = body.rows.map((r) => r.studentId);
  const stuRows = (await tbl(db, 'sms_class_jh', STU, STAGE).whereIn('id', stuIds).where('is_deleted', 0)) as Array<
    Record<string, any>
  >;
  const stuMap = new Map(stuRows.map((s) => [String(s.id), s]));

  for (const r of body.rows) {
    const vals = {
      written: r.writtenScore ?? null,
      machine: r.machineScore ?? null,
      interview: r.interviewScore ?? null,
      other: r.otherScore ?? null,
    };
    const { totalScore, examResult } = await calcScores(STAGE, vals, fullTotal);

    const existed = (await tbl(db, DB, S, STAGE)
      .where({ exam_id: body.examId, student_id: r.studentId, is_deleted: 0 })
      .first()) as Record<string, any> | undefined;

    const payload = {
      score_written: vals.written,
      score_machine: vals.machine,
      score_interview: vals.interview,
      score_other: vals.other,
      score_total: totalScore,
      exam_result: examResult,
      is_passed: examResult === null ? null : examResult === 1 ? 1 : 0,
      remark: r.remark ?? null,
      update_time: now,
      update_by: userId,
    };

    if (existed) {
      await tbl(db, DB, S, STAGE).where({ id: existed.id }).update(payload);
    } else {
      const stu = stuMap.get(r.studentId);
      // ★ 必须用 tblIns：统一表 edu_stage NOT NULL 无默认
      await tblIns(db, DB, S, STAGE, {
        id: randomUUID(),
        exam_id: body.examId,
        exam_type: exam.exam_type,
        exam_date: exam.exam_date,
        class_id: exam.class_id,
        student_id: r.studentId,
        student_no: (stu?.student_no as string) ?? '',
        student_name: (stu?.student_name as string) ?? '',
        score_teacher_id: userId,
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
