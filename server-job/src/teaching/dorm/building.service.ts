/**
 * 宿舍楼栋设置（全局字典）
 * ============================================================
 *
 * 【一张表服务两个入口，这是本模块的立身之本】
 *   ① 教学管理 → 系统设置 →「楼栋设置」页签（增删改）
 *   ② 教学管理 → 宿舍管理 → 楼栋下拉 / 新增房间的楼栋选项（只读）
 *
 *   两边读的都是 `sms_common.t_dorm_building` 这一张表，
 *   所以在设置页加了「4号楼」，宿舍管理的下拉**不用改代码**就会多一项。
 *   反过来也是同一份：下拉里看到什么，设置页里就有什么。
 *
 * 【为什么是全局的（不带 edu_stage）】
 *   楼栋是物理建筑，不分学段。「1号楼」在初高是 1 号楼，在实训也是 1 号楼。
 *   按学段各存一份 → 设置页加一栋要加三遍，三边迟早不一致。
 *
 * 【★ 软删 + 服务层唯一校验（故意不用数据库唯一索引）】
 *   MySQL 的唯一索引不区分软删行：删掉「3号楼」再想加回来会撞 ER_DUP_ENTRY，
 *   而报错信息完全看不出是「之前删过」导致的（t_job_dorm.dorm_no 踩过同款坑）。
 *   → 唯一性自己判：只跟 `is_deleted = 0` 的行比；撞上软删行就**复活它**，
 *     用户看到的行为是「加回来了」，而不是「加不进去」。
 */

import { randomUUID } from 'crypto';
import { BizCode } from 'shared-types';
import { BizError } from '../../middleware/errorHandler';
import { commonDb } from '../../class/db';
import { db as jobDb } from '../../utils/db';
import { USE_UNI_TABLE, uniDb } from '../shared/uniTable';

const T = 't_dorm_building';

export interface DormBuildingRow {
  id: string;
  buildingName: string;
  category: number | null;
  sortNo: number;
  remark: string | null;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  return String(v);
}

/** 楼栋列表（按 sort_no → building_name 排，保证下拉顺序稳定） */
export async function listBuildings(): Promise<DormBuildingRow[]> {
  const rows = await commonDb(T)
    .where({ is_deleted: false })
    .orderBy('sort_no', 'asc')
    .orderBy('building_name', 'asc');
  return rows.map((r: any) => ({
    id: String(r.id),
    buildingName: String(r.building_name ?? ''),
    category: r.category === null || r.category === undefined ? null : Number(r.category),
    sortNo: Number(r.sort_no ?? 0),
    remark: str(r.remark),
  }));
}

/** 只取楼栋名（给下拉用） */
export async function listBuildingNames(): Promise<string[]> {
  return (await listBuildings()).map((b) => b.buildingName).filter(Boolean);
}

export interface DormBuildingSaveBody {
  id?: string;
  buildingName: string;
  category?: number;
  sortNo?: number;
  remark?: string | null;
}

function normalizeCategory(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (Number.isNaN(n)) return null;
  return n;
}

export async function saveBuilding(
  body: DormBuildingSaveBody,
  userId: string,
): Promise<{ id: string }> {
  const name = String(body.buildingName ?? '').trim();
  if (!name) throw new BizError(BizCode.PARAM_ERROR, '楼栋名称必填');
  if (name.length > 50) throw new BizError(BizCode.PARAM_ERROR, '楼栋名称不能超过 50 个字');
  const category = normalizeCategory(body.category);
  if (category !== null && category !== 1 && category !== 2) {
    throw new BizError(BizCode.PARAM_ERROR, '楼栋类别只能选「男寝」或「女寝」');
  }
  if (str(body.remark) && String(body.remark).length > 100) {
    throw new BizError(BizCode.PARAM_ERROR, '备注不能超过 100 个字');
  }

  const sortNo = Number.isFinite(Number(body.sortNo))
    ? Math.floor(Number(body.sortNo))
    : 999;

  if (body.id) {
    const cur = await commonDb(T).where({ id: String(body.id), is_deleted: false }).first();
    if (!cur) throw new BizError(BizCode.PARAM_ERROR, '楼栋不存在或已删除');
    // 改名也要查重（排除自己）
    const dup = await commonDb(T)
      .where({ building_name: name, is_deleted: false })
      .whereNot('id', String(body.id))
      .first();
    if (dup) throw new BizError(BizCode.PARAM_ERROR, `楼栋「${name}」已存在`);
    await commonDb(T).where({ id: String(body.id) }).update({
      building_name: name,
      category,
      sort_no: sortNo,
      remark: str(body.remark),
      update_time: new Date(),
      update_by: userId,
    });
    return { id: String(body.id) };
  }

  /**
   * ★ 软删行「复活」而不是报重复
   *   用户视角：删了 3 号楼 → 再加 3 号楼，应该成功。
   *   若这里直接报「已存在」，用户只能换个名字，等于数据被永久污染。
   */
  const alive = await commonDb(T).where({ building_name: name, is_deleted: false }).first();
  if (alive) throw new BizError(BizCode.PARAM_ERROR, `楼栋「${name}」已存在`);

  const dead = await commonDb(T).where({ building_name: name, is_deleted: true }).first();
  if (dead) {
    await commonDb(T).where({ id: String(dead.id) }).update({
      is_deleted: false,
      category,
      sort_no: sortNo,
      remark: str(body.remark),
      update_time: new Date(),
      update_by: userId,
    });
    return { id: String(dead.id) };
  }

  const id = randomUUID();
  await commonDb(T).insert({
    id,
    building_name: name,
    category,
    sort_no: sortNo,
    remark: str(body.remark),
    is_deleted: false,
    create_time: new Date(),
    create_by: userId,
    update_time: new Date(),
    update_by: userId,
  });
  return { id };
}

/**
 * 删除楼栋（软删）
 *
 * ★ 已被引用的楼栋不允许删：
 *   宿舍表里已经有「1号楼」的房间，把字典项删了 → 那些房间的楼栋变成
 *   「下拉里选不到的值」，筛选永远查不出、编辑也选不回来。
 *   → 先拦，提示用户先把房间迁走或删除。
 */
export async function removeBuilding(id: string, userId: string): Promise<void> {
  const cur = await commonDb(T).where({ id: String(id), is_deleted: false }).first();
  if (!cur) throw new BizError(BizCode.PARAM_ERROR, '楼栋不存在或已删除');

  const used = await countRoomsOfBuilding(String(cur.building_name));
  if (used > 0) {
    throw new BizError(
      BizCode.PARAM_ERROR,
      `楼栋「${cur.building_name}」下还有 ${used} 间宿舍，不能删除；请先删除或迁移这些宿舍`,
    );
  }

  await commonDb(T)
    .where({ id: String(id) })
    .update({ is_deleted: true, update_time: new Date(), update_by: userId });
}

/**
 * 某楼栋名下还有多少间在用宿舍
 *
 * 【★ 两套读法，不能混】
 *   开关开（TEACHING_UNI_TABLE=1）→ 三学段合在 `t_uni_dorm_room`，靠 edu_stage 区分
 *     → 必须**按学段各查一次再相加**。
 *   开关关（默认）→ 三学段**读的就是同一张** `sms_job.t_job_dorm`
 *     （见 uniTable.tbl()：开关关时直接返回 `db(老表)`，不加任何学段条件）
 *     → 只能查**一次**，查三次会得到 3 倍的假数字。
 *
 *   这正是本项目「同名不同义」类 bug 的高发点，所以这里显式分支，不用循环糊过去。
 */
async function countRoomsOfBuilding(building: string): Promise<number> {
  if (!USE_UNI_TABLE) {
    const [r] = await jobDb('t_job_dorm')
      .where({ is_deleted: false, building })
      .count({ n: '*' });
    return Number(r?.n || 0);
  }
  let n = 0;
  for (const stage of ['jh', 'class', 'job'] as const) {
    const [r] = await uniDb('t_uni_dorm_room')
      .where({ edu_stage: stage, is_deleted: false, building })
      .count({ n: '*' });
    n += Number(r?.n || 0);
  }
  return n;
}
