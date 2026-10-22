/**
 * 班级编号全局唯一校验（★ 2026-10-22 用户口径）
 * ============================================================
 *
 * 【为什么必须跨三个部门查】
 *   学号 = LZ + 班级编号 + 序号。如果初高有个班叫 Q17、大学也有个班叫 Q17，
 *   两个班各自都会生成 LZQ17001 —— 学号就重了。
 *   学号在系统里被当成「跨学段唯一标识」用（学生档案「全部」按学号去重、
 *   缴费记录按学号归集），重号会把两个人当成一个人、把缴费串到一起。
 *
 *   → 保存班级时把初高部 / 大学部 / 就业部（含实训）三张表一起查，
 *     编号被任何一张表占用都直接拦下。
 */

import { tbl } from './uniTable';
import { db as jhDb } from '../../class-jh/utils/db';
import { db as classDb } from '../../class/db';
import { db as jobDb } from '../../utils/db';

export type ClassCodeStage = 'jh' | 'class' | 'job' | 'emp';

/** 三张班级表（实训与就业部共用 t_job_class，只查一次） */
const SOURCES: Array<{ stage: 'jh' | 'class' | 'emp'; conn: any; schema: string; table: string; label: string }> = [
  { stage: 'jh', conn: jhDb, schema: 'sms_class_jh', table: 't_class_info', label: '初高部的班级' },
  { stage: 'class', conn: classDb, schema: 'sms_class', table: 't_class_info', label: '大学部的班级' },
  { stage: 'emp', conn: jobDb, schema: 'sms_job', table: 't_job_class', label: '就业部/实训的班级' },
];

/**
 * 班级编号是否可用；被占用时抛错（错误文案带上占用方的部门，便于定位）
 *
 * @param exclude 编辑场景：传自己的学段 + id，跳过自己那条
 */
export async function assertClassCodeAvailable(
  code: string,
  exclude?: { stage: ClassCodeStage; id?: string },
): Promise<void> {
  const val = String(code ?? '').trim();
  if (!val) return; // 空编号不参与唯一性（历史班级允许为空）

  for (const s of SOURCES) {
    const q = tbl(s.conn, s.schema, s.table, s.stage)
      .where({ class_code: val, is_deleted: false });
    // 实训 / 就业部同一张表：只要学段命中其中之一就不排除自己
    const sameTable =
      exclude && exclude.id && (s.stage === exclude.stage || (s.stage === 'emp' && exclude.stage === 'job'));
    if (sameTable) q.andWhereNot('id', exclude!.id);
    const hit = (await q.first()) as Record<string, any> | undefined;
    if (hit) {
      throw new Error(`班级编号「${val}」已被${s.label}占用，请换一个（学号按「LZ+班级编号+序号」生成，重号会导致学号重复）`);
    }
  }
}
