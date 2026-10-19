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
import { validate } from '../middleware/validate';
import { checkPermission } from '../middleware/auth';
import { BizError } from '../middleware/errorHandler';
// ★ P4 切读层：本文件三张初高表（t_class_fee / t_class_fee_notify /
//   t_class_student）均已归一，全部走 tbl()/tblIns() 路由；
//   开关关时与原实现逐字节等价。
import { tbl, tblIns } from '../../teaching/shared/uniTable';

export const feeRouter = Router();

const FEE_TABLE = 't_class_fee';
const NOTIFY_TABLE = 't_class_fee_notify';
const STUDENT_TABLE = 't_class_student';

/** ★ 统一表 edu_stage 取值（本路由只服务初高） */
const DB = 'sms_class_jh';
const STAGE = 'jh' as const;

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

/** 缴费台账行 → 实体（含派生 remainDays/isUrgent） */
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
  isUrgent: z.coerce.boolean().optional(),
  keyword: z.string().optional(),
});

feeRouter.get(
  '/list',
  checkPermission('class:fee:view'),
  validate(listSchema),
  wrap(async (req, res) => {
    const q = (req as any).validated as z.infer<typeof listSchema>;
    const remindDays = await getNumberSetting('feeRemindDays');

    const query = tbl(db, DB, FEE_TABLE, STAGE).where('is_deleted', false);
    if (q.classId) query.andWhere('class_id', q.classId);
    if (q.feeType) query.andWhere('fee_type', q.feeType);
    if (q.payStatus) query.andWhere('pay_status', q.payStatus);
    if (q.startDate) query.andWhere('expire_date', '>=', q.startDate);
    if (q.endDate) query.andWhere('expire_date', '<=', q.endDate);
    if (q.keyword) {
      query.andWhere((qb) => {
        qb.where('student_no', 'like', `%${q.keyword}%`).orWhere('student_name', 'like', `%${q.keyword}%`);
      });
    }

    // isUrgent 为派生值，先取全量（当前筛选）再内存过滤分页
    const allRows = await query.clone().select('*').orderBy('expire_date', 'asc');
    let list = allRows.map((r: any) => toFee(r, remindDays));
    if (q.isUrgent !== undefined) list = list.filter((x) => x.isUrgent === q.isUrgent);

    const total = list.length;
    const paged = list.slice((q.page - 1) * q.size, q.page * q.size);
    res.json(page(paged, total, q));
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

    const query = tbl(db, DB, FEE_TABLE, STAGE).where('is_deleted', false);
    if (q.classId) query.andWhere('class_id', q.classId);
    if (q.feeType) query.andWhere('fee_type', q.feeType);
    if (q.payStatus) query.andWhere('pay_status', q.payStatus);
    if (q.keyword) {
      query.andWhere((qb) => {
        qb.where('student_no', 'like', `%${q.keyword}%`).orWhere('student_name', 'like', `%${q.keyword}%`);
      });
    }

    const rows = await query.clone().select('*').orderBy('expire_date', 'asc');
    let list = rows.map((r: any) => toFee(r, remindDays));
    if (q.isUrgent !== undefined) list = list.filter((x) => x.isUrgent === q.isUrgent);

    res.json(ok(list));
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

    const stu = await tbl(db, DB, STUDENT_TABLE, STAGE).where({ id: body.studentId, is_deleted: false }).first();
    if (!stu) throw new BizError(BizCode.STUDENT_NOT_FOUND, '学生不存在');

    // 取最近一笔该类型缴费快照
    const fee = await tbl(db, DB, FEE_TABLE, STAGE)
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
    await tblIns(db, DB, NOTIFY_TABLE, STAGE, {
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
    const query = tbl(db, DB, NOTIFY_TABLE, STAGE).where('is_deleted', false);
    if (q.studentId) query.andWhere('student_id', q.studentId);

    const [{ total }] = (await query.clone().count({ total: '*' })) as Array<{ total: number }>;
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

    res.json(page(list, Number(total), q));
  }),
);

export default feeRouter;
