/**
 * 教学域 · 学生档案批量查询（2026-10-26）
 * ============================================================
 *
 * 【为什么需要】
 *   催费名单的「谁该催、催什么」来自财务账单（到期日/费用类型），
 *   但**其余字段都该来自学生档案**（用户口径 2026-10-26）：
 *   姓名、学号、班级、部门、手机号、家长手机号、班主任。
 *
 *   财务账单里的 student_no / student_name / class_name 是**建单那一刻的快照**：
 *   学生之后换班、改手机号，账单不会跟着变。催费是「现在打电话找人」，
 *   必须用档案的最新值，否则会出现「按旧班号找人、打旧手机号」。
 *
 *   初高早就这么做了（`fetchStudentContacts` + `mergeArchive`），
 *   大学/就业是这次补上的。
 *
 * 【取哪张表】
 *   `sms_common.t_uni_student`（教学统一学生表，三个学段都在里面，靠 edu_stage 区分）。
 *   查询键：财务账单的 student_id = 咨询学生 id = 统一表的 `source_id`；
 *   兼容直接用统一表主键 `id` 的情况。
 */

import { db } from '../../utils/db';

export interface ArchiveStudentRow {
  id: string;
  studentNo: string;
  studentName: string;
  classId: string | null;
  className: string | null;
  deptCode: number | null;
  deptName?: string;
  phone: string | null;
  parentPhone: string | null;
  headTeacherName: string | null;
}

/** 批量按 studentId（= 统一表 source_id 或 id）取档案，返回 id → 档案 */
export async function lookupStudentArchive(
  ids: Array<string | null | undefined>,
): Promise<Record<string, ArchiveStudentRow>> {
  const keys = [...new Set(ids.filter(Boolean) as string[])];
  if (!keys.length) return {};

  let rows: any[] = [];
  try {
    // 分片 500 条，避免超长 IN
    for (let i = 0; i < keys.length; i += 500) {
      const chunk = keys.slice(i, i + 500);
      const part = (await db('sms_common.t_uni_student')
        .where('is_deleted', false)
        .where((b: any) => {
          b.whereIn('source_id', chunk).orWhereIn('id', chunk);
        })
        .select(
          'id',
          'source_id',
          'student_no',
          'student_name',
          'class_id',
          'class_name',
          'dept_code',
          'phone',
          'parent_phone',
          'head_teacher_name',
        )) as any[];
      rows = rows.concat(part);
    }
  } catch {
    return {}; // 档案取不到不影响名单本身（回落到账单快照）
  }

  const map: Record<string, ArchiveStudentRow> = {};
  for (const r of rows) {
    const row: ArchiveStudentRow = {
      id: String(r.id),
      studentNo: String(r.student_no ?? ''),
      studentName: String(r.student_name ?? ''),
      classId: r.class_id ?? null,
      className: r.class_name ?? null,
      deptCode: r.dept_code != null ? Number(r.dept_code) : null,
      phone: r.phone ?? null,
      parentPhone: r.parent_phone ?? null,
      headTeacherName: r.head_teacher_name ?? null,
    };
    // source_id 和 id 都建索引，调用方传哪个都能命中
    map[String(r.source_id || r.id)] = row;
    map[String(r.id)] = row;
  }
  return map;
}
