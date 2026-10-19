/**
 * 宿舍仓储 · 三学段统一版（第 4 期 · 第 1 批）
 * ============================================================
 *
 * 【★★ 斌哥 2026-10-10 拍板：初高 / 大学 / 实训 全部采用实训那套模型】
 *   原文：「初高中、大学、实训都在一个界面，那就都采用实训那套就行」
 *   语义：三学段共用一套「房间 / 床位 / 换宿单」模型，数据统一落 `sms_common`
 *        的 `t_uni_dorm_room` / `t_uni_dorm_bed` / `t_uni_dorm_change`，
 *        靠 `edu_stage` 区分学段。由 `makeRepo(stage)` 生成三份实例。
 *   → 原先 repo.classJh.ts（初高 varchar 状态）、repo.class.ts（大学只读同步表）
 *      两份实现已下线，不再维护。
 *   → 「大学是教务同步的只读数据」这个设定**作废**：
 *     `t_class_dorm_room_sync` / `t_class_dorm_live_sync` 两张同步表实测均为 **0 行**，
 *     大学宿舍页面本来就是空的。现在三个学段一样，数据我们自己录入，教务要读就读。
 *
 * 【★ 为什么「实训那套」是标准答案】
 *   · 房间状态原生 int（dorm_status 1正常/2停用）→ 不用做 varchar 翻译
 *   · 床位表自带学生快照（student_no/student_name/gender）→ 不用 join 在住表
 *   · `dorm_gender` 有 0 不限（另两学段没有）→ 统一 DTO 用这套口径
 *
 * 【★ 状态映射：统一 dorm_status → 前端房间状态】
 *   1 正常 → UnifiedDormStatus.IN_USE(1)
 *   2 停用 → UnifiedDormStatus.DISABLED(4)   ★ 不是 2！
 *   （统一码的 2 是「空置」，本模型没有「空置房间」概念 —— 房间要么有人住要么有空床）
 *
 * 【★ 已住人数不信 used_count】
 *   used_count 是冗余列 → 实时数 t_uni_dorm_bed 里 bed_status=2 的条数。
 *
 * 【★ 所有表访问一律走 tbl()，不再出现裸 db(TABLE)】
 *   开关关 → tbl() 落回 sms_job 老表
 *   开关开 → 落 sms_common 的 t_uni_dorm_*，自动注入 edu_stage 过滤
 */

import { randomUUID } from 'crypto';
import { db } from '../../utils/db';
import {
  DORM_BED_STATUS_NAME,
  DORM_GENDER_NAME,
  DORM_STATUS_NAME,
  TEACHING_STAGE_NAME,
  UnifiedDormStatus,
} from '../shared/dto';
import type {
  DormAssignBody,
  DormBedRow,
  DormChangeCreateBody,
  DormChangeRow,
  DormListQuery,
  DormResidentRow,
  DormRow,
  DormSaveBody,
  DormStageMeta,
  DormSummary,
  TeachingStage,
} from '../shared/dto';
import { fmtDate, fmtDateTime } from '../shared/format';
import type { DormRepo } from './types';
import { bedNoText } from 'shared-types/class';
import { hasRole, RoleCode, StudentStatus } from 'shared-types';
import { tbl, tblIns, upd } from '../shared/uniTable';

const DORM_T = 't_job_dorm';
const BED_T = 't_job_dorm_bed';
const CHANGE_T = 't_job_dorm_change';
/** ★ 实训的学生主档是 `t_student_base`（**不是** t_job_student —— 那张表不存在） */
const STUDENT_T = 't_student_base';
const CLASS_T = 't_job_class';

/**
 * ★ 三学段共用同一套「老表名」，库名统一写 sms_job。
 *   切读打开时，表名由 UNI_MAP 换成统一表，库名只用于查映射表 → 三学段都落同一张。
 */
const SRC_DB = 'sms_job';



/** ★ 实训 dorm_status → 统一房间状态（必须写死，不能正向反推） */
const JOB_ROOM_STATUS: Record<number, number> = {
  1: UnifiedDormStatus.IN_USE,
  2: UnifiedDormStatus.DISABLED,
};

/**
 * ★ 可以住宿舍的学生状态（`t_student_base.student_status` 列名不是 `status`！）
 *   3 试学中 / 5 正式在读 / 8 实训中
 *   休学(6)/退学(7)/流失(11) 不该占着床位。
 */
const IN_SCHOOL_STATUS: number[] = [
  StudentStatus.TRIAL,
  StudentStatus.STUDYING,
  StudentStatus.TRAINING,
];

function str(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  return String(v);
}
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function rate(occupied: number, total: number): number {
  if (!total || total <= 0) return 0;
  return Math.round((occupied / total) * 1000) / 10;
}

/** 三学段共用一份实现，只有 edu_stage 不同 */
export function makeRepo(stage: TeachingStage): DormRepo {

    /* ==========================================================
     * 表路由助手（三学段共用同一套「老表名」，由 UNI_MAP 决定落哪张统一表）
     *
     * 【为什么老表名统一用 sms_job 那套】
     *   初高/大学的老表（t_class_room / t_class_dorm_room_sync）在 UNI_MAP 里
     *   也映射到同一张统一表，切读打开后行为完全一致；
     *   开关关闭时统一表这套名字落到 sms_job 老表 —— 此时只有实训段的
     *   老数据能对上，初高/大学的数据需要种子脚本重灌（数据本来就是演示数据）。
     * ========================================================== */
    const T_DORM = () => tbl(db, SRC_DB, DORM_T, stage);
    const T_BED = () => tbl(db, SRC_DB, BED_T, stage);
    const T_CHANGE = () => tbl(db, SRC_DB, CHANGE_T, stage);
  
  const meta = (stage: TeachingStage): DormStageMeta => ({
    stage,
    stageName: TEACHING_STAGE_NAME[stage],
    hasCreate: true,
    hasFloor: false,
    // ★ 实训表没有负责人/宿舍长字段（宿舍长在 sync 表概念里，不在这张表）
    hasOwner: false,
    hasClass: false,
    hasRemark: true,
    hasBedTable: true,
    // ★ 原生就是 int
    roomStatusIsInt: true,
  });
  
  /**
   * ★ 数据范围：沿用实训原有的角色判定口径
   *   校长 / 学管（学管主任·教质经理）/ 教务老师 / 系统管理员 → 全量
   *   班主任 / 教员 / 助教 → 只看自己班的学生所住的宿舍
   *
   * ⚠️ RoleCode 是**字符串枚举**（不是数字），别按数字写。
   *   实训没有「宿舍管理员」这个角色，教务老师（ACAD_STAFF）就是宿舍口的管理者。
   *
   * ⚠️⚠️ 2026-10-12 修 bug：班主任进宿舍页恒为「0 间 / 暂无数据」，三处原因：
   *   ①【ID 空间错配】门户 token 里的 `userId` 是**门户账号 id（UUID）**，
   *     而班级表 `head_teacher_id` 存的是**权限库用户 id**（U004…）——直接比永远比不中。
   *     现在优先用 `user.businessUserId`（鉴权中间件从 /api/perm/remote/account-profile 取回）。
   *   ②【数据来源错了】原来靠床位表 `bed_status=2 且 student_id=我班学生` 反查房间，
   *     但统一床位表的 `student_id` 全为 NULL（实测 184 行无一填了学生）→ 恒空。
   *     「谁住哪」的权威来源是学生主档的 `dorm_id`（直接就是房间主键）。
   *   ③【学管漏了】学管主任（TEACH_DEAN，运行时码是 TEACH_QTY）没被算成全量角色。
   */
  async function scopedDormIds(user: any): Promise<string[] | null> {
    const roles: string[] = user?.roles ?? [];
    if (hasRole(roles, RoleCode.RM_PRINCIPAL)) return null;
    if (hasRole(roles, RoleCode.ACAD_STAFF)) return null;
    // ★ 学管主任 / 教质经理（别名感知，运行时给的是 TEACH_QTY）
    if (hasRole(roles, RoleCode.TEACH_DEAN)) return null;
    if (hasRole(roles, RoleCode.SYS_ADMIN)) return null;

    // ★ 业务用户 id（U004…）优先；老 token 没这个字段时回退到门户 userId
    const uid = String(user?.businessUserId || user?.userId || user?.id || '');
    if (!uid) return [];

    // 班主任 / 教员 / 助教：班主任、任课老师、助理任一命中都算「我的班」
    const classes = await tbl(db, SRC_DB, CLASS_T, stage)
      .where({ is_deleted: false })
      .andWhere((b: any) => {
        b.where('head_teacher_id', uid).orWhere('teacher_id', uid).orWhere('assistant_id', uid);
      })
      .select('id');
    const classIds = classes.map((c: any) => String(c.id));
    if (!classIds.length) return [];

    // ★ 直接问学生主档「你住哪间房」，不再经床位表中转
    const staying = await tbl(db, SRC_DB, STUDENT_T, stage)
      .whereIn('class_id', classIds)
      .where({ is_deleted: false })
      .whereIn('student_status', IN_SCHOOL_STATUS)
      .whereNotNull('dorm_id')
      .andWhere('dorm_id', '<>', '')
      .distinct('dorm_id');
    return staying.map((s: any) => String(s.dorm_id));
  }
  
  /** 房间列表 + 实时已住（数 t_job_dorm_bed 里 bed_status=2 的条数） */
  async function roomRows(q: DormListQuery, user: any): Promise<DormRow[]> {
    const qb = T_DORM().where({ is_deleted: false });
  
    const scope = await scopedDormIds(user);
    if (scope !== null) {
      if (!scope.length) return [];
      qb.whereIn('id', scope);
    }
  
    if (q.building) qb.andWhere('building', q.building);
    if (q.dormType !== undefined && q.dormType !== null) qb.andWhere('dorm_gender', q.dormType);
    if (q.roomStatus !== undefined && q.roomStatus !== null) {
      // ★ 反向：统一码 → 实训原码
      const jobCode = Object.keys(JOB_ROOM_STATUS).find(
        (k) => JOB_ROOM_STATUS[Number(k)] === q.roomStatus,
      );
      // 「空置(2)」实训没有 → 不加条件（别把整表筛空）
      if (jobCode) qb.andWhere('dorm_status', Number(jobCode));
    }
    if (q.keyword) {
      const kw = `%${q.keyword}%`;
      qb.andWhere((b: any) => {
        b.where('room_no', 'like', kw)
          .orWhere('building', 'like', kw)
          .orWhere('dorm_no', 'like', kw)
          .orWhere('facility', 'like', kw);
      });
    }
  
    const rooms = await qb.select('*');
    if (!rooms.length) return [];
  
    const ids = rooms.map((r: any) => String(r.id));
    const beds = await T_BED().whereIn('dorm_id', ids).where({ is_deleted: false });
    const cntByDorm = new Map<string, number>();
    const bedTotal = new Map<string, number>();
    for (const b of beds) {
      const k = String(b.dorm_id);
      bedTotal.set(k, (bedTotal.get(k) ?? 0) + 1);
      if (Number(b.bed_status) === 2) cntByDorm.set(k, (cntByDorm.get(k) ?? 0) + 1);
    }

    /**
     * ★ 2026-10-12：已住人数以【学生主档的 dorm_id】为准
     *
     * 原来的口径只数床位表里 `bed_status=2` 的条数，但实测三学段 184 张床位
     * 的 bed_status **全部是 '1'（空闲）**，于是「已住」永远是 0 —— 明明有 18 个
     * 学生在住。学生主档的 `dorm_id` 才是「谁住哪」的权威来源（和入住/退宿
     * 流程写的是同一列）。床位表数字只作为兜底（房间没有任何学生指向它时）。
     */
    const staying = await tbl(db, SRC_DB, STUDENT_T, stage)
      .whereIn('dorm_id', ids)
      .where({ is_deleted: false })
      .whereIn('student_status', IN_SCHOOL_STATUS)
      .select('dorm_id');
    const occByDorm = new Map<string, number>();
    for (const s of staying) {
      const k = String((s as any).dorm_id ?? '');
      if (k) occByDorm.set(k, (occByDorm.get(k) ?? 0) + 1);
    }

    let rows = rooms.map((r: any) => {
      const total = bedTotal.get(String(r.id)) || Number(r.bed_count ?? 0);
      const occupied = occByDorm.get(String(r.id)) ?? cntByDorm.get(String(r.id)) ?? 0;
      const st = JOB_ROOM_STATUS[Number(r.dorm_status ?? 1)] ?? UnifiedDormStatus.IN_USE;
      const dt = numOrNull(r.dorm_gender) ?? 0;
      return {
        stage,
        stageName: TEACHING_STAGE_NAME[stage],
        dormId: String(r.id),
        buildingName: String(r.building ?? ''),
        roomNo: String(r.room_no ?? ''),
        floorNo: null,
        dormType: dt,
        dormTypeName: DORM_GENDER_NAME[dt] ?? '不限',
        bedCount: total,
        occupiedCount: occupied,
        occupancyRate: rate(occupied, total),
        roomStatus: st,
        roomStatusName: DORM_STATUS_NAME[st] ?? '使用中',
        ownerName: null,
        className: null,
        remark: str(r.remark),
      } satisfies DormRow;
    });
  
    if (q.onlyVacant) rows = rows.filter((r: DormRow) => r.occupiedCount < r.bedCount);
    return rows;
  }
  
  const repo: DormRepo = {
    stage,
    meta: () => meta(stage),
  
    async list(q, user) {
      return roomRows(q, user);
    },
  
    async detail(id, user) {
      const rows = await roomRows({ ...({ page: 1, size: 9999 } as any), stage }, user);
      return rows.find((r) => r.dormId === String(id)) ?? null;
    },
  
    async save(body: DormSaveBody, userId: string) {
      const id = body.id ? String(body.id) : randomUUID();
      // ★ 反向：统一码 → 实训 dorm_status
      const jobStatus =
        Object.keys(JOB_ROOM_STATUS).find(
          (k) => JOB_ROOM_STATUS[Number(k)] === (body.roomStatus ?? UnifiedDormStatus.IN_USE),
        ) ?? '1';
  
      const payload: Record<string, any> = {
        building: body.buildingName,
        room_no: body.roomNo,
        bed_count: body.bedCount ?? 4,
        dorm_gender: body.dormType ?? 0,
        dorm_status: Number(jobStatus),
        remark: body.remark ?? null,
        update_time: new Date(),
        update_by: userId,
      };
  
      if (body.id) {
        await T_DORM().where({ id: String(body.id), is_deleted: false }).update(payload);
        // 床位数变化时补齐/裁剪床位行（床位是独立表，房间表只存总数）
        await syncBeds(String(body.id), body.bedCount ?? 4, userId);
        return { id: String(body.id) };
      }
  
      // dorm_no 全局唯一（uk_dorm_no）：格式 楼栋-房号，如 `A栋-301`
      const dormNo = `${body.buildingName}-${body.roomNo}`;
      /**
       * ★★ 唯一性检查必须**把软删记录算进去**。
       *   `uk_dorm_no` 是数据库唯一索引，软删的记录行还在表里，索引还占着。
       *   如果这里只查 `is_deleted: 0`，会「查着不重复，插入却报
       *   ER_DUP_ENTRY / 50002 数据已存在」—— 用户看到的现象是
       *   「这个房间明明删了，却再也建不出来」，而且越删越死。
       *   → 所以这里**不带 is_deleted 条件**，让冲突提前在这里报友好提示。
       */
      const dup = await T_DORM().where({ dorm_no: dormNo }).first();
      if (dup) {
        if (Number(dup.is_deleted) === 1) {
          throw new Error(`宿舍编号 ${dormNo} 之前已删除过（记录仍在库中占唯一键），不能重复使用`);
        }
        throw new Error(`宿舍编号 ${dormNo} 已存在`);
      }
  
      payload.id = id;
      payload.dorm_no = dormNo;
      payload.used_count = 0;
      payload.create_time = new Date();
      payload.create_by = userId;
      payload.is_deleted = false;
      // ★ 必须用 tblIns：切读开启时它会补 edu_stage（统一表该列 NOT NULL 且无默认值）
      await tblIns(db, SRC_DB, DORM_T, stage, payload);
  
      // 新建即生成床位行（否则前端画不出格子）
      await syncBeds(id, body.bedCount ?? 4, userId);
      return { id };
    },
  
    async remove(id, userId) {
      const beds = await T_BED().where({ dorm_id: String(id), is_deleted: false });
      if (beds.some((b: any) => Number(b.bed_status) === 2)) {
        throw new Error('该宿舍还有学生入住，不能删除；请先办理退宿');
      }
      await T_DORM().where({ id: String(id) }).update({
        is_deleted: true,
        update_time: new Date(),
        update_by: userId,
      });
      await T_BED().where({ dorm_id: String(id) }).update({ is_deleted: true });
    },
  
    async beds(dormId) {
      const list = await T_BED()
        .where({ dorm_id: String(dormId), is_deleted: false })
        .orderBy('bed_no', 'asc');
      return list.map((b: any) => {
        const st = Number(b.bed_status ?? 1);
        return {
          bedId: String(b.id),
          bedNo: String(b.bed_no ?? ''),
          bedLabel: bedNoText(b.bed_no),
          bedStatus: st,
          bedStatusName: DORM_BED_STATUS_NAME[st] ?? '空闲',
          // ★ 床位表自带快照，不用 join
          studentId: str(b.student_id),
          studentNo: str(b.student_no),
          studentName: str(b.student_name),
          gender: numOrNull(b.student_gender),
          checkInDate: fmtDate(b.check_in_date),
          className: null,
        };
      });
    },
  
    async residents(q, user) {
      const rows = await roomRows({ ...q, page: 1, size: 9999 }, user);
      const byId = new Map(rows.map((r) => [r.dormId, r]));
      const beds = await T_BED().where({ is_deleted: false, bed_status: 2 });
      const out: DormResidentRow[] = [];
      for (const b of beds) {
        const room = byId.get(String(b.dorm_id));
        if (!room) continue;
        const g = numOrNull(b.student_gender) ?? 0;
        out.push({
          stage,
          studentId: String(b.student_id ?? ''),
          studentNo: String(b.student_no ?? ''),
          studentName: String(b.student_name ?? ''),
          gender: g,
          genderName: g === 1 ? '男' : g === 2 ? '女' : '未知',
          dormId: room.dormId,
          roomNo: room.roomNo,
          bedId: String(b.id),
          bedNo: String(b.bed_no ?? ''),
          bedLabel: bedNoText(b.bed_no),
          checkInDate: fmtDate(b.check_in_date),
          classId: null,
          className: null,
        });
      }
      return out;
    },
  
    async assign(body: DormAssignBody, userId: string) {
      const st = await tbl(db, SRC_DB, STUDENT_T, stage).where({ id: String(body.studentId), is_deleted: false }).first();
      if (!st) throw new Error('学生不存在');
      if (!IN_SCHOOL_STATUS.includes(numOrNull(st.student_status) ?? 0)) {
        throw new Error('该学生不是在读状态，不能办理入住');
      }
  
      const dorm = await T_DORM().where({ id: String(body.dormId), is_deleted: false }).first();
      if (!dorm) throw new Error('宿舍不存在');
      if (Number(dorm.dorm_status) === 2) throw new Error('该宿舍已停用，不能入住');
  
      const bed = await T_BED().where({ id: String(body.bedId), is_deleted: false }).first();
      if (!bed) throw new Error('床位不存在');
      if (Number(bed.bed_status) === 2) throw new Error('该床位已被占用');
      if (Number(bed.bed_status) === 3) throw new Error('该床位已停用，不能入住');
  
      // ★ 性别校验：dorm_gender 0=不限，另两学段没这个概念
      const dormGender = Number(dorm.dorm_gender ?? 0);
      const sGender = numOrNull(st.gender) ?? 0;
      if (dormGender !== 0 && sGender !== 0 && dormGender !== sGender) {
        throw new Error(
          `性别不匹配：该宿舍是${DORM_GENDER_NAME[dormGender]}，学生是${sGender === 1 ? '男生' : '女生'}`,
        );
      }
  
      const genderName = sGender === 1 ? '男' : sGender === 2 ? '女' : '未知';
  
      // ★ 先释放该学生可能已占的旧床位（换寝场景兜底）
      const oldBeds = await T_BED()
        .where({ student_id: String(body.studentId), is_deleted: false, bed_status: 2 });
      for (const ob of oldBeds) {
        await T_BED().where({ id: String(ob.id) }).update({
          bed_status: 1,
          student_id: null,
          student_no: null,
          student_name: null,
          student_gender: null,
          check_in_date: null,
        });
      }
  
      await T_BED().where({ id: String(body.bedId) }).update({
        bed_status: 2,
        student_id: String(body.studentId),
        student_no: str(st.student_no),
        student_name: str(st.student_name),
        student_gender: sGender,
        check_in_date: body.checkInDate || new Date().toISOString().slice(0, 10),
        update_time: new Date(),
        update_by: userId,
      });
  
      await refreshUsedCount(String(body.dormId));
      // 学生主档同步宿舍号（合并前的页面也是这么做的）
      await tbl(db, SRC_DB, STUDENT_T, stage).where({ id: String(body.studentId) }).update({
        dorm_id: dorm.id,
        dorm_no: dorm.dorm_no,
      });
      void genderName;
    },
  
    async checkout(dormId, bedId, userId) {
      const bed = await T_BED().where({ id: String(bedId), is_deleted: false }).first();
      if (!bed) throw new Error('床位不存在');
      if (Number(bed.bed_status) !== 2) throw new Error('该床位没有学生入住');
  
      const sid = bed.student_id;
      await T_BED().where({ id: String(bedId) }).update({
        bed_status: 1,
        student_id: null,
        student_no: null,
        student_name: null,
        student_gender: null,
        check_in_date: null,
        update_time: new Date(),
        update_by: userId,
      });
      if (sid) {
        await tbl(db, SRC_DB, STUDENT_T, stage).where({ id: String(sid) }).update({ dorm_id: null, dorm_no: null });
      }
      await refreshUsedCount(String(dormId));
    },
  
    async buildings(user) {
      const qb = T_DORM().where({ is_deleted: false });
      const scope = await scopedDormIds(user);
      if (scope !== null) {
        if (!scope.length) return [];
        qb.whereIn('id', scope);
      }
      const rows = await qb.distinct('building');
      return rows
        .map((r: any) => String(r.building ?? ''))
        .filter(Boolean)
        .map((b) => ({ value: b, label: b }));
    },
  
    async changeList(q, user) {
      const qb = T_CHANGE().where({ is_deleted: false });
      if (q.keyword) {
        const kw = `%${q.keyword}%`;
        qb.andWhere((b: any) => {
          b.where('student_name', 'like', kw)
            .orWhere('student_no', 'like', kw)
            .orWhere('old_dorm_no', 'like', kw)
            .orWhere('new_dorm_no', 'like', kw);
        });
      }
      const list = await qb.orderBy('create_time', 'desc');
      const uid = String(user?.userId ?? user?.id ?? '');
      const roles: string[] = user?.roles ?? [];
  
      return list.map((a: any) => {
        const st = Number(a.approval_status ?? 1);
        const isPending = st === 2 || st === 3;
        // 教务老师 / 校长 / 系统管理员可批；发起人只能撤回自己那条
        const canApprove =
          isPending &&
          (hasRole(roles, RoleCode.ACAD_STAFF) ||
            hasRole(roles, RoleCode.RM_PRINCIPAL) ||
            hasRole(roles, RoleCode.SYS_ADMIN));
        const canCancel =
          (st === 1 || st === 2 || st === 3) && String(a.create_by ?? '') === uid;
        return {
          stage,
          stageName: TEACHING_STAGE_NAME[stage],
          changeId: String(a.id),
          bizType: Number(a.biz_type ?? 1),
          bizTypeName: Number(a.biz_type) === 2 ? '退宿' : '调换宿舍',
          studentId: String(a.student_id ?? ''),
          studentNo: str(a.student_no),
          studentName: str(a.student_name),
          gender: numOrNull(a.gender),
          phone: str(a.phone),
          classId: str(a.class_id),
          className: str(a.class_name),
          headTeacherName: str(a.head_teacher_name),
          oldDormId: str(a.old_dorm_id),
          oldDormNo: str(a.old_dorm_no),
          oldBedNo: str(a.old_bed_no),
          newDormId: str(a.new_dorm_id),
          newDormNo: str(a.new_dorm_no),
          newBedNo: str(a.new_bed_no),
          changeDate: fmtDate(a.change_date) ?? '',
          changeReason: String(a.change_reason ?? ''),
          approvalStatus: st,
          approvalStatusName:
            st === 1 ? '待提交' : st === 2 ? '待审批' : st === 4 ? '已通过' : st === 5 ? '已驳回' : st === 6 ? '已撤销' : '未知',
          canApprove,
          canCancel,
          createTime: fmtDateTime(a.create_time),
        } satisfies DormChangeRow;
      });
    },
  
    async changeCreate(body: DormChangeCreateBody, userId: string) {
      const isCheckout = Number(body.bizType) === 2;
      if (!isCheckout && !body.newDormId) throw new Error('调换宿舍必须选择目标宿舍');
      if (!isCheckout && !body.newBedId) throw new Error('调换宿舍必须选择目标床位');
  
      const st = await tbl(db, SRC_DB, STUDENT_T, stage).where({ id: String(body.studentId), is_deleted: false }).first();
      if (!st) throw new Error('学生不存在');
  
      let oldDorm: any = null;
      let newDorm: any = null;
      if (body.oldDormId) oldDorm = await T_DORM().where({ id: String(body.oldDormId) }).first();
      if (body.newDormId) newDorm = await T_DORM().where({ id: String(body.newDormId) }).first();
  
      // 目标床位必须空闲（退宿不需要）
      if (!isCheckout && body.newBedId) {
        const bed = await T_BED().where({ id: String(body.newBedId), is_deleted: false }).first();
        if (!bed) throw new Error('目标床位不存在');
        if (Number(bed.bed_status) === 2) throw new Error('目标床位已被占用，请换一个');
        if (Number(bed.bed_status) === 3) throw new Error('目标床位已停用');
      }
  
      let className: string | null = null;
      if (st.class_id) {
        const c = await tbl(db, SRC_DB, CLASS_T, stage).where({ id: String(st.class_id) }).first();
        className = c ? str(c.class_name) : null;
      }
  
      const id = randomUUID();
      await tblIns(db, SRC_DB, CHANGE_T, stage, {
        id,
        create_time: new Date(),
        create_by: userId,
        is_deleted: false,
        biz_type: isCheckout ? 2 : 1,
        student_id: String(body.studentId),
        student_no: str(st.student_no),
        student_name: str(st.student_name),
        gender: numOrNull(st.gender),
        phone: str(st.phone),
        class_id: str(st.class_id),
        class_name: className,
        head_teacher_id: null,
        head_teacher_name: null,
        old_dorm_id: body.oldDormId ? String(body.oldDormId) : null,
        old_dorm_no: oldDorm ? str(oldDorm.dorm_no) : null,
        old_bed_id: body.oldBedId ? String(body.oldBedId) : null,
        old_bed_no: null,
        new_dorm_id: isCheckout ? null : body.newDormId ? String(body.newDormId) : null,
        new_dorm_no: isCheckout ? null : newDorm ? str(newDorm.dorm_no) : null,
        new_bed_id: isCheckout ? null : body.newBedId ? String(body.newBedId) : null,
        new_bed_no: null,
        change_date: body.changeDate,
        change_reason: body.changeReason,
        approval_status: 2, // 直接进「待审批」，避免还要再点一次提交
      });
      return { id };
    },
  
    async applyChangeOnApproved(changeId, userId) {
      const a = await T_CHANGE().where({ id: String(changeId), is_deleted: false }).first();
      if (!a) throw new Error('调宿单不存在');
  
      // ① 释放旧床位
      if (a.old_bed_id) {
        await T_BED().where({ id: String(a.old_bed_id) }).update({
          bed_status: 1,
          student_id: null,
          student_no: null,
          student_name: null,
          student_gender: null,
          check_in_date: null,
          update_time: new Date(),
          update_by: userId,
        });
      }
      // ② 占用新床位
      if (a.new_bed_id) {
        await T_BED().where({ id: String(a.new_bed_id) }).update({
          bed_status: 2,
          student_id: a.student_id,
          student_no: a.student_no,
          student_name: a.student_name,
          student_gender: a.gender,
          check_in_date: a.change_date,
          update_time: new Date(),
          update_by: userId,
        });
      }
      // ③ 学生主档同步
      await tbl(db, SRC_DB, STUDENT_T, stage).where({ id: String(a.student_id) }).update({
        dorm_id: a.new_dorm_id ?? null,
        dorm_no: a.new_dorm_no ?? null,
      });
      // ④ 两端 used_count 重算
      if (a.old_dorm_id) await refreshUsedCount(String(a.old_dorm_id));
      if (a.new_dorm_id) await refreshUsedCount(String(a.new_dorm_id));
    },
  
    async summary(q, user) {
      const rows = await roomRows({ ...q, page: 1, size: 9999 }, user);
      const bedCount = rows.reduce((s, r) => s + r.bedCount, 0);
      const occupied = rows.reduce((s, r) => s + r.occupiedCount, 0);
      return {
        stage,
        stageName: TEACHING_STAGE_NAME[stage],
        roomCount: rows.length,
        bedCount,
        occupiedCount: occupied,
        occupancyRate: rate(occupied, bedCount),
        vacantBeds: bedCount - occupied,
      } satisfies DormSummary;
    },
  };
  
  /** 实时重算 used_count（冗余列，但原表有这个列，别让它长期失真） */
  async function refreshUsedCount(dormId: string): Promise<void> {
    const beds = await T_BED().where({ dorm_id: dormId, is_deleted: false });
    const used = beds.filter((b: any) => Number(b.bed_status) === 2).length;
    await T_DORM().where({ id: dormId }).update({ used_count: used, update_time: new Date() });
  }
  
  /** 按 bed_count 补齐 / 裁剪床位行（床位是独立表，房间表只存总数） */
  async function syncBeds(dormId: string, target: number, userId: string): Promise<void> {
    const beds = await T_BED().where({ dorm_id: dormId, is_deleted: false });
    const used = beds.filter((b: any) => Number(b.bed_status) === 2).length;
  
    if (beds.length > target) {
      // 只裁剪空闲床，已住的不动（否则会踢人）
      const free = beds.filter((b: any) => Number(b.bed_status) !== 2);
      const surplus = beds.length - target;
      for (const b of free.slice(0, surplus)) {
        await T_BED().where({ id: String(b.id) }).update({ is_deleted: true });
      }
      return;
    }
    if (beds.length < target) {
      const dorm = await T_DORM().where({ id: dormId }).first();
      /**
       * ★★ 续号必须把**软删床位**也算进来（否则撞 uk_dorm_bed）
       *
       * 【原来为什么错】
       *   上面 `beds` 是 `is_deleted: false` 的活跃床位，`start` 取它们的最大 bed_no。
       *   但裁剪时删掉的是 `free.slice(0, surplus)`（**无 orderBy，顺序不保证**）——
       *   完全可能删掉编号最大的那几张。
       *   于是「4 张床 → 裁到 2 张（删了 3/4 床）→ 再扩到 4 张」时：
       *     active = [1,2] → start = 2 → 新增 bed_no 3、4
       *   → 与「已软删但仍在表里、且占着 uk_dorm_bed(room_id, bed_no, edu_stage)」的
       *     3/4 号床**撞唯一键**。老表 `t_job_dorm_bed` 无此唯一索引，一直掩盖着。
       *
       * 【改法】取号范围改用**全量**（含软删）床位的最大 bed_no。
       *   软删的号段从此不再复用 —— 与「唯一键永久占位」的语义保持一致。
       */
      const allBeds = (await T_BED().where({ dorm_id: dormId }).select('bed_no')) as Array<Record<string, any>>;
      const start = allBeds.reduce((mx: number, b: any) => Math.max(mx, Number(b.bed_no ?? 0)), 0);
      const rows = [];
      for (let i = start + 1; i <= target; i += 1) {
        rows.push({
          id: randomUUID(),
          create_time: new Date(),
          create_by: userId,
          is_deleted: false,
          dorm_id: dormId,
          dorm_no: dorm?.dorm_no ?? '',
          /**
           * ★★ `room_id` / `room_no` 是 **t_uni_dorm_bed 才有**的列，
           *   而 `uk_dorm_bed(room_id, bed_no, edu_stage)` 是带 room_id 的唯一索引。
           *   只写 dorm_id → 切读时 room_id 落空串 → 建第 2 个床位就
           *   `Duplicate entry '''-1-job' for key 'uk_dorm_bed'`（实测踩过）。
           *   → 切读时必须同时写 room_id（语义与 dorm_id 完全相同）。
           *   开关关闭时这两个字段老表没有，tblIns 会原样透传 →
           *   会报 Unknown column，所以由 tblIns 之后按开关剔除。
           */
          room_id: dormId,
          room_no: dorm?.room_no ?? dorm?.dorm_no ?? '',
          bed_no: String(i),
          bed_status: 1,
        });
      }
      // ★ 床位是批量插，逐条走 tblIns 才能补 edu_stage
      if (rows.length) {
        for (const r of rows) await tblIns(db, SRC_DB, BED_T, stage, r);
      }
    }
      void used;
    }

    return repo;
  }
