/**
 * 学生档案 · 「已就业」标记（2026-10-21 批注）
 * ============================================================
 * 批注原文（学生档案页，红框在操作列「编辑」后面）：
 *   「在【编辑】后面加入【已就业】操作，点击【已就业】，弹出
 *     是否更改该学生状态为【已就业】，该操作不可更改」
 *
 * 【为什么要单独一条链路，不直接走「编辑学生」保存】
 *   ① 批注同批还要求「编辑学生弹窗里删掉『已就业』选项」——
 *      也就是说：**已就业只能通过这个按钮进入，不能在下拉里随手选**。
 *   ② 它是**终态**：确认后不可撤销（前端：按钮不再出现、编辑弹窗的状态字段锁死）。
 *
 * 【与 /api/job/student/confirm-employment 的区别（别混用）】
 *   那个是就业模块的「确认就业」：要填入职日期 / 单位 / 岗位 / 薪资，还会写一条就业日志，
 *   且有角色白名单（就业老师 / 校长 / 学管主任）。
 *   这里只做一件事：把 student_status 置为 10（已就业），不收集就业明细。
 *
 * 【各学段落在哪张表（⚠️ 四套不同的表，别写错）】
 *   jh    → sms_class_jh.t_class_student   （class-jh 的连接）
 *   class → sms_class.t_class_student      （class 的连接）
 *   job / emp → sms_job.t_student_base     （主连接，靠 stage_key 分）
 *   edu   → sms_edu.t_student_base         （主连接 + 库名前缀；教务不参与统一表切读）
 */

import type { Knex } from 'knex';
import { BizCode, STUDENT_STATUS_NAME, StudentStatus } from 'shared-types';
import { BizError } from '../../middleware/errorHandler';
import { assertStatusUnlocked } from '../shared/statusLock';
import { db as jobDb } from '../../utils/db';
import { db as classDb } from '../../class/db';
import { db as classJhDb } from '../../class-jh/utils/db';
import { tbl, uniDb } from '../shared/uniTable';
import type { StudentStage } from '../shared/dto';

const T_STUDENT = 't_class_student';
const T_JOB_STUDENT = 't_student_base';

/**
 * ★ 2026-10-22 合并上游后修：`StudentStage` 已收敛为 'jh' | 'class' | 'emp'，
 *   但本文件的分支按**数据真实所在表**写的，'job'（实训生、edu_stage='job'）
 *   与 'edu'（教务库 sms_edu，不在统一表映射里）两条分支运行时仍可能被老调用方命中，
 *   所以这里放宽入参类型、分支一个不删（删了会把实训生读到就业生的空集合里）。
 */
type StageLike = StudentStage | 'job' | 'edu';

function qbOf(stage: StageLike): Knex.QueryBuilder {
  switch (stage) {
    case 'jh':
      return tbl(classJhDb, 'sms_class_jh', T_STUDENT, 'jh');
    case 'class':
      return tbl(classDb, 'sms_class', T_STUDENT, 'class');
    case 'job':
      return tbl(jobDb, 'sms_job', T_JOB_STUDENT, 'job');
    /**
     * ★ 2026-10-25 修：「就业」学段的学生在库里可能是 edu_stage='job'（实训升上来的）
     *   也可能是 'emp'。原来 `tbl(...,'emp')` 会被注入 edu_stage='emp' →
     *   库里那条 'job' 的学生查不到 → 点【已就业】报「学生不存在」
     *   （用户实测：学生 999 在就业部列表能看到，点已就业却提示不存在）。
     *   与 repo.emp 的取数口径保持一致：edu_stage in ('job','emp') 且 dept_code=3。
     */
    case 'emp':
      return uniDb('t_uni_student')
        .whereIn('edu_stage', ['job', 'emp'])
        .andWhere('dept_code', 3);
    case 'edu':
    default:
      // 教务：库名前缀直接写死（该库不在统一表映射里）
      return jobDb('sms_edu.t_student_base');
  }
}

/** 读当前状态（找不到返回 null） */
export async function getStudentStatus(stage: StudentStage, id: string): Promise<number | null> {
  const row = (await qbOf(stage).where({ id, is_deleted: false }).first('id', 'student_status')) as
    | Record<string, any>
    | undefined;
  if (!row) return null;
  return row.student_status === null || row.student_status === undefined ? null : Number(row.student_status);
}

export interface MarkEmployedResult {
  fromStatus: number | null;
  fromStatusName: string;
  toStatusName: string;
}

/**
 * 标记为「已就业」
 *   · 学生必须存在
 *   · 已经是「已就业」→ 直接报错（终态，不可重复/不可逆）
 *   · ★ 2026-10-21 批注：已「退学」的学生状态被永久锁死 → 也直接报错
 *     （前端已不显示按钮，这里兜住直接调接口的情况，见 shared/statusLock.ts）
 */
export async function markEmployed(
  stage: StudentStage,
  id: string,
  user: any,
): Promise<MarkEmployedResult> {
  const from = await getStudentStatus(stage, id);
  if (from === null) throw new BizError(BizCode.STUDENT_NOT_FOUND, '学生不存在或已删除');
  if (from === StudentStatus.EMPLOYED) {
    throw new BizError(BizCode.PARAM_ERROR, '该学生已是「已就业」，该操作不可重复');
  }
  /**
   * ★ 2026-10-23 用户口径：**只有状态是「待就业」的学生才能标记已就业**。
   *   原来只挡了「已是已就业」，在读/试学/实训中/休学都能被一键标成已就业。
   */
  if (from !== StudentStatus.WAIT_EMPLOY) {
    throw new BizError(
      BizCode.PARAM_ERROR,
      `只有「待就业」的学生才能标记已就业（当前：${STUDENT_STATUS_NAME[from] ?? from}）`,
    );
  }
  assertStatusUnlocked(from, '该学生');

  await qbOf(stage).where({ id }).update({
    student_status: StudentStatus.EMPLOYED,
    update_time: new Date(),
    update_by: user?.userId || 'system',
  });

  return {
    fromStatus: from,
    fromStatusName: STUDENT_STATUS_NAME[from] ?? String(from),
    toStatusName: STUDENT_STATUS_NAME[StudentStatus.EMPLOYED] ?? '已就业',
  };
}
