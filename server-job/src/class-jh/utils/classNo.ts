/**
 * 班号 + 学号生成（初高部 sms_class_jh）
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
 * 【为什么放 class-jh/utils】teaching（统一门户）与 class-jh（旧模块）
 *   两个入口都要用，且两边的 db 都是 sms_class_jh 的同一个 knex 实例。
 */

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
export async function nextClassNo(db: any, stage: number | string | null | undefined): Promise<number> {
  const letter = stageLetter(stage);
  const rows = (await db('t_class_info')
    .whereNotNull('class_no')
    .select('stage', 'class_no')) as Array<{ stage: number; class_no: number }>;
  let max = 100;
  for (const r of rows) {
    const n = Number(r.class_no);
    if (stageLetter(r.stage) === letter && Number.isFinite(n) && n > max) max = n;
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
export async function buildStudentNoForClass(db: any, classId: unknown): Promise<string | null> {
  const cid = String(classId ?? '').trim();
  if (!cid) return null;
  const cls = (await db('t_class_info').where({ id: cid, is_deleted: false }).first()) as
    | { stage: number; class_no: number | null }
    | undefined;
  if (!cls || cls.class_no === null || cls.class_no === undefined) return null;
  const prefix = `LZ${stageLetter(cls.stage)}${String(cls.class_no).padStart(3, '0')}`;
  const rows = (await db('t_class_student')
    .where({ class_id: cid })
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
export async function legacyStudentNo(db: any): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `S${year}`;
  const rows = (await db('t_class_student')
    .where('student_no', 'like', `${prefix}%`)
    .select('student_no')) as Array<{ student_no: string }>;
  let max = 0;
  for (const r of rows) {
    const n = Number(String(r.student_no).slice(prefix.length));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}
