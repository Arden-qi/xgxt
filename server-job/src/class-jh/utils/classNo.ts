/**
 * 班号 + 学号生成（初高部）
 * ============================================================
 *
 * 【业务规则（2026-10-21 用户口径）】
 *   学号 = LZ + 学段字母 + 班号(3位) + 班内序号(3位)
 *     · 学段字母：高中部(105~107) → T；预科(101) + 初中部(102~104) → J
 *     · 班号：创建班级时按「学部组」顺序分配，101 起
 *       学部组 = 按 stage 分两组：J 组(101~104) / T 组(105~107)，各自独立计数
 *     · 班内序号：每个班从 001 独立重新排（不是全校流水）
 *   示例：LZJ101001（初中部 101 班第 1 人）/ LZT101001（高中部 101 班第 1 人）
 *
 * 【兜底】学生没选班级 / 班级没有班号（老数据未回填）时，
 *   退回旧口径 S + 年份 + 4 位全校流水 —— 保证无班学生也能建档。
 *
 * 【★ 2026-10-22 切读改造】
 *   远端这一版直接 `db('t_class_info')` / `db('t_class_student')` 查**老表**，
 *   而 P8 之后老表已 DROP、读写都走 sms_common 的 t_uni_class / t_uni_student。
 *   这里统一改走 uniDb()，并做两处列名映射：
 *     · `stage` → `stage_code`（统一表列名）
 *     · 学生按 `edu_stage='jh'` 限定（统一表是五学段混存）
 */

import { uniDb } from '../../teaching/shared/uniTable';

const STAGE = 'jh';
const CLASS_T = 't_uni_class';
const STUDENT_T = 't_uni_student';

/** 学段字母：高中(105~107)→T；预科(101)/初中(102~104)→J */
export function stageLetter(stage: number | string | null | undefined): 'J' | 'T' {
  return Number(stage) >= 105 ? 'T' : 'J';
}

/**
 * 下一班号：同学部组已有班 max(class_no) + 1，没有则 101
 *
 * ⚠️ 不过滤 is_deleted —— 被删班级的班号不回收，否则新班会复用旧班号、
 *    和该班历史学生的学号撞（学号带物理唯一索引）。
 * ⚠️ 只看 class_no 非空的班：迁移回填前的老班 class_no 为 NULL，
 *    不参与 max 计算（回填脚本会统一补上）。
 */
export async function nextClassNo(_db: any, stage: number | string | null | undefined): Promise<number> {
  const letter = stageLetter(stage);
  const rows = (await uniDb(CLASS_T)
    .where({ edu_stage: STAGE })
    .whereNotNull('class_no')
    .select('stage_code', 'class_no')) as Array<{ stage_code: number; class_no: number }>;
  let max = 100;
  for (const r of rows) {
    const n = Number(r.class_no);
    if (stageLetter(r.stage_code) === letter && Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

/**
 * 按班级生成新规则学号；无法生成时返回 null（调用方走兜底）
 *
 * 班内序号取该班已有学生中「同前缀学号」的最大尾 3 位 + 1。
 * 老格式学号（J26001 / S20260001 等）不以 LZ 开头，不参与序号计算 ——
 * 即新规则只对新建档的学生生效，历史学号原样保留。
 */
export async function buildStudentNoForClass(_db: any, classId: unknown): Promise<string | null> {
  const cid = String(classId ?? '').trim();
  if (!cid) return null;
  const cls = (await uniDb(CLASS_T).where({ id: cid, is_deleted: 0 }).first()) as
    | { stage_code: number; class_no: number | null }
    | undefined;
  if (!cls || cls.class_no === null || cls.class_no === undefined) return null;
  const prefix = `LZ${stageLetter(cls.stage_code)}${String(cls.class_no).padStart(3, '0')}`;
  const rows = (await uniDb(STUDENT_T)
    .where({ class_id: cid, edu_stage: STAGE })
    .where('student_no', 'like', `${prefix}%`)
    .select('student_no')) as Array<{ student_no: string }>;
  let max = 0;
  for (const r of rows) {
    const tail = String(r.student_no).slice(prefix.length);
    const n = parseInt(tail, 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

/** 旧口径兜底：S + 年份 + 4 位全校流水（无班级/无班号时用） */
export async function legacyStudentNo(_db: any): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `S${year}`;
  const rows = (await uniDb(STUDENT_T)
    .where({ edu_stage: STAGE })
    .where('student_no', 'like', `${prefix}%`)
    .select('student_no')) as Array<{ student_no: string }>;
  let max = 0;
  for (const r of rows) {
    const n = Number(String(r.student_no).slice(prefix.length));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}
