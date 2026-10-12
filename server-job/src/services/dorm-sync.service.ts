/**
 * ⭐ 宿舍信息 → 班级管理（只读副本）推送
 *
 * ============================================================
 * 【为什么有它】2026-10-05 联调发现的断链
 * ============================================================
 *   班级管理的「宿舍管理」页读共享库只读副本
 *     sms_common.t_class_dorm_room_sync（房间）
 *     sms_common.t_class_dorm_live_sync（住宿学员）
 *   接收口 POST /api/class/dorm/sync 早就写好了，但**没有任何一方推过**。
 *
 * 【谁推】教务老师（「教务管理 → 宿舍管理 → 分派宿舍」）——
 *   对应原始契约里的「教务管理（8002）：宿舍信息」。
 *
 * 【什么时候推】点「分派宿舍」把房间分给班级之后（用户 2026-10-05 定的口径）。
 *   推送内容 = 「这个班分到的房间」+「这些房间当前的住宿学员」。
 *
 * ⚠️ 教务的住宿明细在另一张表 t_edu_dorm_bed，**允许为空**。
 *    为空时只推房间、不推住宿明细；班级侧对"没带住宿明细"做了保护，
 *    不会把已有住宿记录误判成退宿（见 class/modules/dorm/dorm.route.ts 的 step ③）。
 *
 * 【失败怎么办】**绝不能影响主流程**（分派已经写库了），只记日志。
 */

import { db } from '../utils/db';
import { classSync } from '../utils/classSync';

const ASSIGN = 'sms_edu.t_edu_dorm_assignment';
const ROOM = 'sms_edu.t_edu_dorm_room';
const BED = 'sms_edu.t_edu_dorm_bed';

/**
 * 把某个班级已分派的宿舍推送给班级管理
 *
 * @param className       教务侧的班级名（分派页选的那个）
 * @param removedRoomIds  本次被取消分派的房间主键（教务 t_edu_dorm_room.id）。
 *                        传了就通知班级侧把对应房间副本删掉，
 *                        避免「教务清空/取消分派，班级还留着旧房间」。
 */
export async function syncEduDormToClass(
  className: string,
  removedRoomIds: string[] = [],
): Promise<void> {
  const cls = String(className || '').trim();
  if (!cls) return;

  const removed = [...new Set((removedRoomIds || []).map((x) => String(x || '').trim()).filter(Boolean))];

  try {
    /* ① 该班已分派的房间 */
    const assigns = (await db(ASSIGN)
      .where({ class_name: cls, is_deleted: false })
      .select('room_id')) as Array<{ room_id: string }>;
    const roomIds = [...new Set(assigns.map((a) => a.room_id).filter(Boolean))];

    /* ② 房间主档（没分到房间时为空） */
    const rooms = roomIds.length
      ? ((await db(ROOM)
          .whereIn('id', roomIds)
          .where('is_deleted', false)) as Array<Record<string, any>>)
      : [];

    /* ③ 住宿学员（可能为空） */
    const beds = roomIds.length
      ? ((await db(BED)
          .whereIn('room_id', roomIds)
          .where('is_deleted', false)) as Array<Record<string, any>>)
      : [];

    // 既没房间也没要删的 → 无事可做（避免空推）
    if (!rooms.length && !removed.length) {
      return;
    }

    const items = rooms.map((r) => {
      const inRoom = beds.filter((b) => b.room_id === r.id);
      return {
        room: {
          /* 房间幂等键 = 教务房间 id */
          sourceId: String(r.id),
          buildingId: null,
          buildingName: r.building || null,
          dormType: r.category ?? null,
          /* 班级侧展示/回写学生档案用的「房间号」 */
          dormNo: String(r.room ?? ''),
          bedCount: Number(r.capacity ?? 0),
          usedCount: inRoom.filter((b) => b.student_no || b.student_name).length,
          leaderStudentId: null,
          leaderStudentName: null,
        },
        /**
         * 只推「确实住了人」的床位。
         * ⚠️ 教务的 t_edu_dorm_bed 是**床位列**，空床也有一行（student_no 为空）。
         *    把空床也推过去，收方既定位不到学生、又会白白多跑一遍查询；
         *    而且班级侧对「没带住宿明细」有保护，空数组是安全的（不会误判退宿）。
         */
        residents: inRoom
          .filter((b) => b.student_no || b.student_name)
          .map((b) => ({
            /* ⚠️ 不传 studentId：教务只有学号（两库学生 ID 空间不同），
               由班级侧按学号回查 —— 见 class/modules/shared/studentRef.ts */
            studentNo: b.student_no || null,
            studentName: b.student_name || null,
            className: b.class_name || cls,
            checkInDate: null,
          })),
      };
    });

    const r = await classSync.dormSync(items, removed);
    if (!r.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[教务宿舍→班级] 班级「${cls}」同步失败（不影响本次操作）：${r.message}`);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[教务宿舍→班级] 班级「${cls}」同步异常（不影响本次操作）：${(e as Error).message}`);
  }
}
