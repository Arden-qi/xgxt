/**
 * 学生档案仓储 · 就业（sms_job.t_student_base）
 * ============================================================
 *
 * 【为什么这个学段叫「就业」而不是「实训」】
 *   实训阶段的学生档案页在菜单里叫「就业管理 → 信息档案」，
 *   学生状态的可见范围也是**就业口径**（只显示走出咨询阶段的人）。
 *   学段 key 用 `job`（与门户模块名一致），显示名用「就业」。
 *
 * 【原实现保留的两处口径（不能动）】
 *   ① 只显示 4 种状态：待就业(9) / 已就业(10) / 休学(6) / 退学(7)
 *   ② 数据范围：校长 / 学管 / 管理员 → 全量；项目经理 → 自己带的实训班；
 *      班主任 → 学生主档上 head_teacher_id = 本人
 *
 * 【字段映射（与其它学段不同名的）】
 *   recruitTeacherName  → admission_teacher        （大学/初高叫 recruit_teacher_name）
 *   consultTeacherName  → consult_teacher          （大学/初高叫 consult_teacher_name）
 *   idCard              → id_card
 *   nativePlace         → native_place
 */

import { randomUUID } from 'crypto';
import { db } from '../../utils/db';
import {
  DEPT_NAME,
  GENDER_NAME,
  RoleCode,
  STUDENT_STATUS_NAME,
  StudentStatus,
  hasRole,
} from 'shared-types';
import type {
  StudentDetail,
  StudentListQuery,
  StudentRow,
  StudentSaveBody,
  StudentSaveResult,
} from '../shared/dto';
import { calcAge, fmtDate, fmtDateTime } from '../shared/format';
import type { PhaseOption, StudentRepo } from './types';
import { tbl, readPhaseCode, phaseCodeCol, tblIns } from '../shared/uniTable';

const T = 't_student_base';
const CLASS_TABLE = 't_job_class';
const STAGE = 'job' as const;

/**
 * 本学段（job）学生档案可见的学籍状态
 *
 * ★ 2026-10-15 补 `TRAINING`（实训中 = 8）：
 *   这个仓储合并前是**「就业档案」页面**（就业老师视角，只认待就业/已就业），
 *   合并成「学生档案」后它同时要服务**项目经理** ——
 *   而项目经理的业务定位是「**实训阶段的班主任**」（斌哥 2026-10-15 明确），
 *   他带的学员在实训期间状态就是 8（TRAINING）。
 *   原来 8 不在白名单 → 项目经理进得来页面却一条学生都看不到（实测 total=0）。
 */
const VISIBLE_STATUS: number[] = [
  StudentStatus.WAIT_EMPLOY,
  StudentStatus.EMPLOYED,
  StudentStatus.TRAINING,
  StudentStatus.SUSPENDED,
  StudentStatus.QUIT,
];

/** 实训的学习阶段（1~6 初高部 / 7~12 大学部 / 13 实训） */
const PHASE_NAME: Record<number, string> = {
  1: '预科阶段',
  2: '初中部一期',
  3: '初中部二期',
  4: '初中部三期',
  5: '高中部一期',
  6: '高中部二期',
  7: '第一阶段',
  8: '第二阶段',
  9: '第三阶段',
  10: '第四阶段',
  11: '第五阶段',
  12: '第六阶段',
  13: '实训',
};

function str(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  return String(v);
}
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function boolVal(v: unknown): boolean {
  return v === 1 || v === true || v === '1' || v === 'true';
}

/** 行 → 统一结构 */
function mapRow(r: Record<string, any>): StudentRow {
  const gender = Number(r.gender ?? 0);
  const status = Number(r.student_status ?? 0);
  const phase = readPhaseCode(r);
  const dormNo = str(r.dorm_no);
  return {
    stage: STAGE,
    stageName: '就业',
    studentId: String(r.id),
    studentNo: String(r.student_no ?? ''),
    studentName: String(r.student_name ?? ''),
    gender,
    genderName: GENDER_NAME[gender] ?? '',
    age: numOrNull(r.age) ?? calcAge(r.birth_date),
    deptCode: numOrNull(r.dept_code),
    deptName: DEPT_NAME[Number(r.dept_code)] ?? '',
    classId: str(r.class_id),
    className: str(r.class_name),
    phaseCode: phase,
    phaseName: phase === null ? '' : (PHASE_NAME[phase] ?? ''),
    headTeacherId: str(r.head_teacher_id),
    headTeacherName: str(r.head_teacher_name),
    teacherId: str(r.teacher_id),
    teacherName: str(r.teacher_name),
    assistantId: str(r.assistant_id),
    assistantName: str(r.assistant_name),
    studentStatus: status,
    studentStatusName: STUDENT_STATUS_NAME[status] ?? '',
    phone: str(r.phone),
    parentPhone: str(r.parent_phone),
    education: str(r.education),
    enrollDate: str(fmtDate(r.enroll_date)) || null,
    dormId: str(r.dorm_id),
    dormNo,
    // ⚠️ 就业库这张表没有 bed_no 列，床位号恒为空（不是漏映射）
    bedNo: null,
    bedLabel: dormNo,
    attendanceRate: numOrNull(r.attendance_rate),
    repeatCount: Number(r.repeat_count ?? 0),
    idCard: str(r.id_card),
    nativePlace: str(r.native_place),
    graduateSchool: str(r.graduate_school),
    homeAddress: str(r.home_address),
    recruitTeacherName: str(r.admission_teacher),
    recruitTeacherPhone: str(r.admission_teacher_phone),
    consultTeacherName: str(r.consult_teacher),
    consultTeacherPhone: str(r.consult_teacher_phone),
    remark: str(r.remark),
    createTime: fmtDateTime(r.create_time),
  };
}

/**
 * 数据范围（原实现原样搬过来）
 *
 * ⚠️ 项目经理**只按 class_id 过滤，不做 head_teacher_id 兜底** ——
 *    实训班的班主任字段与项目经理同人，用 head_teacher_id 兜底会等于「全放开」。
 */
async function applyScope(qb: any, user: any): Promise<void> {
  const roles = user?.roles || [];
  const uid = user?.userId || '';
  const isAdmin = hasRole(roles, RoleCode.SYS_ADMIN);
  const isDean = hasRole(roles, RoleCode.TEACH_DEAN);
  const isPrincipal = hasRole(roles, RoleCode.RM_PRINCIPAL);
  if (isAdmin || isDean || isPrincipal) return;

  if (hasRole(roles, RoleCode.PROJECT_MANAGER)) {
    const mine = (await tbl(db, 'sms_job', CLASS_TABLE, STAGE)
      .where({ project_manager_id: uid, is_deleted: false })
      .select('id')) as Array<{ id: string }>;
    const ids = mine.map((c) => c.id);
    if (!ids.length) qb.whereRaw('1 = 0');
    else qb.whereIn('class_id', ids);
    return;
  }
  if (hasRole(roles, RoleCode.TEACH_HEAD)) {
    qb.andWhere('head_teacher_id', uid);
  }
}

function buildBase(q: StudentListQuery, user: any) {
  const qb = tbl(db, 'sms_job', T, STAGE).where('is_deleted', false).whereIn('student_status', VISIBLE_STATUS);
  if (q.classId) qb.andWhere('class_id', q.classId);
  if (q.deptCode) qb.andWhere('dept_code', q.deptCode);
  if (q.studentStatus) qb.andWhere('student_status', q.studentStatus);
  if (q.phaseCode) qb.andWhere(phaseCodeCol(), q.phaseCode);
  if (q.keyword) {
    qb.andWhere((b: any) => {
      b.where('student_no', 'like', `%${q.keyword}%`)
        .orWhere('student_name', 'like', `%${q.keyword}%`)
        .orWhere('phone', 'like', `%${q.keyword}%`);
    });
  }
  if (q.unassigned) {
    qb.andWhere((b: any) => {
      b.whereNull('dorm_id').orWhere('dorm_no', '');
    });
  }
  return qb;
}

export const repo: StudentRepo = {
  stage: STAGE,
  sections: ['resume'],
  supportUnassigned: true,

  async list(q, user) {
    const qb = buildBase(q, user);
    await applyScope(qb, user);
    const rows = (await qb.orderBy('create_time', 'desc')) as Array<Record<string, any>>;
    return rows.map(mapRow);
  },

  async detail(id, user) {
    const r = (await tbl(db, 'sms_job', T, STAGE).where({ id, is_deleted: false }).first()) as
      | Record<string, any>
      | undefined;
    if (!r) return null;
    // 单条也要过范围（否则可以拿别人的 id 直查）
    const guard = tbl(db, 'sms_job', T, STAGE).where({ id, is_deleted: false });
    await applyScope(guard, user);
    const allowed = await guard.first();
    if (!allowed) return null;

    const base = mapRow(r);
    return {
      base,
      profile: {
        birthDate: str(fmtDate(r.birth_date)),
        nativePlace: str(r.native_place),
        idCard: str(r.id_card),
        graduateSchool: str(r.graduate_school),
        homeAddress: str(r.home_address),
        idPhotoUrl: null,
        householdPhotoUrl: null,
      },
      market: {
        recruitTeacherName: str(r.admission_teacher),
        recruitTeacherPhone: str(r.admission_teacher_phone),
        consultTeacherName: str(r.consult_teacher),
        consultTeacherPhone: str(r.consult_teacher_phone),
      },
      dorm: base.dormId || base.dormNo
        ? {
            dormId: base.dormId,
            dormNo: base.dormNo,
            bedNo: null,
            bedLabel: base.bedLabel,
            building: null,
          }
        : null,
      quality: null,
      net: null,
      resume: {
        resumeName: str(r.resume_name),
        resumeData: str(r.resume_data),
      },
      flows: [],
      repeats: [],
      extra: null,
    };
  },

  async save(body, userId) {
    const now = new Date();
    const payload: Record<string, any> = {
      student_name: body.studentName,
      gender: body.gender,
      update_time: now,
      update_by: userId,
    };
    const set = (k: string, v: unknown) => {
      if (v !== undefined) payload[k] = v;
    };
    set('birth_date', body.birthDate ?? undefined);
    if (body.birthDate !== undefined) payload.age = calcAge(body.birthDate);
    else if (body.age !== undefined) payload.age = body.age;
    set('native_place', body.nativePlace);
    set('dept_code', body.deptCode);
    set('class_id', body.classId);
    set('class_name', body.className);
    set(phaseCodeCol(), body.phaseCode);
    set('student_status', body.studentStatus);
    set('education', body.education);
    set('graduate_school', body.graduateSchool);
    set('enroll_date', body.enrollDate);
    set('phone', body.phone);
    set('parent_phone', body.parentPhone);
    set('home_address', body.homeAddress);
    set('id_card', body.idCard);
    set('admission_teacher', body.recruitTeacherName);
    set('admission_teacher_phone', body.recruitTeacherPhone);
    set('consult_teacher', body.consultTeacherName);
    set('consult_teacher_phone', body.consultTeacherPhone);
    set('dorm_id', body.dormId);
    set('dorm_no', body.dormNo);
    set('remark', body.remark);
    // 简历在 extra 里
    const extra = body.extra || {};
    if ('resumeName' in extra) payload.resume_name = extra.resumeName ?? null;
    if ('resumeData' in extra) payload.resume_data = extra.resumeData ?? null;

    if (body.id) {
      await tbl(db, 'sms_job', T, STAGE).where({ id: body.id }).update(payload);
      return { id: body.id };
    }

    const studentNo = String(body.studentNo || '').trim() || (await generateStudentNo());
    // 唯一性预检必须**不带 is_deleted 过滤**（唯一索引是物理的，逻辑删除的历史行仍占号）
    const dup = (await tbl(db, 'sms_job', T, STAGE).where({ student_no: studentNo }).first()) as
      | Record<string, any>
      | undefined;
    if (dup) {
      throw new Error(
        boolVal(dup.is_deleted)
          ? `学号 ${studentNo} 已被「已删除」的历史学生占用，不可复用，请更换`
          : `学号 ${studentNo} 已存在，请勿重复添加`,
      );
    }

    const id = randomUUID();
    await tblIns(db, 'sms_job', T, STAGE, {
      id,
      student_no: studentNo,
      ...payload,
      student_status: body.studentStatus ?? StudentStatus.WAIT_EMPLOY,
      repeat_count: 0,
      is_deleted: false,
      create_time: now,
      create_by: userId,
    });
    return { id };
  },

  async remove(id, userId) {
    await tbl(db, 'sms_job', T, STAGE).where({ id }).update({
      is_deleted: true,
      update_time: new Date(),
      update_by: userId,
    });
  },


  async phaseOptions(): Promise<PhaseOption[]> {
    return Object.entries(PHASE_NAME).map(([v, label]) => ({ value: Number(v), label }));
  },
};


/** 学号生成：J + 年份 + 4 位流水（实训口径） */
async function generateStudentNo(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `J${year}`;
  const rows = (await tbl(db, 'sms_job', T, STAGE).where('student_no', 'like', `${prefix}%`).select('student_no')) as Array<{
    student_no: string;
  }>;
  const max = rows.reduce((m, r) => {
    const n = Number(String(r.student_no).slice(prefix.length));
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

export default repo;
