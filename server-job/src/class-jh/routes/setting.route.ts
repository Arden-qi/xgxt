/**
 * 系统设置 / 阶段字典 / 操作日志路由（教学管理初高）
 *
 * 挂载：settingRouter → /api/class/setting；stageRouter → /api/class/stage；opLogRouter → /api/class/opLog。
 * 表：t_class_setting、t_class_stage、t_class_op_log。
 */

import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { BizCode, STAGE_NAME, DEPT_NAME, FLOW_TYPE_NAME } from 'shared-types/class-jh';
import { ok, page } from '../utils/response';
import { db } from '../utils/db';
import { wrap } from '../utils/wrap';
import { writeOpLog } from '../utils/opLog';
import { nameOf } from '../utils/enumName';
import { getAllSettings, SETTING_DEFAULTS } from '../utils/setting';
import { validate } from '../middleware/validate';
import { checkPermission } from '../middleware/auth';
import { BizError } from '../middleware/errorHandler';

export const settingRouter = Router();
export const stageRouter = Router();
export const opLogRouter = Router();

const SETTING_TABLE = 't_class_setting';
const STAGE_TABLE = 't_class_stage';
const OP_LOG_TABLE = 't_class_op_log';
const STUDENT_TABLE = 't_class_student';

/** 设置项中文名 */
const SETTING_NAME: Record<string, string> = {
  attendanceTargetRate: '出勤率目标（%）',
  attendanceScope: '出勤统计口径',
  feeRemindDays: '催费提前提醒天数',
  feeUrgeWindowDays: '催费列表窗口天数（到期日距今 ≤ N 天进列表，含已逾期）',
  refundThresholdAmount: '退费审批阈值（分）',
  closedClassIntakeTypes: '封班可转入类型',
  allowStudentAdd: '是否允许手动新增学生',
};

/* ============================================================
 * 1. 设置详情（KV 全量，缺失补默认）
 *   GET /api/class/setting/detail
 * ============================================================ */

settingRouter.get(
  '/detail',
  checkPermission('class:setting:view'),
  wrap(async (_req, res) => {
    const rows = await db(SETTING_TABLE).where('is_deleted', false).select('*');
    const byKey = new Map<string, any>(rows.map((r: any) => [r.setting_key, r]));

    const keys = new Set<string>([...Object.keys(SETTING_DEFAULTS), ...rows.map((r: any) => r.setting_key)]);
    const list = Array.from(keys).map((key) => {
      const r = byKey.get(key);
      return {
        settingKey: key,
        settingName: r?.setting_name ?? SETTING_NAME[key] ?? key,
        settingValue: r?.setting_value ?? SETTING_DEFAULTS[key] ?? '',
        remark: r?.remark ?? null,
      };
    });

    res.json(ok(list));
  }),
);

/* ============================================================
 * 2. 设置修改（KV upsert）
 *   PUT /api/class/setting/update
 * ============================================================ */

settingRouter.put(
  '/update',
  checkPermission('class:setting:edit'),
  validate(z.record(z.union([z.string(), z.number(), z.boolean()]))),
  wrap(async (req, res) => {
    const body = (req as any).validated as Record<string, string | number | boolean>;
    const now = new Date();

    for (const [key, value] of Object.entries(body)) {
      const strVal = typeof value === 'boolean' ? String(value) : String(value);
      const existed = await db(SETTING_TABLE).where({ setting_key: key, is_deleted: false }).first();
      if (existed) {
        await db(SETTING_TABLE).where({ id: existed.id }).update({
          setting_value: strVal,
          update_time: now,
          update_by: req.user?.userId || 'system',
        });
      } else {
        await db(SETTING_TABLE).insert({
          id: randomUUID(),
          setting_key: key,
          setting_name: SETTING_NAME[key] ?? key,
          setting_value: strVal,
          remark: null,
          is_deleted: false,
          create_time: now,
          create_by: req.user?.userId || 'system',
        });
      }
    }

    await writeOpLog({
      module: 'setting',
      bizType: '系统设置',
      opUserId: req.user?.userId,
      opUserName: req.user?.userName,
      opDesc: `修改系统设置：${Object.keys(body).join('、')}`,
      afterValue: body,
    });

    res.json(ok(null, '保存成功'));
  }),
);

/* ============================================================
 * 3. 阶段列表
 *   GET /api/class/stage/list?deptCode=
 * ============================================================ */

stageRouter.get(
  '/list',
  checkPermission('class:setting:view'),
  validate(z.object({ deptCode: z.coerce.number().int().optional() })),
  wrap(async (req, res) => {
    const q = (req as any).validated as { deptCode?: number };
    const query = db(STAGE_TABLE).where('is_deleted', false);
    if (q.deptCode) query.andWhere('dept_code', q.deptCode);

    const rows = await query.select('*').orderBy('sort_no', 'asc').orderBy('stage_code', 'asc');
    res.json(
      ok(
        rows.map((s: any) => ({
          stageCode: s.stage_code,
          stageName: s.stage_name || nameOf(STAGE_NAME, s.stage_code),
          deptCode: s.dept_code,
          deptName: nameOf(DEPT_NAME, s.dept_code),
          studyMonths: s.study_months,
          sortNo: s.sort_no,
          id: s.id,
        })),
      ),
    );
  }),
);

/* ============================================================
 * 4. 阶段新增
 *   POST /api/class/stage/add
 * ============================================================ */

const stageAddSchema = z.object({
  stageCode: z.coerce.number().int(),
  stageName: z.string().min(1, '阶段名称必填'),
  deptCode: z.coerce.number().int().min(1).max(2),
  studyMonths: z.coerce.number().int().optional(),
  sortNo: z.coerce.number().int().optional(),
});

stageRouter.post(
  '/add',
  checkPermission('class:setting:edit'),
  validate(stageAddSchema),
  wrap(async (req, res) => {
    const body = (req as any).validated as z.infer<typeof stageAddSchema>;

    const dup = await db(STAGE_TABLE)
      .where({ stage_code: body.stageCode, dept_code: body.deptCode, is_deleted: false })
      .first();
    if (dup) throw new BizError(BizCode.BUSINESS_RULE_VIOLATION, '该部门下阶段编码已存在');

    const id = randomUUID();
    const now = new Date();
    await db(STAGE_TABLE).insert({
      id,
      stage_code: body.stageCode,
      stage_name: body.stageName,
      dept_code: body.deptCode,
      study_months: body.studyMonths ?? null,
      sort_no: body.sortNo ?? 0,
      is_deleted: false,
      create_time: now,
      create_by: req.user?.userId || 'system',
    });

    res.json(ok({ id }, '新增成功'));
  }),
);

/* ============================================================
 * 5. 阶段删除（仍有学生的阶段禁止删）
 *   DELETE /api/class/stage/delete/:id
 * ============================================================ */

stageRouter.delete(
  '/delete/:id',
  checkPermission('class:setting:edit'),
  wrap(async (req, res) => {
    const { id } = req.params;
    const stage = await db(STAGE_TABLE).where({ id, is_deleted: false }).first();
    if (!stage) throw new BizError(BizCode.SETTING_NOT_FOUND, '阶段不存在');

    const used = await db(STUDENT_TABLE).where({ stage: stage.stage_code, is_deleted: false }).first();
    if (used) throw new BizError(BizCode.BUSINESS_RULE_VIOLATION, '该阶段下仍有学生，禁止删除');

    await db(STAGE_TABLE).where({ id }).update({
      is_deleted: true,
      update_time: new Date(),
      update_by: req.user?.userId || 'system',
    });

    res.json(ok(null, '删除成功'));
  }),
);

/* ============================================================
 * 6. 操作日志列表
 *   GET /api/class/opLog/list
 * ============================================================ */

const opLogListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(100).default(20),
  bizType: z.string().optional(),
  studentId: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

opLogRouter.get(
  '/list',
  checkPermission('class:opLog:view'),
  validate(opLogListSchema),
  wrap(async (req, res) => {
    const q = (req as any).validated as z.infer<typeof opLogListSchema>;
    const query = db(OP_LOG_TABLE).where('is_deleted', false);
    if (q.bizType) query.andWhere('biz_type', q.bizType);
    if (q.studentId) query.andWhere('student_id', q.studentId);
    if (q.startDate) query.andWhere('op_time', '>=', `${q.startDate} 00:00:00`);
    if (q.endDate) query.andWhere('op_time', '<=', `${q.endDate} 23:59:59`);

    const [{ total }] = await query.clone().count({ total: '*' });
    const rows = await query
      .clone()
      .select('*')
      .orderBy('op_time', 'desc')
      .limit(q.size)
      .offset((q.page - 1) * q.size);

    const list = rows.map((r: any) => ({
      logId: r.id,
      module: r.module,
      bizType: r.biz_type,
      bizId: r.biz_id,
      studentId: r.student_id,
      classId: r.class_id,
      opUserId: r.op_user_id,
      opUserName: r.op_user_name,
      opTime: r.op_time,
      opDesc: r.op_desc,
      beforeValue: parseJson(r.before_value),
      afterValue: parseJson(r.after_value),
    }));

    res.json(page(list, Number(total), q));
  }),
);

function parseJson(v: any): any {
  if (!v) return null;
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

export default settingRouter;

/** 供 dashboard 复用：待审批流程类型中文名 */
export const _flowTypeName = FLOW_TYPE_NAME;
