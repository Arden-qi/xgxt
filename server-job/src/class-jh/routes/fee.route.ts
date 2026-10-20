/**
 * 催费管理路由（教学管理初高）
 *
 * 覆盖：list（含 remainDays/isUrgent，按配置阈值）/ export / share（写 notify + 文案）/ notify/list。
 * 表：t_class_fee、t_class_fee_notify。
 * 挂载：/api/class/fee。
 */

import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { BizCode, FEE_TYPE_NAME, PAY_STATUS_NAME, SHARE_CHANNEL_NAME } from 'shared-types/class-jh';
import { FeeType, PayStatus, ShareChannel } from 'shared-types/class-jh';
import { ok, page } from '../utils/response';
import { db } from '../utils/db';
import { wrap } from '../utils/wrap';
import { nameOf } from '../utils/enumName';
import { getNumberSetting } from '../utils/setting';
import { boolFlag } from '../../utils/query';
import { validate } from '../middleware/validate';
import { checkPermission } from '../middleware/auth';
import { BizError } from '../middleware/errorHandler';

export const feeRouter = Router();

const FEE_TABLE = 't_class_fee';
const NOTIFY_TABLE = 't_class_fee_notify';
const STUDENT_TABLE = 't_class_student';

/** 剩余天数（到期日 - 今天）；无到期日返回 null */
function calcRemainDays(expireDate: any): number | null {
  if (!expireDate) return null;
  const d = new Date(expireDate);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / (24 * 3600 * 1000));
}

/** 未结清状态 */
const UNPAID_STATUSES = [PayStatus.UNPAID, PayStatus.FROZEN];

/**
 * 缴费台账行 → 实体（含派生 remainDays/isUrgent）
 *
 * ★ 2026-10-20 用户要求：列表补「学生手机号 / 家长手机号」。
 *   t_class_fee 是**缴费流水表，不存联系方式**（已核 information_schema：
 *   21 列里没有任何 phone 列），联系方式只在学生表 t_class_student 上，
 *   → 由调用方按 studentId 批量补齐（见 fetchStudentContacts），
 *   这里只负责把补好的值透传出去，缺学生档时给 null（前端显示 —）。
 */
function toFee(r: any, remindDays: number) {
  const remainDays = calcRemainDays(r.expire_date);
  const isUrgent =
    UNPAID_STATUSES.includes(r.pay_status) && remainDays !== null && remainDays <= remindDays;
  return {
    feeId: r.id,
    studentId: r.student_id,
    studentNo: r.student_no,
    studentName: r.student_name,
    classId: r.class_id,
    className: r.class_name,
    deptCode: r.dept_code,
    phone: r.phone ?? null,
    parentPhone: r.parent_phone ?? null,
    feeType: r.fee_type,
    feeTypeName: nameOf(FEE_TYPE_NAME, r.fee_type),
    feeAmount: r.fee_amount,
    payStatus: r.pay_status,
    payStatusName: nameOf(PAY_STATUS_NAME, r.pay_status),
    payDate: r.pay_date,
    expireDate: r.expire_date,
    remainDays,
    isUrgent,
    voucherUrl: r.voucher_url,
  };
}

/**
 * 批量取学生的**档案信息**：`studentId → { 学号/姓名/班级/部门/电话 }`
 *
 * ⚠️ 两条纪律：
 *   ① 一次 IN 查询就够（不要左连 —— `t_class_fee` 与 `t_class_student` 同名列
 *      一大把：student_no / student_name / class_id / class_name / dept_code /
 *      is_deleted…，左连后不加表前缀会直接 ambiguous column）；
 *   ② 按 500 分片：导出场景可能一次上千个 studentId，一条超长 IN 会撞
 *      max_allowed_packet 报错。去重 + 剔空值同样不能省。
 *
 * ★ 2026-10-20 扩展：原来只取 phone / parent_phone（列表补联系方式），
 *   现在**顺带把学号、姓名、班级、部门一起取回来**，用于覆盖单据上的快照列。
 *   用户口径「学生档案有的字段按学生档案的数据走」—— 学生换班后，
 *   缴费单上显示的班级必须是档案里的新班级，而不是开单那天的老班级。
 *   `t_class_fee` 自己那份 class_name 仍留在库里做财务追溯，只是不再拿来显示。
 *
 * ⚠️ 加 `is_deleted = 0`：档案里已删除的学生不再算作有效档案
 *   （「学生档案没有的，其他模块也不能有」）。这类单据的姓名/班级
 *   会保留开单快照，不会突然变成空白。
 */
async function fetchStudentContacts(studentIds: Array<string | null | undefined>) {
  const map: Record<
    string,
    {
      studentNo: string | null;
      studentName: string | null;
      classId: string | null;
      className: string | null;
      deptCode: number | null;
      phone: string | null;
      parentPhone: string | null;
    }
  > = {};
  const ids = [...new Set(studentIds.filter((x): x is string => !!x))];
  for (let i = 0; i < ids.length; i += 500) {
    const rows = await db(STUDENT_TABLE)
      .where('is_deleted', false)
      .whereIn('id', ids.slice(i, i + 500))
      .select('id', 'phone', 'parent_phone', 'student_no', 'student_name', 'class_id', 'class_name', 'dept_code');
    for (const r of rows as any[]) {
      map[r.id] = {
        studentNo: r.student_no || null,
        studentName: r.student_name || null,
        classId: r.class_id || null,
        className: r.class_name || null,
        deptCode: r.dept_code == null ? null : Number(r.dept_code),
        phone: r.phone || null,
        parentPhone: r.parent_phone || null,
      };
    }
  }
  return map;
}

/**
 * ★ 2026-10-20：把档案值合并进列表行（档案有值才覆盖，档案空则保留开单快照）
 *
 * 「按档案走」不等于「档案空就清空」：实训/历史数据里学生档案可能缺列，
 * 这时把单据上原有的信息保留下来，比显示成「—」有用。
 */
function mergeArchive<T extends Record<string, any>>(
  list: T[],
  archive: Awaited<ReturnType<typeof fetchStudentContacts>>,
): T[] {
  return list.map((x) => {
    const s = archive[x.studentId];
    if (!s) return x;
    return {
      ...x,
      studentNo: s.studentNo || x.studentNo,
      studentName: s.studentName || x.studentName,
      classId: s.classId ?? x.classId,
      className: s.className ?? x.className,
      deptCode: s.deptCode ?? x.deptCode,
      // 联系方式本来就只有档案有，档案没有就是 null（前端显示「—」）
      phone: s.phone,
      parentPhone: s.parentPhone,
    };
  });
}

/**
 * ★ 2026-10-20：取「档案当前在该班」的学生 id
 *
 * 用途：班级筛选要「单据快照 + 档案现状」两边命中。
 * 列表显示的班级已经改成档案最新值，如果筛选还只看单据上的 class_id，
 * 学生换班后会出现「列表显示 B 班、按 B 班筛却一条都出不来」。
 */
async function studentIdsInClass(classId: string): Promise<string[]> {
  const rows = (await db(STUDENT_TABLE)
    .where({ is_deleted: false, class_id: classId })
    .select('id')) as any[];
  return [...new Set(rows.map((r) => String(r.id || '')).filter(Boolean))];
}

/** ★ 2026-10-20：按档案的姓名/学号搜人（改名后按新名字也能搜到老单据） */
async function studentIdsByKeyword(keyword: string): Promise<string[]> {
  const rows = (await db(STUDENT_TABLE)
    .where('is_deleted', false)
    .andWhere((b) => {
      b.where('student_name', 'like', `%${keyword}%`).orWhere('student_no', 'like', `%${keyword}%`);
    })
    .select('id')) as any[];
  return [...new Set(rows.map((r) => String(r.id || '')).filter(Boolean))];
}

/* ============================================================
 * 1. 催费列表
 *   GET /api/class/fee/list
 * ============================================================ */

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(100).default(20),
  classId: z.string().optional(),
  feeType: z.coerce.number().int().optional(),
  payStatus: z.coerce.number().int().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  // ★ 2026-10-20：改用显式布尔解析（z.coerce.boolean 会把 "false" 当 true，
  //   前端把「仅看紧急」关掉后仍然只出紧急的）
  isUrgent: boolFlag.optional(),
  keyword: z.string().optional(),
});

feeRouter.get(
  '/list',
  checkPermission('class:fee:view'),
  validate(listSchema),
  wrap(async (req, res) => {
    const q = (req as any).validated as z.infer<typeof listSchema>;
    const remindDays = await getNumberSetting('feeRemindDays');

    const query = db(FEE_TABLE).where('is_deleted', false);
    // ★ 2026-10-20：班级筛选同时认「单据快照」和「档案现状」（学生换班后仍能筛到）
    if (q.classId) {
      const inClass = await studentIdsInClass(q.classId);
      query.andWhere((qb) => {
        qb.where('class_id', q.classId);
        if (inClass.length) qb.orWhereIn('student_id', inClass);
      });
    }
    if (q.feeType) query.andWhere('fee_type', q.feeType);
    if (q.payStatus) query.andWhere('pay_status', q.payStatus);
    if (q.startDate) query.andWhere('expire_date', '>=', q.startDate);
    if (q.endDate) query.andWhere('expire_date', '<=', q.endDate);
    if (q.keyword) {
      const hit = await studentIdsByKeyword(q.keyword);
      query.andWhere((qb) => {
        qb.where('student_no', 'like', `%${q.keyword}%`).orWhere('student_name', 'like', `%${q.keyword}%`);
        if (hit.length) qb.orWhereIn('student_id', hit);
      });
    }

    // isUrgent 为派生值，先取全量（当前筛选）再内存过滤分页
    const allRows = await query.clone().select('*').orderBy('expire_date', 'asc');
    let list = allRows.map((r: any) => toFee(r, remindDays));
    if (q.isUrgent !== undefined) list = list.filter((x) => x.isUrgent === q.isUrgent);

    const total = list.length;
    const paged = list.slice((q.page - 1) * q.size, q.page * q.size);

    // ★ 催费次数（2026-10-19 用户要求）：按学生聚合催费记录条数（notify 按学生维度催缴，
    //    只查本页行，一次 groupBy，代价可忽略）
    const stuIds = [...new Set(paged.map((x: any) => x.studentId))].filter(Boolean);
    let urgeCountMap: Record<string, number> = {};
    if (stuIds.length) {
      const counts = await db(NOTIFY_TABLE)
        .where('is_deleted', false)
        .whereIn('student_id', stuIds)
        .groupBy('student_id')
        .select('student_id', db.raw('count(*) as urge_count'));
      urgeCountMap = Object.fromEntries(counts.map((c: any) => [c.student_id, Number(c.urge_count)]));
    }
    const withCount = paged.map((x: any) => ({ ...x, urgeCount: urgeCountMap[x.studentId] || 0 }));

    // ★ 档案信息（2026-10-20）：缴费表不自带手机号，且姓名/班级是开单快照 ——
    //   按本页学生批量取档案，一次性把联系方式和学生属性都对齐到档案最新值
    const contacts = await fetchStudentContacts(withCount.map((x: any) => x.studentId));
    const withContact = mergeArchive(withCount, contacts);

    res.json(page(withContact, total, q));
  }),
);

/* ============================================================
 * 2. 催费导出
 *   GET /api/class/fee/export
 * ============================================================ */

feeRouter.get(
  '/export',
  checkPermission('class:fee:export'),
  validate(listSchema),
  wrap(async (req, res) => {
    const q = (req as any).validated as z.infer<typeof listSchema>;
    const remindDays = await getNumberSetting('feeRemindDays');

    const query = db(FEE_TABLE).where('is_deleted', false);
    // ★ 2026-10-20：筛选口径与列表完全一致（班级/关键字都认档案现状）
    if (q.classId) {
      const inClass = await studentIdsInClass(q.classId);
      query.andWhere((qb) => {
        qb.where('class_id', q.classId);
        if (inClass.length) qb.orWhereIn('student_id', inClass);
      });
    }
    if (q.feeType) query.andWhere('fee_type', q.feeType);
    if (q.payStatus) query.andWhere('pay_status', q.payStatus);
    // ★ 2026-10-20：导出补应缴日期筛选 —— 列表筛完导出却是全量，用户会以为筛选没生效
    if (q.startDate) query.andWhere('expire_date', '>=', q.startDate);
    if (q.endDate) query.andWhere('expire_date', '<=', q.endDate);
    if (q.keyword) {
      const hit = await studentIdsByKeyword(q.keyword);
      query.andWhere((qb) => {
        qb.where('student_no', 'like', `%${q.keyword}%`).orWhere('student_name', 'like', `%${q.keyword}%`);
        if (hit.length) qb.orWhereIn('student_id', hit);
      });
    }

    const rows = await query.clone().select('*').orderBy('expire_date', 'asc');
    let list = rows.map((r: any) => toFee(r, remindDays));
    if (q.isUrgent !== undefined) list = list.filter((x) => x.isUrgent === q.isUrgent);

    // ★ 档案信息（2026-10-20）：导出与列表同口径，按 500 分片批量取档案
    const contacts = await fetchStudentContacts(list.map((x: any) => x.studentId));
    const withContact = mergeArchive(list, contacts);

    res.json(ok(withContact));
  }),
);

/* ============================================================
 * 3. 催费推送（生成站内消息 + 可复制文案）
 *   POST /api/class/fee/share
 * ============================================================ */

const shareSchema = z.object({
  studentId: z.string().min(1, '学生必填'),
  feeType: z.coerce.number().int().min(1).max(5, '缴费类型不正确'),
  shareChannel: z.coerce.number().int().min(1).max(3, '触达渠道不正确'),
  remark: z.string().max(500).optional(),
});

feeRouter.post(
  '/share',
  checkPermission('class:fee:add'),
  validate(shareSchema),
  wrap(async (req, res) => {
    const body = (req as any).validated as z.infer<typeof shareSchema>;

    const stu = await db(STUDENT_TABLE).where({ id: body.studentId, is_deleted: false }).first();
    if (!stu) throw new BizError(BizCode.STUDENT_NOT_FOUND, '学生不存在');

    // 取最近一笔该类型缴费快照
    const fee = await db(FEE_TABLE)
      .where({ student_id: stu.id, fee_type: body.feeType, is_deleted: false })
      .orderBy('expire_date', 'desc')
      .first();

    const feeAmount = fee?.fee_amount ?? null;
    const expireDate = fee?.expire_date ?? null;
    const amountYuan = feeAmount === null ? '—' : (feeAmount / 100).toFixed(2);

    // 生成可复制文案
    const shareText =
      `【缴费提醒】${stu.student_name} 同学（学号 ${stu.student_no}）：` +
      `您的「${nameOf(FEE_TYPE_NAME, body.feeType)}」${feeAmount === null ? '' : `应缴 ${amountYuan} 元`}` +
      `${expireDate ? `，到期日 ${String(expireDate).slice(0, 10)}` : ''}，请尽快完成缴费。` +
      `${body.remark ? `备注：${body.remark}` : ''}`;

    const notifyId = randomUUID();
    const now = new Date();
    await db(NOTIFY_TABLE).insert({
      id: notifyId,
      student_id: stu.id,
      student_no: stu.student_no,
      student_name: stu.student_name,
      class_id: stu.class_id ?? null,
      class_name: stu.class_name ?? null,
      fee_type: body.feeType,
      fee_amount: feeAmount,
      expire_date: expireDate,
      share_channel: body.shareChannel,
      notify_user_id: req.user?.userId ?? null,
      notify_user_name: req.user?.userName ?? null,
      notify_time: now,
      remark: body.remark ?? null,
      is_deleted: false,
      create_time: now,
      create_by: req.user?.userId || 'system',
    });

    res.json(ok({ notifyId, shareText, shareChannelName: nameOf(SHARE_CHANNEL_NAME, body.shareChannel) }, '推送成功'));
  }),
);

/* ============================================================
 * 4. 催费记录列表
 *   GET /api/class/fee/notify/list
 * ============================================================ */

const notifyListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(100).default(20),
  studentId: z.string().optional(),
});

feeRouter.get(
  '/notify/list',
  checkPermission('class:fee:view'),
  validate(notifyListSchema),
  wrap(async (req, res) => {
    const q = (req as any).validated as z.infer<typeof notifyListSchema>;
    const query = db(NOTIFY_TABLE).where('is_deleted', false);
    if (q.studentId) query.andWhere('student_id', q.studentId);

    const [{ total }] = await query.clone().count({ total: '*' });
    const rows = await query
      .clone()
      .select('*')
      .orderBy('notify_time', 'desc')
      .limit(q.size)
      .offset((q.page - 1) * q.size);

    const list = rows.map((n: any) => ({
      notifyId: n.id,
      studentId: n.student_id,
      studentNo: n.student_no,
      studentName: n.student_name,
      classId: n.class_id,
      className: n.class_name,
      feeType: n.fee_type,
      feeTypeName: nameOf(FEE_TYPE_NAME, n.fee_type),
      feeAmount: n.fee_amount,
      expireDate: n.expire_date,
      shareChannel: n.share_channel,
      shareChannelName: nameOf(SHARE_CHANNEL_NAME, n.share_channel),
      notifyUserId: n.notify_user_id,
      notifyUserName: n.notify_user_name,
      notifyTime: n.notify_time,
      remark: n.remark,
    }));

    // ★ 2026-10-20：催费记录上的姓名/班级是**推送当时的快照**，
    //   这里按档案最新值覆盖，和列表、导出口径一致（学生换班后不会显示老班级）
    const archive = await fetchStudentContacts(list.map((x: any) => x.studentId));

    res.json(page(mergeArchive(list, archive), Number(total), q));
  }),
);

export default feeRouter;
