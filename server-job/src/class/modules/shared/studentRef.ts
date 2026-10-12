import { db } from '../../db';
// ★ 第 4 期第 8 批：补切读层
//   【为什么这一处特别隐蔽】本函数整个包在 try/catch 里，失败**不报错**，
//   只是降级成「用学号占位」。切读后若仍读老表 → 回查不到学生
//   → **每一条催费/缴费同步记录都会写进学号占位而不是真 id**，
//   而接口照样返回 200、failed=0 → 完全看不出坏了。
import { tbl } from '../../../teaching/shared/uniTable';

const SRC = 'sms_class';
const STAGE = 'class' as const;

/**
 * ⭐ 按【学号】在本模块自己的学生表里回查学生 ID
 *
 * ============================================================
 * 【为什么需要它 —— 2026-10-05 打通三条同步链路时发现】
 * ============================================================
 *   同步接口的契约里 `studentId` 是必填的，但上游**根本拿不到它**：
 *     咨询(sms_consult) / 教务(sms_edu) / 财务(sms_finance) / 班级(sms_class)
 *   各自的学生表主键是**不同的 uuid**（连"共享学生表"都是各库一份）。
 *     财务 sms_finance.t_student_base.id = 09bd4955-…
 *     班级 sms_class.t_class_student.id = STU_S20260001
 *   唯一三边都对得上的，只有 **学号 student_no**（升级交接也是这个口径）。
 *
 *   所以：**收到推送时，收方（本模块）用学号回查自己的学生 ID**。
 *   这是"接收方补全关联"的常规做法，也符合"不许直接读别人的库"的铁律 ——
 *   查的是本模块自己的表。
 *
 * 【降级】查不到（学生还没被班主任接收建档）→ 返回 null，
 *   调用方退化为「用学号占位」，保证同步落库仍然可查、不丢数据。
 */
export async function resolveStudentId(
  studentNo: string | null | undefined,
): Promise<string | null> {
  const no = String(studentNo || '').trim();
  if (!no) return null;
  try {
    const row = (await tbl(db, SRC, 't_class_student', STAGE)
      .where({ student_no: no, is_deleted: 0 })
      .first()) as Record<string, unknown> | undefined;
    return row ? String(row.id) : null;
  } catch {
    // 查不到就当没关联，绝不让「回查失败」把整批同步带崩
    return null;
  }
}

/**
 * 决定这次同步用哪个 student_id 落库
 *
 * 顺序：上游显式传的 > 按学号回查到的 > 学号本身（占位）
 *
 * ⚠️ 占位是必要的：`t_class_fee_sync.student_id` / `t_class_urge_sync.student_id`
 *    都是 NOT NULL。用学号占位至少能让班主任在列表里看到这条记录（学号是可见的），
 *    等学生在班级模块建档后，下一次同步就会自动换成真 ID。
 */
export async function resolveSyncStudentId(
  item: { studentId?: string | null; studentNo?: string | null },
): Promise<string> {
  const explicit = String(item.studentId || '').trim();
  if (explicit) return explicit;

  const byNo = await resolveStudentId(item.studentNo);
  if (byNo) return byNo;

  const fallback = String(item.studentNo || '').trim();
  if (fallback) {
    // eslint-disable-next-line no-console
    console.warn(
      `[sync] 学号 ${fallback} 在班级模块还没有学生档案（班主任尚未接收），` +
        '本次先用学号占位写入只读副本',
    );
  }
  return fallback;
}
