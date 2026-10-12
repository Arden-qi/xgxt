/**
 * 学生管理路由（示例模块 —— 照着这个改成你自己的模块）
 *
 * ⚠️ 这是「增删改查」的完整示范，包含：
 *    - 列表查询（分页 + 筛选）
 *    - 详情查询
 *    - 新增（含参数校验）
 *    - 修改
 *    - 删除（逻辑删除）
 *
 * 各模块复制这个文件，改掉：
 *    1. 表名 t_student_base → 你自己的表
 *    2. 端口和接口前缀
 *    3. 字段名
 */

import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import {
  BizCode,
  STUDENT_STATUS_NAME,
  GENDER_NAME,
  DEPT_NAME,
} from 'shared-types/perm';
import { ok, page } from '../utils/response';
import { db } from '../utils/db';
import { wrap } from '../utils/wrap';
import { validate } from '../middleware/validate';
import { checkPermission } from '../middleware/auth';
import { BizError } from '../middleware/errorHandler';

export const studentRouter = Router();

/** 表名常量 —— 改这里就够 */
const TABLE = 't_student_base';

/* ============================================================
 * 1. 查询学生列表
 *    GET /api/consult/student/list?page=1&size=20&className=G104
 * ============================================================ */

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(100).default(20),
  studentNo: z.string().optional(),
  studentName: z.string().optional(),
  classId: z.string().optional(),
  deptCode: z.coerce.number().int().optional(),
  studentStatus: z.coerce.number().int().optional(),
  keyword: z.string().optional(),
});

studentRouter.get(
  '/list',
  validate(listSchema),
  wrap(async (req, res) => {
    const q = (req as any).validated as z.infer<typeof listSchema>;

    // ---- 拼查询条件 ----
    const query = db(TABLE).where('is_deleted', false);

    if (q.studentNo) query.andWhere('student_no', 'like', `%${q.studentNo}%`);
    if (q.studentName) query.andWhere('student_name', 'like', `%${q.studentName}%`);
    if (q.classId) query.andWhere('class_id', q.classId);
    if (q.deptCode) query.andWhere('dept_code', q.deptCode);
    if (q.studentStatus) query.andWhere('student_status', q.studentStatus);
    if (q.keyword) {
      query.andWhere((qb) => {
        qb.where('student_no', 'like', `%${q.keyword}%`)
          .orWhere('student_name', 'like', `%${q.keyword}%`)
          .orWhere('phone', 'like', `%${q.keyword}%`);
      });
    }

    // ---- 取总数 ----
    const [{ total }] = await query.clone().count({ total: '*' });

    // ---- 取当前页数据 ----
    const rows = await query
      .clone()
      .select('*')
      .orderBy('create_time', 'desc')
      .limit(q.size)
      .offset((q.page - 1) * q.size);

    // ---- 转换成前端要的格式（双返回枚举名）----
    const list = rows.map((r: any) => ({
      studentId: r.id,
      studentNo: r.student_no,
      studentName: r.student_name,
      gender: r.gender,
      genderName: GENDER_NAME[r.gender] || '',
      className: r.class_name,
      studentStatus: r.student_status,
      studentStatusName: STUDENT_STATUS_NAME[r.student_status] || '',
      phone: r.phone,
      headTeacherName: r.head_teacher_name,
    }));

    res.json(page(list, Number(total), q));
  }),
);

/* ============================================================
 * 2. 查询学生详情
 *    GET /api/consult/student/detail?id=xxx
 * ============================================================ */

studentRouter.get(
  '/detail',
  validate(z.object({ id: z.string().min(1, '必须传 id') })),
  wrap(async (req, res) => {
    const { id } = (req as any).validated as { id: string };

    const row = await db(TABLE).where({ id, is_deleted: false }).first();

    if (!row) {
      throw new BizError(BizCode.STUDENT_NOT_FOUND, '学生不存在');
    }

    res.json(ok({
      id: row.id,
      studentNo: row.student_no,
      studentName: row.student_name,
      gender: row.gender,
      genderName: GENDER_NAME[row.gender] || '',
      age: row.age,
      deptCode: row.dept_code,
      deptName: DEPT_NAME[row.dept_code] || '',
      classId: row.class_id,
      className: row.class_name,
      studentStatus: row.student_status,
      studentStatusName: STUDENT_STATUS_NAME[row.student_status] || '',
      phone: row.phone,
      parentPhone: row.parent_phone,
      education: row.education,
      enrollDate: row.enroll_date,
      remark: row.remark,
      createTime: row.create_time,
    }));
  }),
);

/* ============================================================
 * 3. 新增学生
 *    POST /api/consult/student/add
 * ============================================================ */

const addSchema = z.object({
  studentNo: z.string().min(1, '学号必填'),
  studentName: z.string().min(1, '姓名必填'),
  gender: z.coerce.number().int().min(1).max(2, '性别只能是 1(男) 或 2(女)'),
  age: z.coerce.number().int().min(10).max(60).optional(),
  deptCode: z.coerce.number().int().min(1).max(2, '部门只能是 1(初高部) 或 2(大学部)'),
  classId: z.string().optional(),
  phone: z.string().max(20).optional(),
  parentPhone: z.string().max(20).optional(),
  education: z.string().max(50).optional(),
  enrollDate: z.string().optional(),
  remark: z.string().max(500).optional(),
});

studentRouter.post(
  '/add',
  checkPermission('consult:student:add'),
  validate(addSchema),
  wrap(async (req, res) => {
    const body = (req as any).validated as z.infer<typeof addSchema>;

    // ---- 检查学号是否重复 ----
    const exists = await db(TABLE).where({ student_no: body.studentNo, is_deleted: false }).first();
    if (exists) {
      throw new BizError(BizCode.STUDENT_NO_EXISTS, `学号 ${body.studentNo} 已存在，请勿重复添加`);
    }

    // ---- 插入 ----
    const id = randomUUID();
    await db(TABLE).insert({
      id,
      student_no: body.studentNo,
      student_name: body.studentName,
      gender: body.gender,
      age: body.age ?? null,
      dept_code: body.deptCode,
      class_id: body.classId ?? null,
      phone: body.phone ?? null,
      parent_phone: body.parentPhone ?? null,
      education: body.education ?? null,
      enroll_date: body.enrollDate ?? null,
      remark: body.remark ?? null,
      student_status: 1,        // 新学生默认「待咨询」
      is_deleted: false,
      create_time: new Date(),
      create_by: req.user?.userId || 'system',
    });

    res.json(ok({ id }, '新增成功'));
  }),
);

/* ============================================================
 * 4. 修改学生
 *    PUT /api/consult/student/update
 * ============================================================ */

const updateSchema = addSchema.extend({
  id: z.string().min(1, '必须传 id'),
});

studentRouter.put(
  '/update',
  checkPermission('consult:student:edit'),
  validate(updateSchema),
  wrap(async (req, res) => {
    const body = (req as any).validated as z.infer<typeof updateSchema>;

    const exists = await db(TABLE).where({ id: body.id, is_deleted: false }).first();
    if (!exists) {
      throw new BizError(BizCode.STUDENT_NOT_FOUND, '学生不存在');
    }

    // 学号改了要检查是否和别人的冲突
    if (body.studentNo !== exists.student_no) {
      const dup = await db(TABLE)
        .where({ student_no: body.studentNo, is_deleted: false })
        .whereNot('id', body.id)
        .first();
      if (dup) {
        throw new BizError(BizCode.STUDENT_NO_EXISTS, `学号 ${body.studentNo} 已被占用`);
      }
    }

    await db(TABLE).where({ id: body.id }).update({
      student_no: body.studentNo,
      student_name: body.studentName,
      gender: body.gender,
      age: body.age ?? null,
      dept_code: body.deptCode,
      class_id: body.classId ?? null,
      phone: body.phone ?? null,
      parent_phone: body.parentPhone ?? null,
      education: body.education ?? null,
      enroll_date: body.enrollDate ?? null,
      remark: body.remark ?? null,
      update_time: new Date(),
      update_by: req.user?.userId || 'system',
    });

    res.json(ok(null, '修改成功'));
  }),
);

/* ============================================================
 * 5. 删除学生（逻辑删除）
 *    DELETE /api/consult/student/delete/:id
 * ============================================================ */

studentRouter.delete(
  '/delete/:id',
  checkPermission('consult:student:delete'),
  wrap(async (req, res) => {
    const { id } = req.params;

    const exists = await db(TABLE).where({ id, is_deleted: false }).first();
    if (!exists) {
      throw new BizError(BizCode.STUDENT_NOT_FOUND, '学生不存在或已被删除');
    }

    // ⚠️ 逻辑删除！不要用 .del()
    await db(TABLE).where({ id }).update({
      is_deleted: true,
      update_time: new Date(),
      update_by: req.user?.userId || 'system',
    });

    res.json(ok(null, '删除成功'));
  }),
);

export default studentRouter;
