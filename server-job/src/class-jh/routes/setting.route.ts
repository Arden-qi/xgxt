/**
 * 系统设置 / 阶段方案 / 操作日志路由（教学管理初高）
 *
 * 挂载：settingRouter → /api/class/setting；
 *      stageSchemeRouter → /api/class/stage-scheme；opLogRouter → /api/class/opLog。
 * 表：t_class_setting、t_class_stage_scheme(+_stage)、t_class_op_log。
 *     （t_class_stage 只剩「编码 → 中文名」字典的用途，由方案保存时自动维护）
 *
 * ★ 2026-10-22：旧的「阶段字典 / 旧阶段方案」接口整套删除
 *   —— 前端页签早就撤了（阶段设置、阶段方案都并到「班级管理 → 阶段方案设计」），
 *   后端还留着 7 个没人调用的接口（/stage/list|add|delete、/stage/plan/*），
 *   它们写的是旧表 t_class_stage_plan + t_class_stage.plan_id，
 *   和新方案表并存只会让「阶段编码从哪来」越来越乱。
 *   现在阶段（名称 / 学制 / 编码）统一由方案维护：保存方案时后端分配编码并
 *   同步进 t_class_stage 字典，从而保留历史编码（预科 101、一阶段 201…）。
 */

import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { DEPT_NAME, FLOW_TYPE_NAME, RoleCode, DeptCode } from 'shared-types/class-jh';
import { ok, page } from '../utils/response';
import { db } from '../utils/db';
import { wrap } from '../utils/wrap';
import { writeOpLog } from '../utils/opLog';
import { nameOf } from '../utils/enumName';
import { getAllSettings, SETTING_DEFAULTS } from '../utils/setting';
import { validate } from '../middleware/validate';
import { checkPermission, checkRole } from '../middleware/auth';
import {
  listSchemes,
  getScheme,
  createScheme,
  updateScheme,
  removeScheme,
  type StageSchemeSaveInput,
} from '../utils/stageScheme';

export const settingRouter = Router();
export const stageSchemeRouter = Router();
export const opLogRouter = Router();

const SETTING_TABLE = 't_class_setting';
const OP_LOG_TABLE = 't_class_op_log';

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
 * 5b. 阶段方案（★ 2026-10-16）
 *
 * 【与上面「阶段字典」的区别】
 *   阶段字典：一条记录 = 一个阶段（平铺）。
 *   阶段方案：一个方案 = 方案名称 + 所属部门 + N 个阶段明细（阶段名称 + 学制月数）。
 *   例：方案一（初高部）→ 一阶段 学制2月 / 二阶段 学制2月 / 三阶段 学制2月。
 *
 * 【接口】
 *   GET    /api/class/stage-scheme/list?deptCode=   方案列表（含阶段明细）
 *   POST   /api/class/stage-scheme/add              新增方案（含阶段明细）
 *   PUT    /api/class/stage-scheme/update/:id       修改方案（阶段明细整体覆盖）
 *   DELETE /api/class/stage-scheme/delete/:id       删除方案（被班级引用时拒绝）
 * ============================================================ */

/** 方案保存校验（新增 / 修改共用） */
const schemeSaveSchema = z.object({
  schemeName: z.string().trim().min(1, '方案名称必填').max(50),
  /**
   * ★ 2026-10-22 修：上限从 2 放宽到 3（就业部）。
   *
   *   阶段方案是 2026-10-16 做的，那时部门只有 初高部(1) / 大学部(2)，
   *   所以这里写死 max(2)。2026-10-19 加了就业部(3)，
   *   方案列表、班级绑定、阶段推进都跟着改了，唯独这行校验漏了 ——
   *   结果在「班级管理 → 阶段方案设计」里，就业部方案一保存就报
   *   「参数「deptCode」太大或超出范围」，新增和编辑都过不去。
   *
   *   用 DeptCode.EMPLOYMENT 而不是字面量 3：部门枚举再变时这里不会又漏。
   */
  deptCode: z.coerce
    .number()
    .int()
    .min(1, '所属部门必填')
    .max(DeptCode.EMPLOYMENT, '所属部门超出范围（只有 初高部 / 大学部 / 就业部）'),
  stages: z
    .array(
      z.object({
        stageName: z.string().trim().min(1, '阶段名称必填').max(50),
        studyMonths: z.coerce.number().int().min(1, '学制（月）必填'),
      }),
    )
    .min(1, '至少添加一个阶段'),
});

stageSchemeRouter.get(
  '/list',
  // ★ 2026-10-22：阶段方案迁到「班级管理」后只给校长 / 学管主任（系统管理员放行）
  checkRole(RoleCode.PRINCIPAL, RoleCode.QUALITY_MGR, RoleCode.ADMIN),
  checkPermission('class:setting:view'),
  validate(z.object({ deptCode: z.coerce.number().int().optional() })),
  wrap(async (req, res) => {
    const q = (req as any).validated as { deptCode?: number };
    res.json(ok(await listSchemes(q.deptCode)));
  }),
);

stageSchemeRouter.post(
  '/add',
  checkRole(RoleCode.PRINCIPAL, RoleCode.QUALITY_MGR, RoleCode.ADMIN),
  checkPermission('class:setting:edit'),
  validate(schemeSaveSchema),
  wrap(async (req, res) => {
    const body = (req as any).validated as StageSchemeSaveInput;
    const { id } = await createScheme(body, req.user?.userId || 'system');

    await writeOpLog({
      module: 'setting',
      bizType: '阶段方案',
      bizId: id,
      opUserId: req.user?.userId,
      opUserName: req.user?.userName,
      opDesc: `新增阶段方案「${body.schemeName}」（${nameOf(DEPT_NAME, body.deptCode)}，${body.stages.length} 个阶段）`,
      afterValue: body as any,
    });

    res.json(ok({ id }, '新增成功'));
  }),
);

stageSchemeRouter.put(
  '/update/:id',
  checkRole(RoleCode.PRINCIPAL, RoleCode.QUALITY_MGR, RoleCode.ADMIN),
  checkPermission('class:setting:edit'),
  validate(schemeSaveSchema),
  wrap(async (req, res) => {
    const { id } = req.params;
    const body = (req as any).validated as StageSchemeSaveInput;
    const before = await getScheme(id);

    await updateScheme(id, body, req.user?.userId || 'system');

    await writeOpLog({
      module: 'setting',
      bizType: '阶段方案',
      bizId: id,
      opUserId: req.user?.userId,
      opUserName: req.user?.userName,
      opDesc: `修改阶段方案「${body.schemeName}」（${nameOf(DEPT_NAME, body.deptCode)}，${body.stages.length} 个阶段）`,
      beforeValue: before as any,
      afterValue: body as any,
    });

    res.json(ok({ id }, '保存成功'));
  }),
);

stageSchemeRouter.delete(
  '/delete/:id',
  checkRole(RoleCode.PRINCIPAL, RoleCode.QUALITY_MGR, RoleCode.ADMIN),
  checkPermission('class:setting:edit'),
  wrap(async (req, res) => {
    const { id } = req.params;
    const before = await getScheme(id);

    await removeScheme(id, req.user?.userId || 'system');

    await writeOpLog({
      module: 'setting',
      bizType: '阶段方案',
      bizId: id,
      opUserId: req.user?.userId,
      opUserName: req.user?.userName,
      opDesc: `删除阶段方案「${before?.schemeName ?? id}」`,
      beforeValue: before as any,
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
