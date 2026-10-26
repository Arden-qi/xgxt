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
 *      班级表还没建班（实测为空）时，回退到教务 / 门户学生表的班级名 ——
 *      否则页面会是一片空白，教务根本没法分派。
 *   ② 人数：按班级分组数学生表 `gender=1`（男）/ `gender=2`（女）。
 *   ③ 楼栋：**只认「系统设置 → 楼栋设置」里的楼栋**（sms_common.t_dorm_building），
 *      按类别（1 男寝 / 2 女寝）分左右两栏。
 *   ④ 宿舍：各楼栋在「宿舍管理」里建出来的房间（sms_job.t_job_dorm + t_job_dorm_bed），
 *      剩余床位 = bed_count - 已住（已住优先数学生主档 dorm_id，退回床位表 bed_status=2）。
 *   ⑤ 分派关系：`sms_edu.t_edu_dorm_assignment`
 *      （class_name / head_teacher_name / room_id / building / room / category），
 *      不新建表；room_id 存的是宿舍房间主键（t_job_dorm.id）。
 *
 * 【★ 没有学生的新班级也能分派】
 *   班级刚建、学生还没导入时，男/女生人数都是 0。
 *   这一档不做「按人数选够」的校验，改为**按床位上限**：
 *   已选床位数 ≤ 100（EMPTY_CLASS_MAX_BEDS）。
 *
 * 【一间宿舍只归一个班】
 *   允许从别的班接管（教务重新划分），保存时软删原班的分派行。
 */

import { randomUUID } from 'crypto';
import { BizCode } from 'shared-types';
import { bedNoText } from 'shared-types/class';
import { BizError } from '../../middleware/errorHandler';
import { db } from '../../utils/db';
import { resolveMyClasses } from './myClasses';
import {
  CLASS_STATUS_CLOSED,
  CLASS_STATUS_NAME,
  CLASS_STATUS_OPEN,
  isLockedByClassStatus,
  loadClassStatuses,
} from './classStatus';

/**
 * ★ 2026-10-22 修：sms_job 的这三张老表在 P8 归一后**已 DROP**，
 *   原来直接 `db('sms_job.t_job_dorm')` 裸查 → 打开「分派宿舍」就弹
 *   「数据表不存在: sms_job.t_job_dorm」（一连 4 个红错）。
 *   统一表列名与老表同名兼容（t_uni_dorm_room 就是从 t_job_dorm 归一的），
 *   改指到 sms_common 即可。
 *   ⚠️ 保留「sms_job 连接 + 库名前缀」的写法：下面有 sms_edu ⋈ 房间表的
 *      跨库 join 依赖前缀；sms_edu / sms_perm 的表没归一、还在，不动。
 */
const ROOM = 'sms_common.t_uni_dorm_room';
const BED = 'sms_common.t_uni_dorm_bed';
const STUDENT = 'sms_common.t_uni_student';
/** 楼栋字典（与「楼栋设置」同一份） */
const BUILDING = 'sms_common.t_dorm_building';
const ASSIGN = 'sms_edu.t_edu_dorm_assignment';
const EDU_STUDENT = 'sms_edu.t_student_base';
const PERM_STUDENT = 'sms_perm.t_student_base';

/** 可以住宿舍的学生状态：3 试学中 / 5 正式在读 / 8 实训中（与 dorm repo 同口径） */
const IN_SCHOOL_STATUS = [3, 5, 8];

/** ★ 无学生班级的分派床位上限 */
const EMPTY_CLASS_MAX_BEDS = 100;

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
  /** 已选中床位数（按房间额定人数累加，仅作展示参考） */
  maleBeds: number;
  femaleBeds: number;
  /** ★ 班级状态：1 开放 / 2 封班（查不到为 null） */
  classStatus: number | null;
  classStatusName: string | null;
  /** 该班暂无学生 → 前端按 100 床上限分派 */
  noStudents: boolean;
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
  /** 1 开放 / 2 封班 / null 未知 */
  classStatus: number | null;
}

/** 三学段班级表（班级管理的权威来源） */
async function teachingClasses(): Promise<ClassBase[]> {
  /**
   * ★ 2026-10-23 修：这三个 specs 还指着已 DROP 的老表
   *   （sms_class_jh.t_class_info / sms_class.t_class_info / sms_job.t_job_class…），
   *   每个学段的查询抛错被 `catch { continue }` 吞掉 → 分派宿舍页的
   *   「班级列表」整个为空（校长也看不见任何班，新建的班自然也选不了）。
   *   三学段的班级/学生在 P8 后都归一到 t_uni_class / t_uni_student，
   *   用 edu_stage 区分学段即可；列名与老表同名兼容。
   */
  const specs = [
    { stage: 'jh', cls: 'sms_common.t_uni_class', stu: 'sms_common.t_uni_student', edu: 'jh' },
    { stage: 'class', cls: 'sms_common.t_uni_class', stu: 'sms_common.t_uni_student', edu: 'class' },
    { stage: 'job', cls: 'sms_common.t_uni_class', stu: 'sms_common.t_uni_student', edu: 'job' },
  ];

  const out: ClassBase[] = [];
  for (const s of specs) {
    let classes: any[] = [];
    try {
      classes = await db(s.cls)
        .where({ is_deleted: false, edu_stage: s.edu })
        .select('id', 'class_name', 'head_teacher_name', 'class_status');
    } catch {
      // 表不存在（环境没迁移）→ 跳过该学段，不阻塞另外两个
      continue;
    }
    if (!classes.length) continue;

    let counts: any[] = [];
    try {
      counts = await db(s.stu)
        .where({ is_deleted: false, edu_stage: s.edu })
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
        classStatus: Number(c.class_status) > 0 ? Number(c.class_status) : null,
      });
    }
  }
  return out;
}

/** 教务学生表里的班级（班级表为空时的兜底；也是教务实际在用的班级口径） */
async function eduClasses(): Promise<ClassBase[]> {
  return groupStudentsByClass(EDU_STUDENT, 'edu');
}

/**
 * 门户学生主档里的班级（最后一层兜底）
 *
 * 【为什么还要这一层】
 *   本项目的演示库里 `sms_edu.t_student_base` 整表 `is_deleted=1`（历史种子），
 *   真正「在读」的学生在 `sms_perm.t_student_base`（门户权限库的学生投影）。
 *   如果只查前两层，页面会一个班都列不出来 —— 功能看起来像没做。
 */
async function permClasses(): Promise<ClassBase[]> {
  return groupStudentsByClass(PERM_STUDENT, 'edu');
}

async function groupStudentsByClass(table: string, stage: string): Promise<ClassBase[]> {
  try {
    const rows = (await db(table)
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
        stage,
        classStatus: null,
      }))
      .filter((r) => !!r.className);
  } catch {
    return [];
  }
}

/**
 * 某个班的学生人数（保存时做「无学生 → 100 床上限」校验用）
 *
 * 逐张学生表按 class_name 数一遍，取**最大值**而不是相加 ——
 * 同一个班在班级学生表 / 教务表 / 门户表里是同一批人的投影，相加会翻倍。
 */
async function classStudentCounts(className: string): Promise<{ male: number; female: number; total: number }> {
  const sources = [
    'sms_class_jh.t_class_student',
    'sms_class.t_class_student',
    'sms_job.t_student_base',
    EDU_STUDENT,
    PERM_STUDENT,
  ];
  let male = 0;
  let female = 0;
  for (const t of sources) {
    try {
      const [row] = (await db(t)
        .where({ is_deleted: false, class_name: className })
        .select(db.raw('SUM(gender = 1) AS m'), db.raw('SUM(gender = 2) AS f'))) as any[];
      male = Math.max(male, int(row?.m));
      female = Math.max(female, int(row?.f));
    } catch {
      /* 表不存在 → 跳过 */
    }
  }
  return { male, female, total: male + female };
}

/* ============================================================
 * 分派关系
 * ============================================================ */

async function assignmentRows(): Promise<any[]> {
  return db(`${ASSIGN} as a`)
    .leftJoin(`${ROOM} as r`, 'a.room_id', 'r.id')
    .where('a.is_deleted', false)
    .select(
      'a.class_name',
      'a.room_id',
      'a.building',
      'a.room',
      'a.category',
      'r.bed_count as capacity',
    );
}

/* ============================================================
 * 班级列表
 * ============================================================ */

export async function listAllocateClasses(
  keyword?: string,
  user?: any,
): Promise<AllocateClassRow[]> {
  const [teaching, edu, perm, assigns] = await Promise.all([
    teachingClasses().catch(() => [] as ClassBase[]),
    eduClasses().catch(() => [] as ClassBase[]),
    permClasses(),
    assignmentRows().catch(() => [] as any[]),
  ]);

  /**
   * 去重：班级表优先，教务/门户学生表的同名班级只用来补缺。
   * 名次按「初高 → 大学 → 实训 → 教务」稳定排列，前端列表不会跳来跳去。
   */
  let merged: ClassBase[] = [];
  const seen = new Set<string>();
  for (const c of [...teaching, ...edu, ...perm]) {
    if (seen.has(c.className)) continue;
    seen.add(c.className);
    merged.push(c);
  }

  /**
   * ★ 2026-10-22：班主任只能看到**自己名下**的班
   *   调宿/退宿弹窗的「班级」下拉原来列全站班级，班主任能选到别人的班。
   *   教务 / 校长 / 学管主任 / 管理员不受限。
   */
  if (user) {
    const mine = await resolveMyClasses(user);
    if (!mine.privileged) {
      const allow = new Set(mine.names);
      merged = merged.filter((c) => allow.has(c.className));
    }
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
        noStudents: c.maleCount + c.femaleCount === 0,
        classStatus: c.classStatus,
        classStatusName:
          c.classStatus === CLASS_STATUS_OPEN ? '开放' : c.classStatus === CLASS_STATUS_CLOSED ? '封班' : null,
      };
    })
    .sort((a, b) => a.className.localeCompare(b.className, 'zh-Hans-CN'));
}

/* ============================================================
 * 楼栋 / 宿舍（分派弹窗用）
 * ============================================================ */

/**
 * 按类别返回楼栋 —— **只认「楼栋设置」里建的楼栋**（含还没建房间的楼栋）
 *
 * 【为什么不从房间表 distinct】
 *   需求明确：下拉要列出「楼栋设置」里建的所有楼栋，宿舍号再按楼栋去房间表取。
 *   这样刚建好楼栋、还没生成房间时，下拉里也能看到它（只是房间列表为空）。
 *   字典里一栋都没有时再退回房间表，避免页面完全空白。
 */
/**
 * ★ 2026-10-23：调宿弹窗的房间数据范围。
 *   用户口径：「班主任换宿时只能选择教务给他分配的宿舍」——
 *   目标宿舍限定为【分派给本班的 ∪ 本班学生已入住的】房间；
 *   教务 / 校长 / 学管 / 管理员（privileged）返回 null = 全量不限定。
 */
async function scopedAllocateRoomIds(user?: any): Promise<string[] | null> {
  if (!user) return null;
  const mine = await resolveMyClasses(user);
  if (mine.privileged) return null;
  const ids = new Set<string>();
  if (mine.names.length) {
    try {
      const assigned = (await db(ASSIGN)
        .whereIn('class_name', mine.names)
        .where({ is_deleted: false })
        .distinct('room_id')) as any[];
      for (const a of assigned) if (str(a.room_id)) ids.add(String(a.room_id));
    } catch {
      /* 分派表不可用 → 跳过 */
    }
  }
  if (mine.ids.length || mine.names.length) {
    try {
      const rows = (await db(STUDENT)
        .where({ is_deleted: false })
        .whereIn('student_status', IN_SCHOOL_STATUS)
        .whereNotNull('dorm_id')
        .andWhere('dorm_id', '<>', '')
        .andWhere((w: any) => {
          if (mine.ids.length) w.orWhereIn('class_id', mine.ids);
          if (mine.names.length) w.orWhereIn('class_name', mine.names);
        })
        .distinct('dorm_id')) as any[];
      for (const r of rows) if (str(r.dorm_id)) ids.add(String(r.dorm_id));
    } catch {
      /* 跳过 */
    }
  }
  return [...ids];
}

export async function listAllocateBuildings(category: number, user?: any): Promise<string[]> {
  let names: string[] = [];
  try {
    const rows = (await db(BUILDING)
      .where({ is_deleted: false, category })
      .orderBy([
        { column: 'sort_no', order: 'asc' },
        { column: 'building_name', order: 'asc' },
      ])
      .select('building_name')) as any[];
    names = rows.map((r) => str(r.building_name).trim()).filter(Boolean);
  } catch {
    names = [];
  }
  if (!names.length) {
    const rows = (await db(ROOM).where({ is_deleted: false }).whereIn('dorm_gender', [category]).distinct('building')) as any[];
    names = rows.map((r) => str(r.building).trim()).filter(Boolean);
  }
  /* ★ 2026-10-23：班主任限定 → 只出「本班分派/入住」房间所在的楼栋 */
  const scope = await scopedAllocateRoomIds(user);
  if (scope !== null) {
    if (!scope.length) return [];
    const inScope = (await db(ROOM).whereIn('id', scope).where({ is_deleted: false }).distinct('building')) as any[];
    const ok = new Set(inScope.map((r) => str(r.building).trim()));
    names = names.filter((n) => ok.has(n));
  }
  return names.sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));
}

export interface AllocateBedRef {
  bedId: string;
  bedNo: string;
  bedLabel: string;
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
  /** ★ 该班当前状态：1 开放 / 2 封班（未分派为 null） */
  assignedStatus: number | null;
  assignedStatusName: string | null;
  /** ★ 是否锁定：已分派且该班是开放（封班 → 空床交回教务，可继续调配） */
  locked: boolean;
  /** ★ 空闲床位（调宿时可选到具体床位） */
  freeBeds: AllocateBedRef[];
}

/** 一批房间的床位统计：capacity / occupied / remaining */
async function roomBedStats(ids: string[]): Promise<Map<string, { capacity: number; occupied: number }>> {
  const out = new Map<string, { capacity: number; occupied: number }>();
  if (!ids.length) return out;

  const rooms = (await db(ROOM).whereIn('id', ids).where({ is_deleted: false }).select('id', 'bed_count')) as any[];
  const beds = (await db(BED).whereIn('dorm_id', ids).where({ is_deleted: false }).select('dorm_id', 'bed_status')) as any[];

  const bedTotal = new Map<string, number>();
  const bedUsed = new Map<string, number>();
  for (const b of beds) {
    const k = str(b.dorm_id);
    bedTotal.set(k, (bedTotal.get(k) ?? 0) + 1);
    if (Number(b.bed_status) === 2) bedUsed.set(k, (bedUsed.get(k) ?? 0) + 1);
  }

  // 已住优先数学生主档的 dorm_id（宿舍域同口径），没有学生指向时才退回床位表
  const staying = (await db(STUDENT)
    .whereIn('dorm_id', ids)
    .where({ is_deleted: false })
    .whereIn('student_status', IN_SCHOOL_STATUS)
    .select('dorm_id')) as any[];
  const stayCount = new Map<string, number>();
  for (const s of staying) {
    const k = str(s.dorm_id);
    if (k) stayCount.set(k, (stayCount.get(k) ?? 0) + 1);
  }

  for (const r of rooms) {
    const id = str(r.id);
    const total = bedTotal.get(id) || int(r.bed_count);
    const used = stayCount.get(id) ?? bedUsed.get(id) ?? 0;
    out.set(id, { capacity: total, occupied: used });
  }
  return out;
}

export async function listAllocateRooms(
  category: number,
  building?: string,
  user?: any,
): Promise<AllocateRoomRow[]> {
  const qb = db(ROOM).where({ is_deleted: false }).whereIn('dorm_gender', [category, 0]);
  const b = str(building).trim();
  if (b) qb.andWhere('building', b);
  /* ★ 2026-10-23：班主任限定 → 只出「本班分派/入住」的房间 */
  const scope = await scopedAllocateRoomIds(user);
  if (scope !== null) {
    if (!scope.length) return [];
    qb.whereIn('id', scope);
  }
  const rooms = (await qb.orderBy(['building', 'room_no'])) as any[];
  if (!rooms.length) return [];

  const ids = rooms.map((r) => str(r.id));
  const stats = await roomBedStats(ids);

  const assigned = (await db(ASSIGN)
    .whereIn('room_id', ids)
    .where({ is_deleted: false })
    .select('room_id', 'class_name')) as any[];
  const assignMap = new Map(assigned.map((a) => [str(a.room_id), str(a.class_name)]));

  /**
   * ★ 2026-10-22：归属班的「状态」决定房间是否锁定
   *   开放 → 锁定（别的班不能再分这间）；
   *   封班 → 解锁（空床位交回教务，可继续调配）。
   */
  const statusMap = await loadClassStatuses([...assignMap.values()]);

  /**
   * ★ 空闲床位明细（调宿弹窗要选到「几号床」）
   *   bed_status: 1 空闲 / 2 已住 / 3 停用 —— 只把 1 的列出来。
   */
  const freeBeds = (await db(BED)
    .whereIn('dorm_id', ids)
    .where({ is_deleted: false })
    .select('id', 'dorm_id', 'bed_no', 'bed_status')) as any[];
  const freeMap = new Map<string, AllocateBedRef[]>();
  for (const b of freeBeds) {
    if (Number(b.bed_status) !== 1) continue;
    const k = str(b.dorm_id);
    if (!freeMap.has(k)) freeMap.set(k, []);
    freeMap.get(k)!.push({
      bedId: str(b.id),
      bedNo: str(b.bed_no),
      bedLabel: bedNoText(b.bed_no),
    });
  }
  for (const list of freeMap.values()) {
    list.sort((a, b) => Number(a.bedNo) - Number(b.bedNo));
  }

  return rooms.map((r) => {
    const id = str(r.id);
    const st = stats.get(id) || { capacity: int(r.bed_count), occupied: 0 };
    const remaining = Math.max(st.capacity - st.occupied, 0);
    const assignedTo = assignMap.get(id) || null;
    const assignedStatus = assignedTo ? (statusMap.get(assignedTo) ?? null) : null;
    // 未分派 → 不锁；已分派且封班 → 解锁；其余（开放/查不到）→ 锁定
    const locked = !!assignedTo && isLockedByClassStatus(assignedStatus);
    return {
      roomId: id,
      building: str(r.building),
      room: str(r.room_no),
      category: int(r.dorm_gender) || category,
      capacity: st.capacity,
      occupied: st.occupied,
      remaining,
      full: remaining <= 0,
      assignedTo,
      assignedStatus,
      assignedStatusName: assignedStatus ? CLASS_STATUS_NAME[assignedStatus] || null : null,
      locked,
      /**
       * ★ 空床位照常下发，是否可选由调用方按 `locked` + 学生班级判断：
       *   · 本班自己的房间 → 可以调进来（班主任换床）；
       *   · 别的开放班 → 前端禁选、后端 changeCreate/assign 也会拒绝；
       *   · 封班 → 空床交回教务，可选。
       *   （早期版本直接清空 freeBeds，导致班主任在自己班里反而选不到床）
       */
      freeBeds: freeMap.get(id) || [],
    };
  });
}

/* ============================================================
 * 学生搜索（调宿 / 退宿弹窗用）
 * ============================================================ */

export interface AllocateStudentRow {
  studentId: string;
  studentNo: string;
  studentName: string;
  gender: number;
  genderName: string;
  classId: string | null;
  className: string | null;
  headTeacherName: string | null;
  /** 当前宿舍（未入住为空） */
  dormId: string | null;
  dormNo: string | null;
  building: string | null;
  room: string | null;
  bedId: string | null;
  bedNo: string | null;
  bedLabel: string | null;
}

/** 学生表来源（与班级列表同口径，逐张查再按学号去重） */
const STUDENT_SOURCES = [
  // ★ 2026-10-23：三学段学生档案已统一到 t_uni_student（新建学生只写这里），
  //   老表已 DROP；不补这源的话「调宿/退宿弹窗」搜不到新建的学生。
  'sms_common.t_uni_student',
  EDU_STUDENT,
  PERM_STUDENT,
];

export async function searchStudents(opts: {
  className?: string;
  keyword?: string;
  limit?: number;
}): Promise<AllocateStudentRow[]> {
  const className = str(opts.className).trim();
  const kw = str(opts.keyword).trim();
  const limit = Math.min(Math.max(int(opts.limit) || 50, 1), 100);

  const rows: any[] = [];
  for (const table of STUDENT_SOURCES) {
    try {
      const qb = db(table)
        .where({ is_deleted: false })
        .whereNotNull('student_name')
        .whereNot('student_name', '');
      if (className) qb.andWhere('class_name', className);
      if (kw) {
        // 前后模糊：姓名 / 学号 任一包含关键字
        qb.andWhere((b: any) => {
          b.where('student_name', 'like', `%${kw}%`).orWhere('student_no', 'like', `%${kw}%`);
        });
      }
      const list = (await qb
        .select(
          'id',
          'student_no',
          'student_name',
          'gender',
          'class_id',
          'class_name',
          'head_teacher_name',
          'dorm_id',
          'dorm_no',
        )
        .limit(limit)) as any[];
      rows.push(...list);
    } catch {
      /* 表不存在 → 跳过 */
    }
  }

  // 按学号去重：优先保留有宿舍位置的记录（同一学生在多张表里是投影）
  const byNo = new Map<string, any>();
  for (const r of rows) {
    const no = str(r.student_no).trim();
    const key = no || `id:${str(r.id)}`;
    const cur = byNo.get(key);
    if (!cur || (!str(cur.dorm_id) && str(r.dorm_id))) byNo.set(key, r);
  }
  const picked = [...byNo.values()].slice(0, limit);

  // 批量补宿舍位置：dorm_id → t_job_dorm
  const ids = picked.map((r) => str(r.id)).filter(Boolean);
  const noList = [...new Set(picked.map((r) => str(r.student_no)).filter(Boolean))];
  const nameList = [...new Set(picked.map((r) => str(r.student_name)).filter(Boolean))];

  /**
   * ★ 当前床位（2026-10-20 第 2 次加强）
   *
   * 学生表里只有 dorm_id/dorm_no，部分表连 bed_no 列都没有；而「谁住哪张床」
   * 的权威记录在床位表（bed_status=2 已住）。不同来源的学生 id 空间还可能不一致
   * （门户 PSB-xxx / 老表 UUID），所以按 **id → 学号 → 姓名** 三级兜底匹配。
   *
   * 只要命中床位，就同时带出「床位号」和「床位所属房间」——
   * 有些环境学生主档 dorm_id 是空的，但床位表里其实已经入住了。
   */
  let bedRows: any[] = [];
  if (ids.length || noList.length || nameList.length) {
    bedRows = (await db(BED)
      .where({ is_deleted: false })
      .andWhere('bed_status', 2)
      .andWhere((b: any) => {
        if (ids.length) b.whereIn('student_id', ids);
        if (noList.length) b.orWhereIn('student_no', noList);
        if (nameList.length) b.orWhereIn('student_name', nameList);
      })
      .select('id', 'student_id', 'student_no', 'student_name', 'dorm_id', 'bed_no')) as any[];
  }
  const bedById = new Map<string, any>();
  const bedByNo = new Map<string, any>();
  const bedByName = new Map<string, any>();
  for (const b of bedRows) {
    if (str(b.student_id)) bedById.set(str(b.student_id), b);
    if (str(b.student_no)) bedByNo.set(str(b.student_no), b);
    if (str(b.student_name)) bedByName.set(str(b.student_name), b);
  }
  const bedOf = (r: any) =>
    bedById.get(str(r.id)) || bedByNo.get(str(r.student_no)) || bedByName.get(str(r.student_name)) || null;

  const dormIds = [
    ...new Set([
      ...picked.map((r) => str(r.dorm_id)),
      ...picked.map((r) => str(bedOf(r)?.dorm_id)),
    ]),
  ].filter(Boolean);
  const dormRows = dormIds.length
    ? ((await db(ROOM).whereIn('id', dormIds).where({ is_deleted: false }).select('id', 'building', 'room_no')) as any[])
    : [];
  const dormMap = new Map(dormRows.map((d) => [str(d.id), d]));

  return picked
    .map((r) => {
      const g = int(r.gender);
      const bed = bedOf(r);
      // 学生主档没有 dorm_id 时，用床位表里那条已住记录的 dorm_id
      const dormId = str(r.dorm_id) || str(bed?.dorm_id) || null;
      const d = dormId ? dormMap.get(dormId) : null;
      // 兜底：dorm_no 形如「1号楼-303」
      const dormNo = str(r.dorm_no) || null;
      let building = d ? str(d.building) : null;
      let room = d ? str(d.room_no) : null;
      if ((!building || !room) && dormNo && dormNo.includes('-')) {
        const [b, ...rest] = dormNo.split('-');
        building = building || b;
        room = room || rest.join('-');
      }
      const bedNo = str(bed?.bed_no) || null;
      return {
        studentId: str(r.id),
        studentNo: str(r.student_no),
        studentName: str(r.student_name),
        gender: g,
        genderName: g === 1 ? '男' : g === 2 ? '女' : '未知',
        classId: str(r.class_id) || null,
        className: str(r.class_name) || null,
        headTeacherName: str(r.head_teacher_name) || null,
        dormId,
        dormNo,
        building,
        room,
        bedId: str(bed?.id) || null,
        bedNo,
        bedLabel: bedNo === null ? null : bedNoText(bedNo),
      } satisfies AllocateStudentRow;
    })
    .sort((a, b) => (a.className || '').localeCompare(b.className || '', 'zh-Hans-CN') || a.studentName.localeCompare(b.studentName, 'zh-Hans-CN'));
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

  // 类别校验：左栏只能选男寝、右栏只能选女寝（dorm_gender=0 不限，两边都可以）
  const badSide = (ids: string[], category: number, label: string) => {
    for (const id of ids) {
      const g = int(roomMap.get(id)?.dorm_gender);
      if (g !== 0 && g !== category) {
        throw new BizError(
          BizCode.PARAM_ERROR,
          `宿舍 ${str(roomMap.get(id)?.room_no)} 不是${label}，不能分到${label === '男寝' ? '男生' : '女生'}栏`,
        );
      }
    }
  };
  badSide(maleIds, 1, '男寝');
  badSide(femaleIds, 2, '女寝');

  /**
   * ★ 没有学生的新班级：不走「按人数选够」，改按床位上限 100。
   *
   * 床位口径与前端一致 = 所选房间的**剩余床位**之和（住满的房间前端不可选）。
   */
  const counts = await classStudentCounts(className);
  if (counts.total === 0) {
    const usedStats = await roomBedStats(allIds);
    const beds = allIds.reduce((s, id) => {
      const st = usedStats.get(id);
      return s + Math.max((st?.capacity ?? 0) - (st?.occupied ?? 0), 0);
    }, 0);
    if (beds > EMPTY_CLASS_MAX_BEDS) {
      throw new BizError(
        BizCode.PARAM_ERROR,
        `该班暂无学生，分派床位数不能超过 ${EMPTY_CLASS_MAX_BEDS} 个（当前 ${beds} 个）`,
      );
    }
  }

  /**
   * 一间宿舍同一时间只能归一个班。
   *
   * ★ 2026-10-22 收紧：只有**封班**的班才允许被接管；
   *   分派给「开放」班的房间是锁定的，不能分给别的班
   *   （封班的空床位才交回教务，可以继续调配）。
   */
  const conflicts = allIds.length
    ? ((await db(ASSIGN)
        .whereIn('room_id', allIds)
        .where({ is_deleted: false })
        .whereNot('class_name', className)
        .select('room_id', 'class_name')) as any[])
    : [];

  if (conflicts.length) {
    const conflictStatus = await loadClassStatuses(conflicts.map((c) => str(c.class_name)));
    const blocked = conflicts.find((c) =>
      isLockedByClassStatus(conflictStatus.get(str(c.class_name))),
    );
    if (blocked) {
      const room = roomMap.get(str(blocked.room_id));
      throw new BizError(
        BizCode.PARAM_ERROR,
        `宿舍 ${str(room?.building)} ${str(room?.room_no)} 已分派给开放中的 ${str(blocked.class_name)} 班，不能再分给其他班；该班封班后空床位才可继续调配`,
      );
    }
  }

  const existing = (await db(ASSIGN)
    .where({ class_name: className, is_deleted: false })
    .select('id', 'room_id')) as any[];

  const headTeacherName = str(body.headTeacherName).trim() || null;
  const now = new Date();
  const userId = body.userId || 'system';
  /** 房间 → 该行记哪个类别（男/女栏由调用方决定，dorm_gender=0 时按栏位记） */
  const categoryOf = new Map<string, number>();
  for (const id of maleIds) categoryOf.set(id, 1);
  for (const id of femaleIds) categoryOf.set(id, 2);

  await db.transaction(async (trx) => {
    // ① 先整班清空（覆盖式语义：勾选结果 = 该班最终分到的宿舍）
    if (existing.length) {
      await trx(ASSIGN)
        .where({ class_name: className, is_deleted: false })
        .update({ is_deleted: true, update_time: now, update_by: userId });
    }

    // ② 接管：把其它班在这几间上的分派行软删
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
    //   所以不能按 (room_id, class_name) 找软删行，必须**按 room_id 单列**找：
    //   找到就复活并改 class_name（接管），找不到才 insert。
    for (const roomId of allIds) {
      const r = roomMap.get(roomId)!;
      const revive = await trx(ASSIGN)
        .where({ room_id: roomId })
        .update({
          class_name: className,
          head_teacher_name: headTeacherName,
          building: str(r.building),
          room: str(r.room_no),
          category: categoryOf.get(roomId) ?? int(r.dorm_gender) ?? 1,
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
          room: str(r.room_no),
          category: categoryOf.get(roomId) ?? int(r.dorm_gender) ?? 1,
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

  void conflicts;

  return { male: maleIds.length, female: femaleIds.length };
}
