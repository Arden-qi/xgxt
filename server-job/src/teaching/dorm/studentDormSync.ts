/**
 * 学生宿舍信息跨表同步
 * ============================================================
 *
 * 同一个学生在系统里有**多份投影**：
 *   · `sms_class_jh.t_class_student`（学生档案，id 形如 JHS-J26001，带 bed_no）
 *   · `sms_class.t_class_student` / `sms_job.t_student_base`
 *   · `sms_edu.t_student_base`
 *   · `sms_perm.t_student_base`（门户/宿舍域实际在用的主档，id 形如 PSB-J26001）
 * 它们的 **id 不同**，只有 `student_no`（学号）是一致的。
 *
 * 班主任在宿舍管理里办理入住/退宿时，原来只写「当前操作碰到的那一张」，
 * 学生档案详情读的是 JHS- 那张 → 宿舍栏一直是空的。
 * → 这里按学号把 dorm_id / dorm_no（以及有该列的 bed_no）同步到所有投影表。
 */

import { db } from '../../utils/db';

const STUDENT_TABLES = [
  // ★ jh/class/job 三份投影已合并为 t_uni_student 一行（按 student_no 命中即全覆盖）
  'sms_common.t_uni_student',
  'sms_edu.t_student_base',
  'sms_perm.t_student_base',
];

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/**
 * 按学号同步宿舍信息。
 *
 * @param studentNo 学号（同步键，跨表唯一）
 * @param dormId    房间 id，退宿传 null
 * @param dormNo    宿舍号（如「1号楼-101」），退宿传 null
 * @param bedNo     床位号；传 null 表示清空。没有 bed_no 列的表会自动退回只写宿舍字段
 * @returns 实际更新的行数（各表合计，便于排查）
 */
export async function syncStudentDorm(
  studentNo: string,
  dormId: string | null,
  dormNo: string | null,
  bedNo: string | null,
): Promise<number> {
  const no = str(studentNo).trim();
  if (!no) return 0;

  let updated = 0;
  for (const table of STUDENT_TABLES) {
    try {
      // 先带上 bed_no 写（class_jh / class 这两张表有该列）
      const n = await db(table).where({ student_no: no, is_deleted: false }).update({
        dorm_id: dormId,
        dorm_no: dormNo,
        bed_no: bedNo,
      });
      updated += n;
    } catch {
      // 表里没有 bed_no（perm / edu）→ 只写宿舍字段
      try {
        const n = await db(table).where({ student_no: no, is_deleted: false }).update({
          dorm_id: dormId,
          dorm_no: dormNo,
        });
        updated += n;
      } catch {
        /* 表不存在 → 跳过 */
      }
    }
  }
  return updated;
}
