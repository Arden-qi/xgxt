/**
 * 学生档案仓储 · 初高（sms_class_jh.t_class_student）
 * ============================================================
 *
 * 【与其它学段不同名的字段】
 *   idCard   → id_card_no   （就业/大学叫 id_card）★ 命名冲突点
 *   nativePlace → native_place
 *
 * 【独有的区块】校园网账号密码（net_account / net_init_password）
 * 【独有的列】  pending_flow_type（进行中的流程）/ agreement_status / literacy_desc
 *
 * 【数据范围】原实现走 class-jh 的 dataScope：
 *   buildClassScope(req) + getScopedClassIds(db, 班级表, scope)
 *   —— 本班级范围时按班级的 班主任/教员/助教 三字段匹配。
 */

import { randomUUID } from 'crypto';
import { db } from '../../class-jh/utils/db';
import { buildClassScope, getScopedClassIds } from '../../class-jh/middleware/dataScope';
import { DEPT_NAME, GENDER_NAME, STUDENT_STATUS_NAME, StudentStatus } from 'shared-types';
import { STAGE_NAME, FLOW_TYPE_NAME } from 'shared-types/class-jh';
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

const T = 't_class_student';
const CLASS_TABLE = 't_class_info';
const FLOW_TABLE = 't_class_flow';
const REPEAT_TABLE = 't_class_repeat';
const STAGE = 'jh' as const;
/** 初高库（本仓储全部表都在这里） */
const DB = 'sms_class_jh';

function str(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  return String(v);
}
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 初高的「末班状态」——用于标记该学段是否已进过末班 */

function mapRow(r: Record<string, any>): StudentRow {
  const gender = Number(r.gender ?? 0);
  const status = Number(r.student_status ?? 0);
  const phase = readPhaseCode(r);
  return {
    stage: STAGE,
    stageName: '初高',
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
    phaseName: phase === null ? '' : (STAGE_NAME[phase] ?? ''),
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
    dormNo: str(r.dorm_no),
    bedNo: str(r.bed_no),
    bedLabel: bedText(str(r.dorm_no), str(r.bed_no)),
    attendanceRate: numOrNull(r.attendance_rate),
    repeatCount: Number(r.repeat_count ?? 0),
    // ★ 初高列名是 id_card_no
    idCard: str(r.id_card_no),
    nativePlace: str(r.native_place),
    graduateSchool: str(r.graduate_school),
    homeAddress: str(r.home_address),
    recruitTeacherName: str(r.recruit_teacher_name),
    recruitTeacherPhone: str(r.recruit_teacher_phone),
    consultTeacherName: str(r.consult_teacher_name),
    consultTeacherPhone: str(r.consult_teacher_phone),
    remark: str(r.remark),
    createTime: fmtDateTime(r.create_time),
  };
}

/** 房间号-床位（初高自己的拼法：`301-3`，不带上/下） */
function bedText(room: string | null, bed: string | null): string | null {
  if (!room) return bed;
  if (!bed) return room;
  return `${room}-${bed}`;
}

async function applyScope(qb: any, user: any): Promise<void> {
  const scope = buildClassScope({ user } as any);
  const classIds = await getScopedClassIds(db, CLASS_TABLE, scope, DB, STAGE);
  if (classIds) {
    if (!classIds.length) qb.whereRaw('1 = 0');
    else qb.whereIn('class_id', classIds);
  } else if (scope.type === 3 && scope.deptCode) {
    qb.andWhere('dept_code', scope.deptCode);
  }
}

function buildBase(q: StudentListQuery) {
  const qb = tbl(db, 'sms_class_jh', T, STAGE).where('is_deleted', false);
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
  sections: ['net', 'flows', 'repeats'],
  supportUnassigned: true,

  async list(q, user) {
    const qb = buildBase(q);
    await applyScope(qb, user);
    const rows = (await qb.orderBy('create_time', 'desc')) as Array<Record<string, any>>;
    return rows.map(mapRow);
  },

  async detail(id, user) {
    const r = (await tbl(db, 'sms_class_jh', T, STAGE).where({ id, is_deleted: false }).first()) as
      | Record<string, any>
      | undefined;
    if (!r) return null;
    const guard = tbl(db, 'sms_class_jh', T, STAGE).where({ id, is_deleted: false });
    await applyScope(guard, user);
    if (!(await guard.first())) return null;

    const base = mapRow(r);
    // ★ 切读接入：审批流水 t_class_flow → t_uni_approval。
    //   下面读的 flow_type / flow_status / apply_time / current_node_name / reject_reason
    //   在统一表里同名保留（超集），只需换表。
    const flows = (await tbl(db, 'sms_class_jh', FLOW_TABLE, STAGE)
      .where({ student_id: id, is_deleted: false })
      .orderBy('create_time', 'desc')) as Array<Record<string, any>>;
    const repeats = (await tbl(db, 'sms_class_jh', REPEAT_TABLE, STAGE)
      .where({ student_id: id, is_deleted: false })
      .orderBy('repeat_time', 'desc')) as Array<Record<string, any>>;

    return {
      base,
      profile: {
        birthDate: str(fmtDate(r.birth_date)),
        nativePlace: str(r.native_place),
        idCard: str(r.id_card_no),
        graduateSchool: str(r.graduate_school),
        homeAddress: str(r.home_address),
        idPhotoUrl: str(r.id_photo_url),
        householdPhotoUrl: str(r.household_photo_url),
      },
      market: {
        recruitTeacherName: str(r.recruit_teacher_name),
        recruitTeacherPhone: str(r.recruit_teacher_phone),
        consultTeacherName: str(r.consult_teacher_name),
        consultTeacherPhone: str(r.consult_teacher_phone),
      },
      dorm:
        base.dormId || base.dormNo
          ? {
              dormId: base.dormId,
              dormNo: base.dormNo,
              bedNo: base.bedNo,
              bedLabel: base.bedLabel,
              building: null,
            }
          : null,
      quality: null,
      net: {
        netAccount: str(r.net_account),
        netInitPassword: str(r.net_init_password),
      },
      resume: null,
      flows: flows.map((f) => ({
        id: String(f.id),
        flowType: f.flow_type,
        flowTypeName: FLOW_TYPE_NAME[Number(f.flow_type)] ?? '',
        flowStatus: f.flow_status,
        applyTime: fmtDate(f.apply_time),
        currentNodeName: f.current_node_name ?? null,
        rejectReason: f.reject_reason ?? null,
      })),
      repeats: repeats.map((x) => ({
        id: String(x.id),
        fromClassName: x.from_class_name ?? null,
        toClassName: x.to_class_name ?? null,
        repeatReason: x.repeat_reason ?? null,
        repeatTime: fmtDate(x.repeat_time),
        repeatCount: x.repeat_count ?? 0,
      })),
      extra: {
        pendingFlowType: numOrNull(r.pending_flow_type),
        pendingFlowTypeName: FLOW_TYPE_NAME[Number(r.pending_flow_type)] ?? '',
        agreementStatus: numOrNull(r.agreement_status),
        literacyDesc: str(r.literacy_desc),
      },
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
    // ★ 初高写 id_card_no
    set('id_card_no', body.idCard);
    set('recruit_teacher_name', body.recruitTeacherName);
    set('recruit_teacher_phone', body.recruitTeacherPhone);
    set('consult_teacher_name', body.consultTeacherName);
    set('consult_teacher_phone', body.consultTeacherPhone);
    set('dorm_id', body.dormId);
    set('dorm_no', body.dormNo);
    set('bed_no', body.bedNo);
    set('remark', body.remark);

    if (body.id) {
      await tbl(db, 'sms_class_jh', T, STAGE).where({ id: body.id }).update(payload);
      return { id: body.id };
    }

    const studentNo = String(body.studentNo || '').trim() || (await generateStudentNo());
    const dup = (await tbl(db, 'sms_class_jh', T, STAGE).where({ student_no: studentNo }).first()) as
      | Record<string, any>
      | undefined;
    if (dup) {
      throw new Error(
        dup.is_deleted
          ? `学号 ${studentNo} 已被「已删除」的历史学生占用，不可复用，请更换`
          : `学号 ${studentNo} 已存在，请勿重复添加`,
      );
    }

    const id = randomUUID();
    await tblIns(db, 'sms_class_jh', T, STAGE, {
      id,
      student_no: studentNo,
      ...payload,
      student_status: body.studentStatus ?? StudentStatus.TRIAL,
      repeat_count: 0,
      is_deleted: false,
      create_time: now,
      create_by: userId,
    });
    return { id };
  },

  async remove(id, userId) {
    await tbl(db, 'sms_class_jh', T, STAGE).where({ id }).update({
      is_deleted: true,
      update_time: new Date(),
      update_by: userId,
    });
  },


  async phaseOptions(): Promise<PhaseOption[]> {
    return Object.entries(STAGE_NAME).map(([v, label]) => ({ value: Number(v), label }));
  },
};


/** 学号生成：S + 年份 + 4 位流水（初高口径） */
async function generateStudentNo(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `S${year}`;
  const rows = (await tbl(db, 'sms_class_jh', T, STAGE).where('student_no', 'like', `${prefix}%`).select('student_no')) as Array<{
    student_no: string;
  }>;
  const max = rows.reduce((m, r) => {
    const n = Number(String(r.student_no).slice(prefix.length));
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

export default repo;
