/**
 * 就业日志路由（就业日志 / 信息档案 - 就业日志记录）
 *
 * 脑图字段：
 *   页面：姓名 / 有效简历投递 / 面试邀约 / 面试场次 / 面试时间 / 面试公司 / 面试情况
 *   操作：新建 / 编辑 / 详情 / 搜索·筛选
 *   信息档案视角还需要：岗位 / 薪资
 *
 * ⚠️ 学生姓名/学号/班级是【冗余存储】的。
 *    因为就业日志必须留痕：学生毕业被删了，历史求职记录也还在。
 *    前端列表因此不需要 join，一次查询就能出结果。
 */

import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { BizCode } from 'shared-types';
import { ok, page } from '../utils/response';
import { db } from '../utils/db';
import { wrap } from '../utils/wrap';
import { validate } from '../middleware/validate';
import { BizError } from '../middleware/errorHandler';
import { fmtDate } from '../utils/date';
// ★ 阶段隔离（班主任只看大学 / 项目经理只看实训）
import { applyTrainingScope, myTrainingClassIds, operatorOf } from '../utils/stageScope';
// ★ P3 切读层：本文件两张表（t_employment_log / t_student_base）都已归一，
//   全部走 tbl()/tblIns() 路由；开关关时与原实现逐字节等价。
import { tbl, tblIns } from '../teaching/shared/uniTable';

export const employmentLogRouter = Router();

const TABLE = 't_employment_log';
const STUDENT = 't_student_base';

/** ★ 统一表 edu_stage 取值（本路由只服务实训） */
const STAGE = 'job' as const;
const DB = 'sms_job';

const SELECT_FIELDS = [
  'id', 'student_id', 'student_no', 'student_name', 'class_name',
  'log_date', 'resume_count', 'interview_invite', 'interview_count',
  'interview_time', 'company', 'position', 'salary', 'interview_situation', 'create_time',
];

/** 行 → 前端对象 */
function toVo(r: any) {
  return {
    id: r.id,
    studentId: r.student_id,
    studentNo: r.student_no,
    studentName: r.student_name,
    className: r.class_name,
    logDate: fmtDate(r.log_date),
    resumeCount: r.resume_count,
    interviewInvite: r.interview_invite,
    interviewCount: r.interview_count,
    interviewTime: r.interview_time,
    company: r.company,
    position: r.position,
    salary: r.salary === null || r.salary === undefined ? undefined : Number(r.salary),
    interviewSituation: r.interview_situation,
    createTime: r.create_time,
  };
}

/* ============================================================
 * 1. 列表查询（含搜索/筛选）
 *    GET /api/job/employment-log/list?studentName=张&company=字节&startDate=&endDate=
 * ============================================================ */

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(100).default(20),
  studentId: z.string().optional(),
  studentName: z.string().optional(),
  company: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

employmentLogRouter.get(
  '/list',
  validate(listSchema),
  wrap(async (req, res) => {
    const q = (req as any).validated as z.infer<typeof listSchema>;

    const query = tbl(db, DB, TABLE, STAGE).where('is_deleted', false);
    // ★ t_employment_log 挂在「学生」身上，没有 class_id 列
    //   → via='student'：换成一串「我班上的学生 id」再过滤
    await applyTrainingScope(query, req, { table: TABLE, dbName: DB, via: 'student' });

    if (q.studentId) query.andWhere('student_id', q.studentId);
    if (q.studentName) query.andWhere('student_name', 'like', `%${q.studentName}%`);
    if (q.company) query.andWhere('company', 'like', `%${q.company}%`);
    if (q.startDate) query.andWhere('log_date', '>=', q.startDate);
    if (q.endDate) query.andWhere('log_date', '<=', q.endDate);

    const [{ total }] = (await query.clone().count({ total: '*' })) as Array<{ total: number }>;

    const rows = await query
      .clone()
      .select(SELECT_FIELDS)
      .orderBy('log_date', 'desc')
      .orderBy('create_time', 'desc')
      .limit(q.size)
      .offset((q.page - 1) * q.size);

    res.json(page(rows.map(toVo), Number(total), q));
  }),
);

/* ============================================================
 * 2. 详情
 *    GET /api/job/employment-log/detail?id=xxx
 * ============================================================ */

employmentLogRouter.get(
  '/detail',
  validate(z.object({ id: z.string().min(1, '必须传 id') })),
  wrap(async (req, res) => {
    const { id } = (req as any).validated as { id: string };

    const row = await tbl(db, DB, TABLE, STAGE).where({ id, is_deleted: false }).first();
    if (!row) throw new BizError(BizCode.PARAM_ERROR, '就业日志不存在');

    res.json(ok(toVo(row)));
  }),
);

/* ============================================================
 * 3. 新增
 *    POST /api/job/employment-log/add
 * ============================================================ */

const addSchema = z.object({
  studentId: z.string().min(1, '请选择学生'),
  logDate: z.string().min(1, '请选择日志日期'),
  resumeCount: z.coerce.number().int().min(0).max(999).default(0),
  interviewInvite: z.coerce.number().int().min(0).max(999).default(0),
  interviewCount: z.coerce.number().int().min(0).max(999).default(0),
  interviewTime: z.string().max(32).optional(),
  company: z.string().max(100).optional(),
  position: z.string().max(100).optional(),
  salary: z.coerce.number().min(0).max(1000000).optional(),
  interviewSituation: z.string().max(2000).optional(),
});

employmentLogRouter.post(
  '/add',
  validate(addSchema),
  wrap(async (req, res) => {
    const body = (req as any).validated as z.infer<typeof addSchema>;

    const student = await tbl(db, DB, STUDENT, STAGE).where({ id: body.studentId, is_deleted: false }).first();
    if (!student) throw new BizError(BizCode.STUDENT_NOT_FOUND, '学生不存在，请重新选择');

    const id = randomUUID();
    await tblIns(db, DB, TABLE, STAGE, {
      id,
      student_id: body.studentId,
      student_no: student.student_no,
      student_name: student.student_name,
      class_name: student.class_name,
      log_date: body.logDate,
      resume_count: body.resumeCount,
      interview_invite: body.interviewInvite,
      interview_count: body.interviewCount,
      interview_time: body.interviewTime ?? null,
      company: body.company ?? null,
      position: body.position ?? null,
      salary: body.salary ?? null,
      interview_situation: body.interviewSituation ?? null,
      is_deleted: false,
      create_time: new Date(),
      create_by: req.user?.userId || 'system',
    });

    res.json(ok({ id }, '新增成功'));
  }),
);

/* ============================================================
 * 4. 修改
 *    PUT /api/job/employment-log/update
 * ============================================================ */

const updateSchema = addSchema.extend({ id: z.string().min(1, '必须传 id') });

employmentLogRouter.put(
  '/update',
  validate(updateSchema),
  wrap(async (req, res) => {
    const body = (req as any).validated as z.infer<typeof updateSchema>;

    const row = await tbl(db, DB, TABLE, STAGE).where({ id: body.id, is_deleted: false }).first();
    if (!row) throw new BizError(BizCode.PARAM_ERROR, '就业日志不存在或已被删除');

    const student = await tbl(db, DB, STUDENT, STAGE).where({ id: body.studentId, is_deleted: false }).first();
    if (!student) throw new BizError(BizCode.STUDENT_NOT_FOUND, '学生不存在，请重新选择');

    await tbl(db, DB, TABLE, STAGE).where({ id: body.id }).update({
      student_id: body.studentId,
      student_no: student.student_no,
      student_name: student.student_name,
      class_name: student.class_name,
      log_date: body.logDate,
      resume_count: body.resumeCount,
      interview_invite: body.interviewInvite,
      interview_count: body.interviewCount,
      interview_time: body.interviewTime ?? null,
      company: body.company ?? null,
      position: body.position ?? null,
      salary: body.salary ?? null,
      interview_situation: body.interviewSituation ?? null,
      update_time: new Date(),
      update_by: req.user?.userId || 'system',
    });

    res.json(ok(null, '修改成功'));
  }),
);

/* ============================================================
 * 5. 删除（逻辑删除）
 *    DELETE /api/job/employment-log/delete/:id
 * ============================================================ */

employmentLogRouter.delete(
  '/delete/:id',
  wrap(async (req, res) => {
    const { id } = req.params;

    const row = await tbl(db, DB, TABLE, STAGE).where({ id, is_deleted: false }).first();
    if (!row) throw new BizError(BizCode.PARAM_ERROR, '就业日志不存在或已被删除');

    await tbl(db, DB, TABLE, STAGE).where({ id }).update({
      is_deleted: true,
      update_time: new Date(),
      update_by: req.user?.userId || 'system',
    });

    res.json(ok(null, '删除成功'));
  }),
);

export default employmentLogRouter;
