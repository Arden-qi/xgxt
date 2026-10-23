import { Router } from 'express';
import { z } from 'zod';
import { ExamContentType, ExamType, PermAction } from 'shared-types/class';
import { db } from '../../db';
import { Errors, ok, pageData } from '../../http/response';
import { pageQuerySchema, q, validate } from '../../lib/validate';
import { baseInsert, baseUpdate, notDeleted, paginate } from '../../lib/repo';
import { requirePerm } from '../../lib/permGuard';
import { rowToCamel, rowsToCamel } from '../../lib/case';
import { ExamContentTypeName, ExamTypeName } from '../../lib/dict';
import { applyDataScope, assertClassAccess } from '../../middleware/dataScope';
import { wrap } from '../../middleware/error';
import { tbl, tblIns, tblInsTrx, uniUpdCols } from '../../../teaching/shared/uniTable';
import { actorId, actorIds, isActor } from '../../../utils/actor';

/**
 * 考试管理（原型菜单「教务运行 / 考试管理」）
 *
 * 关键设计：
 *  - 考试内容项（笔试 / 机试 / 面试 / 其他）是**子表**，一次考试可有多个内容项与满分
 *  - 自定义字段（如「作品评分」「质素分析」）来自 `t_class_exam_field`，可维护
 *  - 综合成绩的计算在成绩模块（grade），这里只管考试本身
 */
export const examRouter = Router();

const SRC = 'sms_class';
const STAGE = 'class' as const;

/* 第 4 期 · 第 9 批（考试域）：全部裸访问改走统一表路由层 */
const EXAM = () => tbl(db, SRC, 't_class_exam', STAGE);
const CONTENT = () => tbl(db, SRC, 't_class_exam_content', STAGE);
const FIELD = () => tbl(db, SRC, 't_class_exam_field', STAGE);
const GRADE = () => tbl(db, SRC, 't_class_grade', STAGE);
const CLS = () => tbl(db, SRC, 't_class_info', STAGE);

const contentSchema = z.object({
  examContentType: z.coerce.number().int('内容类型不能为空'),
  fullScore: z.coerce.number().int().min(1, '满分必须大于 0').default(100),
  contentName: z.string().optional().nullable(),
});

const addSchema = z.object({
  examName: z.string().min(1, '考试名称不能为空'),
  examType: z.coerce.number().int('考试类型不能为空'),
  examDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '考试时间格式应为 YYYY-MM-DD')
    .optional(),
  classId: z.string().optional().nullable(),
  attendeeCount: z.coerce.number().int().optional().nullable(),
  contents: z.array(contentSchema).default([]),
});

/**
 * @openapi
 * /api/class/exam/add:
 *   post:
 *     tags: [教务运行]
 *     summary: 新建考试
 *     description: |
 *       考试类型见字典 4.x：1 月考 / 2 质素考核 / 3 阶段考核 / 4 结业考试 / 5 其他。
 *       内容项 `examContentType = 4`（其他）时必须给 `contentName`（如「作品评分」）。
 *       不传 `attendeeCount` 时按班级人数自动取。
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [examName, examType]
 *             properties:
 *               examName: { type: string, example: 2026级一阶段阶段考核 }
 *               examType: { type: integer, example: 3 }
 *               examDate: { type: string, example: '2026-09-30' }
 *               classId: { type: string }
 *               contents:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     examContentType: { type: integer, example: 1 }
 *                     fullScore: { type: integer, example: 100 }
 *                     contentName: { type: string }
 *     responses:
 *       200: { description: 新建成功，返回考试ID }
 */
examRouter.post(
  '/add',
  requirePerm('exam', PermAction.ADD),
  validate({ body: addSchema }),
  wrap(async (req, res) => {
    const user = req.user!;
    const b = req.body as z.infer<typeof addSchema>;

    if (!ExamTypeName[b.examType]) throw Errors.param('考试类型取值不合法，请从字典中选择');
    for (const c of b.contents) {
      if (!ExamContentTypeName[c.examContentType]) {
        throw Errors.param(`考试内容类型 ${c.examContentType} 不合法`);
      }
      if (c.examContentType === ExamContentType.OTHER && !c.contentName?.trim()) {
        throw Errors.required('选择「其他」内容类型时的内容名称');
      }
    }

    let className: string | null = null;
    let attendeeCount = b.attendeeCount ?? 0;
    if (b.classId) {
      assertClassAccess(user, b.classId, '该班级');
      const cls = (await notDeleted(CLS()).where('id', b.classId).first()) as
        | Record<string, unknown>
        | undefined;
      if (!cls) throw Errors.classNotFound();
      className = cls.class_name as string;
      if (b.attendeeCount === undefined || b.attendeeCount === null) {
        attendeeCount = Number(cls.student_count ?? 0);
      }
    }

    const examId = baseInsert(user).id as string;
    await db.transaction(async (trx) => {
      await tblInsTrx(trx, SRC, 't_class_exam', STAGE, {
        ...baseInsert(user),
        id: examId,
        exam_name: b.examName,
        exam_type: b.examType,
        creator_id: actorId(user),
        creator_name: user.userName,
        exam_date: b.examDate ?? new Date().toISOString().slice(0, 10),
        class_id: b.classId ?? null,
        class_name: className,
        attendee_count: attendeeCount,
      } as never);

      for (const c of b.contents) {
        await tblInsTrx(trx, SRC, 't_class_exam_content', STAGE, {
          ...baseInsert(user),
          exam_id: examId,
          exam_content_type: c.examContentType,
          full_score: c.fullScore,
          content_name: c.contentName ?? null,
        } as never);
      }
    });

    return ok(res, { examId }, '考试已创建');
  }),
);

const listSchema = z.object({
  ...pageQuerySchema.shape,
  classId: z.string().optional(),
  examType: z.coerce.number().int().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  keyword: z.string().optional(),
});

/**
 * @openapi
 * /api/class/exam/list:
 *   get:
 *     tags: [教务运行]
 *     summary: 考试列表
 *     responses:
 *       200: { description: 分页列表（含内容项） }
 */
examRouter.get(
  '/list',
  validate({ query: listSchema }),
  wrap(async (req, res) => {
    const user = req.user!;
    const query = q<z.infer<typeof listSchema>>(req);

    const base = EXAM();
    notDeleted(base);
    applyDataScope(base, user, { classIdColumn: 'class_id' });
    if (query.classId) base.where('class_id', query.classId);
    if (query.examType) base.where('exam_type', query.examType);
    if (query.startDate) base.where('exam_date', '>=', query.startDate);
    if (query.endDate) base.where('exam_date', '<=', query.endDate);
    if (query.keyword) base.where('exam_name', 'like', `%${query.keyword}%`);
    base.orderBy('exam_date', 'desc');

    const paged = await paginate(base, query, async (qb) => {
      const rows = (await qb) as Array<Record<string, unknown>>;
      const ids = rows.map((r) => r.id as string);
      const contents = ids.length
        ? ((await notDeleted(CONTENT()).whereIn('exam_id', ids)) as Array<
            Record<string, unknown>
          >)
        : [];
      const byExam = new Map<string, Array<Record<string, unknown>>>();
      for (const c of contents) {
        const key = c.exam_id as string;
        if (!byExam.has(key)) byExam.set(key, []);
        byExam.get(key)!.push(c);
      }
      return rows.map((r) => ({
        ...rowToCamel<Record<string, unknown>>(r),
        examTypeName: ExamTypeName[r.exam_type as number] ?? '未知',
        contents: (byExam.get(r.id as string) ?? []).map((c) => ({
          ...rowToCamel<Record<string, unknown>>(c),
          examContentTypeName: ExamContentTypeName[c.exam_content_type as number] ?? '未知',
        })),
      }));
    });

    return ok(res, pageData(paged.total, paged.page, paged.size, paged.list), '查询成功');
  }),
);

/**
 * @openapi
 * /api/class/exam/detail:
 *   get:
 *     tags: [教务运行]
 *     summary: 考试详情（含内容项与该场考试成绩）
 *     parameters:
 *       - { in: query, name: id, schema: { type: string }, required: true }
 *     responses:
 *       200: { description: 详情 }
 */
examRouter.get(
  '/detail',
  validate({ query: z.object({ id: z.string().min(1, '缺少考试ID') }) }),
  wrap(async (req, res) => {
    const user = req.user!;
    const { id } = q<{ id: string }>(req);

    const row = (await notDeleted(EXAM()).where('id', id).first()) as
      | Record<string, unknown>
      | undefined;
    if (!row) throw Errors.param('考试不存在');
    assertClassAccess(user, row.class_id as string | null, '该考试');

    const [contents, grades] = await Promise.all([
notDeleted(CONTENT()).where('exam_id', id),
notDeleted(GRADE()).where('exam_id', id).orderBy('student_no'),
    ]);

    return ok(
      res,
      {
        exam: {
          ...rowToCamel<Record<string, unknown>>(row),
          examTypeName: ExamTypeName[row.exam_type as number] ?? '未知',
        },
        contents: rowsToCamel(contents as Array<Record<string, unknown>>).map((c) => ({
          ...c,
          examContentTypeName: ExamContentTypeName[c.examContentType as number] ?? '未知',
        })),
        grades: rowsToCamel(grades as Array<Record<string, unknown>>),
      },
      '查询成功',
    );
  }),
);

/* ------------------------------ 自定义字段 ------------------------------ */

/**
 * @openapi
 * /api/class/exam/field/list:
 *   get:
 *     tags: [教务运行]
 *     summary: 考试自定义字段列表（如「作品评分」「质素分析」）
 *     responses:
 *       200: { description: 字段列表 }
 */
examRouter.get(
  '/field/list',
  wrap(async (_req, res) => {
    const rows = (await notDeleted(FIELD()).orderBy('create_time', 'asc')) as Array<
      Record<string, unknown>
    >;
    return ok(res, rowsToCamel(rows), '查询成功');
  }),
);

/**
 * @openapi
 * /api/class/exam/field/add:
 *   post:
 *     tags: [教务运行]
 *     summary: 新增考试自定义字段
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fieldKey]
 *             properties:
 *               fieldKey: { type: string, example: 作品评分 }
 *               fieldType: { type: string, example: 数值 }
 *               defaultValue: { type: string }
 *     responses:
 *       200: { description: 新增成功 }
 */
examRouter.post(
  '/field/add',
  requirePerm('exam', PermAction.ADD),
  validate({
    body: z.object({
      fieldKey: z.string().min(1, '字段名不能为空'),
      fieldType: z.string().default('数值'),
      defaultValue: z.string().optional().nullable(),
    }),
  }),
  wrap(async (req, res) => {
    const user = req.user!;
    const b = req.body as { fieldKey: string; fieldType: string; defaultValue?: string | null };

    const dup = await notDeleted(FIELD()).where('field_key', b.fieldKey).first();
    if (dup) throw Errors.param(`字段「${b.fieldKey}」已存在`);

    const id = baseInsert(user).id as string;
    // ★ 必须用 tblIns()：它负责补 edu_stage，裸 insert() 切读时必炸
    //   Field 'edu_stage' doesn't have a default value
    await tblIns(db, SRC, 't_class_exam_field', STAGE, {
      ...baseInsert(user),
      id,
      field_key: b.fieldKey,
      field_type: b.fieldType,
      default_value: b.defaultValue ?? null,
      source: '自定义字段',
    } as never);
    return ok(res, { fieldId: id }, '字段已新增');
  }),
);

/** 删除自定义字段（逻辑删除） */
examRouter.post(
  '/field/delete',
  requirePerm('exam', PermAction.DELETE),
  validate({ body: z.object({ fieldId: z.string().min(1, '缺少字段ID') }) }),
  wrap(async (req, res) => {
    const user = req.user!;
    const { fieldId } = req.body as { fieldId: string };
    const row = await notDeleted(FIELD()).where('id', fieldId).first();
    if (!row) throw Errors.param('字段不存在');
    await FIELD()
      .where({ id: fieldId })
      .update(await uniUpdCols(db, SRC, 't_class_exam_field', { is_deleted: 1, ...baseUpdate(user) }));
    return ok(res, { fieldId }, '字段已删除');
  }),
);
