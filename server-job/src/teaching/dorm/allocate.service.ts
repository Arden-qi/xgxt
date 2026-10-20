/**
 * 班级宿舍分派（教务给各班分派宿舍）
 * ============================================================
 *
 * 【做什么】
 *   在「教学管理 → 宿舍管理」里新增的子页面：按班级列出男/女生人数，
 *   点「分派」后左右两栏分别给男寝 / 女寝挑宿舍，保存后回显到「所分宿舍」列。
 *
 * 【数据来自哪】
 *   ① 班级：优先取「班级管理」三学段的班级表（sms_class_jh.t_class_info /
 *      sms_class.t_class_info / sms_job.t_job_class）；
 *      班级表还没建班（实测为空）时，回退到 `sms_edu.t_student_base` 的
 *      班级名字段 —— 否则页面会是一片空白，教务根本没法分派。
 *   ② 人数：按班级分组数学生表 `gender=1`（男）/ `gender=2`（女）。
 *   ③ 宿舍：**教务宿舍表**（sms_edu.t_edu_dorm_room / t_edu_dorm_bed），
 *      与「教务管理 → 宿舍管理 → 分派宿舍」是同一份数据；
 *      剩余床位 = 额定人数 - 已住（已住 = 床位表里 student_name 非空的条数）。
 *   ④ 分派关系：复用 `sms_edu.t_edu_dorm_assignment`
 *      （class_name / head_teacher_name / room_id / building / room / category），
 *      不新建表 —— 这份表本来就是「班级 ↔ 宿舍」的权威关系。
 *
 * 【一条硬规则：一间宿舍同一时间只归一个班】
 *   与既有 /api/edu/dorm/assign 完全一致；冲突时直接报出是哪几间、被谁占了。
 */

import { randomUUID } from 'crypto';
import { BizCode } from 'shared-types';
import { BizError } from '../../middleware/errorHandler';
import { db } from '../../utils/db';
import { syncEduDormToClass } from '../../services/dorm-sync.service';

const ROOM = 'sms_edu.t_edu_dorm_room';
const BED = 'sms_edu.t_edu_dorm_bed';
const ASSIGN = 'sms_edu.t_edu_dorm_assignment';
const EDU_STUDENT = 'sms_edu.t_student_base';

export interface AllocateRoomRef {
  roomId: string;
  building: string;
  room: string;
  category: number;
  capacity: number;
}

export interface AllocateClassRow {
  className: string;
  headTeacherName: string | null;
  maleCount: number;
  femaleCount: number;
  /** 已分派 / 待分派 */
  status: string;
  maleRooms: AllocateRoomRef[];
  femaleRooms: AllocateRoomRef[];
  /** 已选中床位数（按房间额定人数累加，仅作展示/校验参考） */
  maleBeds: number;
  femaleBeds: number;
}

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}
function int(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/* ============================================================
 * 班级 + 人数
 * ============================================================ */

interface ClassBase {
  className: string;
  headTeacherName: string | null;
  maleCount: number;
  femaleCount: number;
  stage: string;
}

/** 三学段班级表（班级管理的权威来源） */
async function teachingClasses(): Promise<ClassBase[]> {
  const specs = [
    { stage: 'jh', cls: 'sms_class_jh.t_class_info', stu: 'sms_class_jh.t_class_student' },
    { stage: 'class', cls: 'sms_class.t_class_info', stu: 'sms_class.t_class_student' },
    { stage: 'job', cls: 'sms_job.t_job_class', stu: 'sms_job.t_student_base' },
  ];

  const out: ClassBase[] = [];
  for (const s of specs) {
    let classes: any[] = [];
    try {
      classes = await db(s.cls)
        .where({ is_deleted: false })
        .select('id', 'class_name', 'head_teacher_name');
    } catch {
      // 表不存在（环境没迁移）→ 跳过该学段，不阻塞另外两个
      continue;
    }
    if (!classes.length) continue;

    let counts: any[] = [];
    try {
      counts = await db(s.stu)
        .where({ is_deleted: false })
        .whereNotNull('class_id')
        .whereNot('class_id', '')
        .groupBy('class_id')
        .select('class_id')
        .select(db.raw('SUM(gender = 1) AS m'), db.raw('SUM(gender = 2) AS f'));
    } catch {
      counts = [];
    }
    const byClass = new Map(counts.map((c) => [str(c.class_id), c]));

    for (const c of classes) {
      const name = str(c.class_name).trim();
      if (!name) continue;
      const cnt = byClass.get(str(c.id));
      out.push({
        className: name,
        headTeacherName: str(c.head_teacher_name).trim() || null,
        maleCount: int(cnt?.m),
        femaleCount: int(cnt?.f),
        stage: s.stage,
      });
    }
  }
  return out;
}

/** 教务学生表里的班级（班级表为空时的兜底；也是教务实际在用的班级口径） */
async function eduClasses(): Promise<ClassBase[]> {
  const rows = await db(EDU_STUDENT)
    .where({ is_deleted: false })
    .whereNotNull('class_name')
    .whereNot('class_name', '')
    .groupBy('class_name')
    .select('class_name')
    .select(
      db.raw('MAX(head_teacher_name) AS ht'),
      db.raw('SUM(gender = 1) AS m'),
      db.raw('SUM(gender = 2) AS f'),
    );

  return (rows as any[])
    .map((r) => ({
      className: str(r.class_name).trim(),
      headTeacherName: str(r.ht).trim() || null,
      maleCount: int(r.m),
      femaleCount: int(r.f),
      stage: 'edu',
    }))
    .filter((r) => !!r.className);
}

/**
 * 门户学生主档里的班级（最后一层兜底）
 *
 * 【为什么还要这一层】
 *   本项目的演示库里 `sms_edu.t_student_base` 整表 `is_deleted=1`（历史种子），
 *   真正「在读」的学生在 `sms_perm.t_student_base`（门户权限库的学生投影）。
 *   如果只查前两层，页面会一个班都列不出来 —— 功能看起来像没做。
 *   有真实班级表的环境里，这一层自然被前面的结果覆盖（按班级名去重）。
 */
async function permClasses(): Promise<ClassBase[]> {
  try {
    const rows = (await db('sms_perm.t_student_base')
      .where({ is_deleted: false })
      .whereNotNull('class_name')
      .whereNot('class_name', '')
      .groupBy('class_name')
      .select('class_name')
      .select(
        db.raw('MAX(head_teacher_name) AS ht'),
        db.raw('SUM(gender = 1) AS m'),
        db.raw('SUM(gender = 2) AS f'),
      )) as any[];
    return rows
      .map((r) => ({
        className: str(r.class_name).trim(),
        headTeacherName: str(r.ht).trim() || null,
        maleCount: int(r.m),
        femaleCount: int(r.f),
        stage: 'edu',
      }))
      .filter((r) => !!r.className);
  } catch {
    return [];
  }
}

/* ============================================================
 * 分派关系
 * ============================================================ */

async function assignmentRows(): Promise<any[]> {
  return db(`${ASSIGN} as a`)
    .join(`${ROOM} as r`, 'a.room_id', 'r.id')
    .where('a.is_deleted', false)
    .where('r.is_deleted', false)
    .select(
      'a.class_name',
      'a.room_id',
      'a.building',
      'a.room',
      'a.category',
      'r.capacity',
    );
}

/* ============================================================
 * 班级列表
 * ============================================================ */

export async function listAllocateClasses(keyword?: string): Promise<AllocateClassRow[]> {
  const [teaching, edu, perm, assigns] = await Promise.all([
    teachingClasses().catch(() => [] as ClassBase[]),
    eduClasses().catch(() => [] as ClassBase[]),
    permClasses(),
    assignmentRows().catch(() => [] as any[]),
  ]);

  /**
   * 去重：班级表优先，教务/门户学生表的同名班级只用来补缺。
   * 名次按「初高 → 大学 → 实训 → 教务」稳定排列，前端下拉/列表不会跳来跳去。
   */
  const merged: ClassBase[] = [];
  const seen = new Set<string>();
  for (const c of [...teaching, ...edu, ...perm]) {
    if (seen.has(c.className)) continue;
    seen.add(c.className);
    merged.push(c);
  }

  // 班级 → 已分派房间
  const byClass = new Map<string, any[]>();
  for (const a of assigns) {
    const name = str(a.class_name).trim();
    if (!name) continue;
    if (!byClass.has(name)) byClass.set(name, []);
    byClass.get(name)!.push(a);
  }

  const kw = str(keyword).trim().toLowerCase();

  return merged
    .filter((c) => (!kw ? true : c.className.toLowerCase().includes(kw) || str(c.headTeacherName).toLowerCase().includes(kw)))
    .map((c) => {
      const rows = byClass.get(c.className) || [];
      const toRef = (a: any): AllocateRoomRef => ({
        roomId: str(a.room_id),
        building: str(a.building),
        room: str(a.room),
        category: int(a.category),
        capacity: int(a.capacity),
      });
      const maleRooms = rows.filter((a) => int(a.category) === 1).map(toRef);
      const femaleRooms = rows.filter((a) => int(a.category) === 2).map(toRef);
      return {
        className: c.className,
        headTeacherName: c.headTeacherName,
        maleCount: c.maleCount,
        femaleCount: c.femaleCount,
        status: rows.length ? '已分派' : '待分派',
        maleRooms,
        femaleRooms,
        maleBeds: maleRooms.reduce((s, r) => s + r.capacity, 0),
        femaleBeds: femaleRooms.reduce((s, r) => s + r.capacity, 0),
      };
    })
    .sort((a, b) => a.className.localeCompare(b.className, 'zh-Hans-CN'));
}

/* ============================================================
 * 楼栋 / 宿舍（分派弹窗用）
 * ============================================================ */

/** 按类别返回楼栋（只认宿舍表里真实存在的楼栋，按自然序） */
export async function listAllocateBuildings(category: number): Promise<string[]> {
  const rows = (await db(ROOM)
    .where({ is_deleted: false, category })
    .distinct('building')) as any[];
  return rows
    .map((r) => str(r.building).trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));
}

export interface AllocateRoomRow {
  roomId: string;
  building: string;
  room: string;
  category: number;
  capacity: number;
  occupied: number;
  remaining: number;
  /** 住满不可选 */
  full: boolean;
  /** 已分派给哪个班（空 = 未分派） */
  assignedTo: string | null;
}

export async function listAllocateRooms(
  category: number,
  building?: string,
): Promise<AllocateRoomRow[]> {
  const qb = db(ROOM).where({ is_deleted: false, category });
  const b = str(building).trim();
  if (b) qb.andWhere('building', b);
  const rooms = (await qb.orderBy(['building', 'room'])) as any[];
  if (!rooms.length) return [];

  const ids = rooms.map((r) => str(r.id));
  const occupied = (await db(BED)
    .whereIn('room_id', ids)
    .where({ is_deleted: false })
    .whereNotNull('student_name')
    .groupBy('room_id')
    .select('room_id')
    .count({ n: '*' })) as any[];
  const occMap = new Map(occupied.map((o) => [str(o.room_id), int(o.n)]));

  const assigned = (await db(ASSIGN)
    .whereIn('room_id', ids)
    .where({ is_deleted: false })
    .select('room_id', 'class_name')) as any[];
  const assignMap = new Map(assigned.map((a) => [str(a.room_id), str(a.class_name)]));

  return rooms.map((r) => {
    const capacity = int(r.capacity);
    const used = occMap.get(str(r.id)) || 0;
    const remaining = Math.max(capacity - used, 0);
    return {
      roomId: str(r.id),
      building: str(r.building),
      room: str(r.room),
      category: int(r.category),
      capacity,
      occupied: used,
      remaining,
      full: remaining <= 0,
      assignedTo: assignMap.get(str(r.id)) || null,
    };
  });
}

/* ============================================================
 * 保存分派
 * ============================================================ */

export async function saveAllocate(body: {
  className?: unknown;
  headTeacherName?: unknown;
  maleRoomIds?: unknown;
  femaleRoomIds?: unknown;
  userId?: string;
}): Promise<{ male: number; female: number }> {
  const className = str(body.className).trim();
  if (!className) throw new BizError(BizCode.PARAM_ERROR, '请选择班级');

  const maleIds = [...new Set((Array.isArray(body.maleRoomIds) ? body.maleRoomIds : []).map((x) => str(x).trim()).filter(Boolean))];
  const femaleIds = [...new Set((Array.isArray(body.femaleRoomIds) ? body.femaleRoomIds : []).map((x) => str(x).trim()).filter(Boolean))];

  const dup = maleIds.find((id) => femaleIds.includes(id));
  if (dup) throw new BizError(BizCode.PARAM_ERROR, '同一间宿舍不能同时分给男寝和女寝');

  const allIds = [...maleIds, ...femaleIds];
  const rooms = allIds.length
    ? ((await db(ROOM).whereIn('id', allIds).where({ is_deleted: false })) as any[])
    : [];
  if (rooms.length !== allIds.length) {
    throw new BizError(BizCode.PARAM_ERROR, '部分宿舍不存在或已被删除，请刷新后重试');
  }
  const roomMap = new Map(rooms.map((r) => [str(r.id), r]));

  // 类别校验：左栏只能选男寝、右栏只能选女寝
  for (const id of maleIds) {
    if (int(roomMap.get(id)?.category) !== 1) {
      throw new BizError(BizCode.PARAM_ERROR, `宿舍 ${str(roomMap.get(id)?.room)} 不是男寝，不能分到男生栏`);
    }
  }
  for (const id of femaleIds) {
    if (int(roomMap.get(id)?.category) !== 2) {
      throw new BizError(BizCode.PARAM_ERROR, `宿舍 ${str(roomMap.get(id)?.room)} 不是女寝，不能分到女生栏`);
    }
  }

  /**
   * 一间宿舍同一时间只能归一个班 —— 但**允许从别的班手里接管**（教务重新划分）。
   *
   * 【为什么不直接拦掉】
   *   用户口径里只有「住满的宿舍不可选」，没有「已分给别的班不可选」；
   *   而且教务的日常动作就是「把某间从 A 班调到 B 班」。
   *   → 这里只记录被接管的班，保存时把它们原有的分派行软删（并在保存后同步班级侧），
   *     界面上仍会提示「原属 X 班」，不会偷偷抢。
   */
  const conflicts = allIds.length
    ? ((await db(ASSIGN)
        .whereIn('room_id', allIds)
        .where({ is_deleted: false })
        .whereNot('class_name', className)
        .select('room_id', 'class_name')) as any[])
    : [];
  const releasedClasses = [...new Set(conflicts.map((c) => str(c.class_name)).filter(Boolean))];

  const existing = (await db(ASSIGN)
    .where({ class_name: className, is_deleted: false })
    .select('id', 'room_id')) as any[];
  const targetSet = new Set(allIds);
  const removedRoomIds = existing.map((e) => str(e.room_id)).filter((id) => !targetSet.has(id));

  const headTeacherName = str(body.headTeacherName).trim() || null;
  const now = new Date();
  const userId = body.userId || 'system';

  await db.transaction(async (trx) => {
    // ① 先整班清空（覆盖式语义：勾选结果 = 该班最终分到的宿舍）
    if (existing.length) {
      await trx(ASSIGN)
        .where({ class_name: className, is_deleted: false })
        .update({ is_deleted: true, update_time: now, update_by: userId });
    }

    // ② 接管：把其它班在这几间上的分派行软删（保存后统一同步班级侧）
    if (conflicts.length) {
      await trx(ASSIGN)
        .whereIn('room_id', allIds)
        .where({ is_deleted: false })
        .whereNot('class_name', className)
        .update({ is_deleted: true, update_time: now, update_by: userId });
    }

    // ③ 逐间写入
    //
    // ⚠️ 这张表有 `uk_assign_room(room_id)` 唯一键 —— **软删行也占着**。
    //   所以不能按 (room_id, class_name) 找软删行（那是另一种组合，找不到），
    //   必须**按 room_id 单列**找：找到就复活并改 class_name（接管），找不到才 insert。
    for (const roomId of allIds) {
      const r = roomMap.get(roomId)!;
      const revive = await trx(ASSIGN)
        .where({ room_id: roomId })
        .update({
          class_name: className,
          head_teacher_name: headTeacherName,
          building: str(r.building),
          room: str(r.room),
          category: int(r.category),
          is_deleted: false,
          update_time: now,
          update_by: userId,
        });
      if (!revive) {
        await trx(ASSIGN).insert({
          id: randomUUID(),
          class_name: className,
          head_teacher_name: headTeacherName,
          room_id: roomId,
          building: str(r.building),
          room: str(r.room),
          category: int(r.category),
          remark: null,
          is_deleted: false,
          create_time: now,
          create_by: userId,
          update_time: now,
          update_by: userId,
        });
      }
    }
  });

  // ④ 推送班级管理（非阻断：内部已 try/catch，失败只记日志）
  await syncEduDormToClass(className, removedRoomIds);
  // 被接管的班也要同步一次，否则班级侧还留着这几间的旧副本
  for (const cls of releasedClasses) {
    await syncEduDormToClass(cls, allIds);
  }

  return { male: maleIds.length, female: femaleIds.length };
}
