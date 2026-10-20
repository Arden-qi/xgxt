/**
 * 成绩仓储 · 实训（sms_job）· 表 t_job_exam_score
 *
 * 特点：字段名与另两套又不同（paper_score / written_avg / total_score）；
 *      公式 = **两次加权**：笔试均分 = 卷面×50% + 机试×50%，
 *                        综合 = 笔试均分×50% + 面试×50%（缺项 → 整项留空）。
 *      考试支持多班，所以「录入表」要指定班级。
 */

import { randomUUID } from 'crypto';
import { db } from '../../utils/db';
import { calcScores } from '../shared/conf';
import type { ScoreEntry, ScoreEntryRow, ScoreListQuery, ScoreRow, ScoreSaveBody } from '../shared/dto';
import { EXAM_RESULT_NAME } from '../shared/dto';
import { tbl, tblIns, tblRef, uniDb } from '../shared/uniTable';

/* ★ P6 补切（2026-10-16）：本文件此前是「半切」——exam 查询走了 tbl，成绩表/花名册
   还是裸 db()；teaching 目录被 _uni-bare-scan 整体跳过，扫描器没抓到。
   开关开下 save 写老表、断言读统一表 → written_avg=undefined（score 套件实锤）。 */
const S = 't_job_exam_score';
const E = 't_job_exam';
const CS = 't_job_class_student';
const STU = 't_student_base';
const STAGE = 'job' as const;
const DB = 'sms_job';

const num = (v: unknown): number | null =>
  v === null || v === undefined || v === '' ? null : Number(v);

function mapRow(r: Record<string, any>): ScoreRow {
  return {
    id: String(r.id),
    stage: STAGE,
    stageName: '实训',
    examId: String(r.exam_id ?? ''),
    examName: String(r.exam_name ?? ''),
    examDate: null,
    classId: (r.class_id as string) ?? null,
    className: (r.class_name as string) ?? null,
    studentId: String(r.student_id),
    studentNo: (r.student_no as string) ?? null,
    studentName: (r.student_name as string) ?? null,
    writtenScore: num(r.paper_score),
    machineScore: num(r.machine_score),
    interviewScore: num(r.interview_score),
    otherScore: null,
    writtenAvg: num(r.written_avg),
    totalScore: num(r.total_score),
    examResult: r.exam_result === null || r.exam_result === undefined ? null : Number(r.exam_result),
    examResultName: EXAM_RESULT_NAME[Number(r.exam_result)] ?? '—',
    remark: (r.remark as string) ?? null,
  };
}

/** 当天在班学生（花名册 status=1）
 *  ★ join 场景：开关开时统一表在 sms_common，必须用 uniDb 连接（tblRef 只换表名不换库） */
function joinDb() {
  return uniDb;
}
async function roster(classId: string) {
  return (await joinDb()(`${tblRef(DB, CS)} as cs`)
    .leftJoin(`${tblRef(DB, STU)} as s`, 'cs.student_id', 's.id')
    .where('cs.class_id', classId)
    .andWhere('cs.status', 1)
    .andWhere('cs.is_deleted', 0)
    .select('cs.student_id', 'cs.student_no', 'cs.student_name')
    .orderBy('cs.student_no', 'asc')) as Array<Record<string, any>>;
}

export async function list(q: ScoreListQuery): Promise<ScoreRow[]> {
  const qb = tbl(db, DB, S, STAGE).where('is_deleted', 0);
  if (q.examId) qb.andWhere('exam_id', q.examId);
  if (q.classId) qb.andWhere('class_id', q.classId);
  if (q.studentId) qb.andWhere('student_id', q.studentId);
  if (q.keyword) qb.andWhere('student_name', 'like', `%${q.keyword}%`);
  const rows = (await qb.orderBy('student_no')) as Array<Record<string, any>>;
  return rows.map(mapRow);
}

export async function entry(examId: string, classId: string): Promise<ScoreEntry> {
  const exam = (await tbl(db, 'sms_job', E, STAGE).where({ id: examId, is_deleted: 0 }).first()) as
    | Record<string, any>
    | undefined;
  if (!exam) throw new Error('考试不存在');
  // 实训是多班：优先用传入的班；没传就取第一个班
  const clsId = classId || String(exam.class_ids ?? '').split(',')[0] || '';
  if (!clsId) throw new Error('该考试没有班级');

  const students = await roster(clsId);
  const scores = (await tbl(db, DB, S, STAGE).where({ exam_id: examId, class_id: clsId, is_deleted: 0 })) as Array<
    Record<string, any>
  >;
  const smap = new Map(scores.map((s) => [String(s.student_id), s]));

  const rows: ScoreEntryRow[] = students.map((st) => {
    const s = smap.get(String(st.student_id));
    return {
      studentId: String(st.student_id),
      studentNo: (st.student_no as string) ?? null,
      studentName: (st.student_name as string) ?? null,
      scoreId: s ? String(s.id) : null,
      writtenScore: num(s?.paper_score),
      machineScore: num(s?.machine_score),
      interviewScore: num(s?.interview_score),
      otherScore: null,
      writtenAvg: num(s?.written_avg),
      totalScore: num(s?.total_score),
      examResult: s?.exam_result === null || s?.exam_result === undefined ? null : Number(s.exam_result),
      remark: (s?.remark as string) ?? null,
    };
  });

  const names = String(exam.class_names ?? '').split('、');
  const idx = String(exam.class_ids ?? '').split(',').indexOf(clsId);

  return {
    stage: STAGE,
    stageName: '实训',
    examId,
    examName: String(exam.exam_name ?? ''),
    examDate: null,
    classId: clsId,
    className: names[idx] || names[0] || '',
    fullTotal: 0, // 实训不按满分比例判定通过
    hasWrittenAvg: true, // ★ 只有实训有「笔试均分」这一列
    rows,
  };
}

/** ★ 各分数项的本场满分（实训若没配，返回空对象 → 前端回落） */
const FIELD_OF_CONTENT: Record<number, string> = { 1: 'written', 2: 'machine', 3: 'interview', 4: 'other' };
export async function contentFull(examId: string): Promise<Record<string, number>> {
  const e = (await tbl(db, 'sms_job', E, STAGE).where({ id: examId, is_deleted: 0 }).first()) as
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
  const exam = (await tbl(db, 'sms_job', E, STAGE).where({ id: body.examId, is_deleted: 0 }).first()) as
    | Record<string, any>
    | undefined;
  if (!exam) throw new Error('考试不存在');
  const now = new Date();
  let saved = 0;

  for (const r of body.rows) {
    const vals = {
      written: r.writtenScore ?? null,
      machine: r.machineScore ?? null,
      interview: r.interviewScore ?? null,
      other: null,
    };
    const { writtenAvg, totalScore, examResult } = await calcScores(STAGE, vals, 0);
    // ★ 实训 judgeMode='action'：默认 null「未判断」，由「标末班」动作置 2（可撤销回 null）
    const finalResult = r.examResult ?? examResult ?? null;

    const stu = (await joinDb()(`${tblRef(DB, CS)} as cs`)
      .leftJoin(`${tblRef(DB, STU)} as s`, 'cs.student_id', 's.id')
      .where('cs.student_id', r.studentId)
      .andWhere('cs.is_deleted', 0)
      .select('cs.student_no', 'cs.student_name', 'cs.class_id', 'cs.class_name')
      .first()) as Record<string, any> | undefined;

    const existed = (await tbl(db, DB, S, STAGE)
      .where({ exam_id: body.examId, student_id: r.studentId, is_deleted: 0 })
      .first()) as Record<string, any> | undefined;

    const payload = {
      paper_score: vals.written,
      machine_score: vals.machine,
      written_avg: writtenAvg,
      interview_score: vals.interview,
      total_score: totalScore,
      exam_result: finalResult,
      remark: r.remark ?? null,
      entry_by: userId,
      entry_time: now,
      update_time: now,
      update_by: userId,
    };

    if (existed) {
      await tbl(db, DB, S, STAGE).where({ id: existed.id }).update(payload);
    } else {
      // ★ 必须用 tblIns：统一表 edu_stage NOT NULL 无默认，且要剔除老表专有列
      await tblIns(db, DB, S, STAGE, {
        id: randomUUID(),
        exam_id: body.examId,
        exam_name: exam.exam_name,
        student_id: r.studentId,
        student_no: stu?.student_no ?? null,
        student_name: stu?.student_name ?? null,
        class_id: stu?.class_id ?? null,
        class_name: stu?.class_name ?? null,
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
