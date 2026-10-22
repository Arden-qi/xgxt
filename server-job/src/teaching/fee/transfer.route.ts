/**
 * 催费「批量上传到财务」· 三部门统一实现
 * ============================================================
 *
 * ★★ 2026-10-22 用户要求：
 *   「催费列表里大学部和就业部也要能上传凭证、批量上传到财务」
 *
 * 【改造前是什么样】
 *   只有初高能做：`class-jh/routes/fee.route.ts` 的 `/transfer/candidates` + `/transfer`
 *     · 候选接口只读 `sms_class_jh.t_class_fee`
 *     · 提交里硬判断 `if (Number(row.dept_code ?? 1) !== 1) 跳过`
 *     · 前端 FeeList.vue 的按钮只在 `dept === 'jh' || dept === 'all'` 时显示
 *   → 大学部、就业部即使有「已登记缴费」的单，页面上也没有转交入口。
 *
 * 【本文件怎么做的】
 *   三个部门各自读自己的催费表，归一成同一份候选结构，再按部门走不同的落库口径：
 *
 *     部门    来源表                              部门码  转交口径
 *     ─────  ───────────────────────────────────  ──────  ────────────────────────────
 *     初高    sms_class_jh.t_class_fee             1       财务没这张单 → addFee 新建
 *     大学    sms_common.t_class_urge_sync         2       ★ 见表下注释（可能更新凭证）
 *     就业    sms_job.t_job_fee_call               3       财务没这张单 → addFee 新建
 *
 * 【★ 大学部为什么要「按财务单号判重」】（用户 2026-10-22 拍板的口径）
 *   `t_class_urge_sync` 本身就是**财务推给大学的只读副本** ——
 *   `source_system='finance' && source_id` 就是财务侧那张缴费单的 id。
 *   如果照初高的做法一律 `addFee` 新建，财务里同一笔钱会出现两条单（原单 + 转交单），
 *   对账时必然重复。
 *   所以：
 *     · 有 `source_id`（财务里本来就有这张单）→ 调财务 `attachVoucher` **只补凭证**，不新建
 *     · 没有（就业催费单推过来的、source_system='edu'）→ 和初高一样新建
 *
 * 【为什么不用 source_system / source_id 记「已转交」】
 *   那两列在大学/就业两张表上已经有别的含义（同步来源），
 *   所以三张表统一用新增的 `finance_fee_id` / `finance_transfer_time` 记转交状态。
 *   初高的老数据靠 `source_system='finance' + source_id` 兼容识别（见 isTransferred）。
 */

import { Router } from 'express';
import { z } from 'zod';
import { PayStatus } from 'shared-types/class-jh';
import { db as jobDb } from '../../utils/db';
import { db as jhDb } from '../../class-jh/utils/db';
import { commonDb } from '../../class/db';
import { addFee as financeAddFee, attachVoucher as financeAttachVoucher } from '../../finance/services/fee.service';
import { wrap } from '../../utils/wrap';
import { BizError } from '../../middleware/errorHandler';
import { ok } from '../../utils/response';
import { validate } from '../../middleware/validate';
import { checkPayDate, PAY_METHOD_NAME, todayStr } from '../../utils/feeVoucher';
import { writeOpLog } from '../../class-jh/utils/opLog';
import { tbl, uniUpdCols } from '../shared/uniTable';

export const teachingFeeRouter = Router();

/* ============================================================
 * 0. 常量与部门口径
 * ============================================================ */

/** 前端传的部门码 → 内部学段（与催费页下拉的三个值一致） */
const DEPTS = ['jh', 'class', 'employ'] as const;
type Dept = (typeof DEPTS)[number];

const DEPT_NAME: Record<Dept, string> = {
  jh: '初高',
  class: '大学',
  employ: '就业',
};

/** 部门 → 财务部门码（与 shared-types 的 DeptCode 对齐：1 初高部 / 2 大学部 / 3 就业部） */
const DEPT_CODE: Record<Dept, number> = { jh: 1, class: 2, employ: 3 };

/** 部门 → 学段码（统一表路由层 edu_stage 用） */
const DEPT_STAGE: Record<Dept, 'jh' | 'class' | 'job'> = { jh: 'jh', class: 'class', employ: 'job' };

/** 一次最多转交多少条（与初高老接口保持一致） */
const MAX_TRANSFER = 200;

/**
 * 日期取值统一转成 `YYYY-MM-DD`
 *
 * ★ 2026-10-22 踩过的坑：三个部门的 knex 连接**不都配了 `dateStrings`** ——
 *   `class-jh/utils/db.ts` 和 `class/db.ts` 配了，但主工程 `utils/db.ts`（sms_job）**没配**，
 *   所以就业表的 `pay_date` / `due_date` 查出来是 JS `Date` 对象。
 *   直接 `String(d).slice(0, 10)` 会得到 `"Tue Oct 21"`，
 *   过 `checkPayDate()` 就报「缴费时间格式应为 YYYY-MM-DD」——
 *   在就业部的转交上表现为「一条也转不过去」，而且原因看着像是数据填错了。
 */
function toDateStr(v: any): string {
  if (v == null || v === '') return '';
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  // 已经是 'YYYY-MM-DD' 或 'YYYY-MM-DD HH:mm:ss'
  return String(v).slice(0, 10);
}

/**
 * 是否已转交财务
 *
 * ★ 口径**按部门不同**，不能一锅端（2026-10-22 踩过）：
 *   · 初高 `t_class_fee` 是本地台账，`source_system='finance' + source_id`
 *     正是 2026-10-20 那版转交成功后写的标记 → 兼容识别老数据；
 *   · 大学 `t_class_urge_sync` 的 `source_system` 是**同步来源**
 *     （'finance' = 财务推来的、'edu' = 就业推来的），
 *     它等于 'finance' 只是说明「这张单本来就在财务」，**不是**「已转交」；
 *     把它当已转交会把整个大学部的候选全判成已转交，一条也转不出去。
 *   · 就业 `t_job_fee_call` 没有那两列，只看 finance_fee_id。
 *
 *   所以：新列 `finance_fee_id` 是三个部门唯一权威的判重依据，
 *        `source_system` 那条只是初高的**历史兼容**。
 */
function isTransferred(row: any, dept: Dept): boolean {
  if (row.finance_fee_id) return true;
  if (dept === 'jh') return row.source_system === 'finance' && !!row.source_id;
  return false;
}

/** 已转交时用于展示/回填的财务单 id（`source_id` 只有初高能当兜底，理由同上） */
function transferredFinanceId(row: any, dept: Dept): string {
  if (row.finance_fee_id) return String(row.finance_fee_id);
  return dept === 'jh' ? String(row.source_id ?? '') : '';
}

/* ============================================================
 * 1. 三个部门的候选查询（统一结构）
 * ============================================================ */

/**
 * 统一候选行
 *
 * ⚠️ 金额一律是「分」。前端展示时 /100。
 * `feeId` 用原始表 id，不加前缀 —— 前端聚合列表里那些 `urge:` / `call:` 前缀
 * 是列表接口拼的（为了区分数据源），转交这里由 `dept` 字段区分，不需要前缀。
 */
interface TransferCandidate {
  feeId: string;
  dept: Dept;
  deptName: string;
  studentNo: string;
  studentName: string;
  className: string;
  feeType: number | null;
  /** 应缴金额（分） */
  feeAmount: number;
  /** 实缴金额（分） */
  paidAmount: number | null;
  payMethod: number | null;
  payMethodName: string;
  payDate: string | null;
  /** 应缴/到期日期 */
  expireDate: string | null;
  voucherUrl: string | null;
  payRemark: string | null;
  transferred: boolean;
  /** 已转交时：财务侧缴费单 id */
  financeFeeId: string;
}

function base(row: any, dept: Dept): TransferCandidate {
  const method = row.pay_method == null ? null : Number(row.pay_method);
  return {
    feeId: String(row.id),
    dept,
    deptName: DEPT_NAME[dept],
    studentNo: String(row.student_no ?? ''),
    studentName: String(row.student_name ?? ''),
    className: String(row.class_name ?? ''),
    feeType: row.fee_type == null ? null : Number(row.fee_type),
    feeAmount: Number(row.fee_amount ?? row.amount ?? 0),
    paidAmount: row.paid_amount == null ? null : Number(row.paid_amount),
    payMethod: method,
    payMethodName: method == null ? '' : (PAY_METHOD_NAME[method] ?? ''),
    payDate: row.pay_date ? toDateStr(row.pay_date) : null,
    expireDate: row.expire_date
      ? toDateStr(row.expire_date)
      : row.due_date
        ? toDateStr(row.due_date)
        : null,
    voucherUrl: row.voucher_url || null,
    payRemark: row.pay_remark || null,
    transferred: isTransferred(row, dept),
    financeFeeId: transferredFinanceId(row, dept),
  };
}

/** 初高：sms_class_jh.t_class_fee */
async function candidatesJh(): Promise<TransferCandidate[]> {
  const rows = await jhDb('t_class_fee')
    .where('is_deleted', false)
    .andWhere((qb) => {
      qb.whereNotNull('pay_method').orWhereNotNull('paid_amount');
    })
    .orderBy('pay_date', 'desc')
    .orderBy('expire_date', 'desc')
    .limit(500);
  return rows.map((r: any) => base(r, 'jh'));
}

/**
 * 大学：sms_common.t_class_urge_sync
 *
 * ⚠️ 这张表是「三个学段共用一张」的只读副本，不加过滤会把就业推来的
 *    （source_system='edu'）也算成大学部的单。列表接口 `/api/class/urge/list`
 *    同样不过滤，所以「全部部门」视图里本来就会把同一笔显示两次
 *    （大学一行 `urge:`、就业一行 `call:`）—— 这是改造前就有的现象。
 *    转交这里必须收窄，否则就业的单会被按「大学部（部门码 2）」建到财务去。
 */
async function candidatesClass(): Promise<TransferCandidate[]> {
  const qb = tbl(commonDb, 'sms_common', 't_class_urge_sync', 'class');
  const rows = await qb
    .where('is_deleted', false)
    .andWhere((sub: any) => {
      sub.whereNotNull('pay_method').orWhereNotNull('paid_amount');
    })
    .orderBy('pay_date', 'desc')
    .orderBy('expire_date', 'desc')
    .limit(500);
  return (rows as any[]).map((r) => base(r, 'class'));
}

/** 就业：sms_job.t_job_fee_call */
async function candidatesEmploy(): Promise<TransferCandidate[]> {
  const qb = tbl(jobDb, 'sms_job', 't_job_fee_call', 'job');
  const rows = await qb
    .where('is_deleted', false)
    .andWhere((sub: any) => {
      sub.whereNotNull('pay_method').orWhereNotNull('paid_amount');
    })
    .orderBy('pay_date', 'desc')
    .orderBy('due_date', 'desc')
    .limit(500);
  return (rows as any[]).map((r) => base(r, 'employ'));
}

const CANDIDATE_LOADERS: Record<Dept, () => Promise<TransferCandidate[]>> = {
  jh: candidatesJh,
  class: candidatesClass,
  employ: candidatesEmploy,
};

/* ============================================================
 * 2. 候选列表
 *   GET /api/teaching/fee/transfer/candidates?dept=jh|class|employ|all
 * ============================================================ */

teachingFeeRouter.get(
  '/transfer/candidates',
  wrap(async (req, res) => {
    const raw = String(req.query.dept ?? 'all');
    const depts: Dept[] =
      raw === 'all' ? [...DEPTS] : DEPTS.includes(raw as Dept) ? [raw as Dept] : [];

    if (!depts.length) {
      throw new BizError(40000, `dept 只能是 ${DEPTS.join(' / ')} / all`);
    }

    /**
     * ★ 逐个部门单独 try/catch，不让一个部门失败拖垮整张弹窗。
     *   这里**不静默**：失败原因会放进 `errors` 一起返回，前端能提示
     *   「XX 部无权限 / 查询失败」，而不是给用户一个空表格。
     */
    const list: TransferCandidate[] = [];
    const errors: Array<{ dept: Dept; deptName: string; message: string }> = [];

    for (const dept of depts) {
      try {
        // eslint-disable-next-line no-await-in-loop
        list.push(...(await CANDIDATE_LOADERS[dept]()));
      } catch (e: any) {
        errors.push({ dept, deptName: DEPT_NAME[dept], message: e?.message || '查询失败' });
      }
    }

    // 按应缴日期倒序（没日期的排最后），与初高老接口的排序口径一致
    list.sort((a, b) => (b.expireDate || '0000').localeCompare(a.expireDate || '0000'));

    res.json(ok({ list, errors }, '查询成功'));
  }),
);

/* ============================================================
 * 3. 批量转交
 *   POST /api/teaching/fee/transfer
 *   body: { items: [{ dept, feeId }] }
 * ============================================================ */

const transferSchema = z.object({
  items: z
    .array(
      z.object({
        dept: z.enum(DEPTS),
        feeId: z.string().min(1),
      }),
    )
    .min(1, '请先勾选要转交的记录')
    .max(MAX_TRANSFER, `一次最多转交 ${MAX_TRANSFER} 条`),
});

/** 按部门批量取原始单（一次查完，避免逐条 select） */
async function loadRows(dept: Dept, ids: string[]): Promise<Map<string, any>> {
  if (!ids.length) return new Map();
  const stage = DEPT_STAGE[dept];
  const qb =
    dept === 'jh'
      ? jhDb('t_class_fee')
      : dept === 'class'
        ? tbl(commonDb, 'sms_common', 't_class_urge_sync', stage)
        : tbl(jobDb, 'sms_job', 't_job_fee_call', stage);

  const rows = (await qb.whereIn('id', ids).where('is_deleted', false)) as any[];
  return new Map(rows.map((r) => [String(r.id), r]));
}

/** 回写「已转交」（三部门各写自己的表） */
async function markTransferred(
  dept: Dept,
  id: string,
  financeFeeId: string,
  operatorId: string,
): Promise<void> {
  const patch: any = {
    finance_fee_id: financeFeeId,
    finance_transfer_time: new Date(),
    update_time: new Date(),
    update_by: operatorId || null,
  };

  if (dept === 'jh') {
    // 初高表有 source_system / source_id（老的判重口径），一并写上保持兼容
    await jhDb('t_class_fee')
      .where({ id })
      .update({ ...patch, source_system: 'finance', source_id: financeFeeId });
    return;
  }

  const stage = DEPT_STAGE[dept];
  const conn = dept === 'class' ? commonDb : jobDb;
  const srcDb = dept === 'class' ? 'sms_common' : 'sms_job';
  const table = dept === 'class' ? 't_class_urge_sync' : 't_job_fee_call';

  // ★ 必须过 uniUpdCols：切到统一表模式时目标表的列可能不一致，
  //   不过滤会「更新成功但列被静默丢弃」（项目铁律⑨）
  const cols = await uniUpdCols(conn, srcDb, table, patch);
  await tbl(conn, srcDb, table, stage).where({ id }).update(cols as never);
}

teachingFeeRouter.post(
  '/transfer',
  validate(transferSchema),
  wrap(async (req, res) => {
    const { items } = (req as any).validated as z.infer<typeof transferSchema>;
    const operator = {
      userId: req.user?.userId ?? '',
      userName: req.user?.userName ?? '',
    };

    // 同一个单可能被重复勾选 → 去重（按 dept + feeId）
    const uniq: Array<{ dept: Dept; feeId: string }> = [];
    const seen = new Set<string>();
    for (const it of items) {
      const key = `${it.dept}:${it.feeId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      uniq.push(it);
    }

    const skipped: Array<{ dept: Dept; deptName: string; feeId: string; reason: string }> = [];
    const failed: Array<{ dept: Dept; deptName: string; feeId: string; reason: string }> = [];
    let success = 0;
    /** 大学部：财务里已有单 → 只补凭证的条数（单独统计，便于验收时区分） */
    let voucherOnly = 0;

    // 按部门分组，一次查完
    const grouped = new Map<Dept, string[]>();
    for (const it of uniq) {
      const arr = grouped.get(it.dept) ?? [];
      arr.push(it.feeId);
      grouped.set(it.dept, arr);
    }

    const rowMaps = new Map<Dept, Map<string, any>>();
    for (const [dept, ids] of grouped) {
      // eslint-disable-next-line no-await-in-loop
      rowMaps.set(dept, await loadRows(dept, ids));
    }

    for (const { dept, feeId } of uniq) {
      const deptName = DEPT_NAME[dept];
      const row: any = rowMaps.get(dept)?.get(feeId);

      if (!row) {
        skipped.push({ dept, deptName, feeId, reason: '催费单不存在或已删除' });
        continue;
      }
      if (row.pay_method == null && row.paid_amount == null) {
        skipped.push({ dept, deptName, feeId, reason: '还没登记缴费，没有凭证可转交' });
        continue;
      }
      if (isTransferred(row, dept)) {
        skipped.push({ dept, deptName, feeId, reason: '已转交过财务' });
        continue;
      }

      /* ---------- 凭证时间合法性（三部门同一套规则） ---------- */
      const payDate = toDateStr(row.pay_date) || todayStr();
      const dateErr = checkPayDate(payDate);
      if (dateErr) {
        skipped.push({ dept, deptName, feeId, reason: dateErr });
        continue;
      }

      try {
        const method = row.pay_method == null ? null : Number(row.pay_method);
        /* 财务缴费表没有 pay_method 列 → 「方式·备注」一起写进 remark，
           财务核对时才知道这笔钱怎么收的（与初高老口径一致） */
        const remarkParts = [
          method == null ? '' : (PAY_METHOD_NAME[method] ?? ''),
          row.pay_remark || '',
        ].filter(Boolean);
        /**
         * 备注末尾补一句凭证情况。
         * ⚠️ 原初高写的是「（现金收取，无凭证）」—— 但没截图的不一定是现金
         *   （实测「微信支付 + 没截图」也会被这么标，财务看了会以为学生给的现金）。
         *   改成按事实说：现金 → 说明现金本来没有凭证；非现金 → 标「未上传凭证」。
         */
        const noVoucherNote = row.voucher_url
          ? ''
          : method === 3
            ? '（现金收取，无凭证）'
            : '（未上传凭证）';
        const remark = `${remarkParts.join('·')}${noVoucherNote}`;

        /**
         * ★ 大学部：财务里本来就有这张单 → 只补凭证，不新建
         *   见文件头「★ 大学部为什么要按财务单号判重」。
         */
        const existFinanceId =
          dept === 'class' && row.source_system === 'finance' ? String(row.source_id || '') : '';

        if (existFinanceId && row.voucher_url) {
          await financeAttachVoucher(existFinanceId, String(row.voucher_url), undefined, operator);
          await markTransferred(dept, feeId, existFinanceId, operator.userId);
          voucherOnly += 1;
          success += 1;
          continue;
        }

        // 其余情况（含大学部没有财务原单的、就业部全部、初高全部）→ 财务建单
        const financeFeeId = await financeAddFee(
          {
            studentId: row.student_id,
            studentNo: row.student_no,
            studentName: row.student_name,
            classId: row.class_id ?? undefined,
            className: row.class_name ?? undefined,
            deptCode: DEPT_CODE[dept],
            feeType: Number(row.fee_type ?? 1),
            // 转交的是「实收金额」：没填实缴时退回应缴
            amount: Number(row.paid_amount ?? row.fee_amount ?? row.amount ?? 0),
            payStatus: PayStatus.PAID, // 已收款，等财务核对
            payDate,
            expireDate: row.expire_date
              ? toDateStr(row.expire_date)
              : row.due_date
                ? toDateStr(row.due_date)
                : undefined,
            period: row.period ?? undefined,
            voucherUrl: row.voucher_url || undefined,
            headTeacherId: row.head_teacher_id ?? undefined,
            headTeacherName: row.head_teacher_name ?? undefined,
            remark: remark || undefined,
          },
          operator,
        );

        await markTransferred(dept, feeId, financeFeeId, operator.userId);
        success += 1;
      } catch (e: any) {
        failed.push({ dept, deptName, feeId, reason: e?.message || '转交失败' });
      }
    }

    await writeOpLog({
      module: 'fee',
      bizType: '转交财务',
      opUserId: operator.userId || undefined,
      opUserName: operator.userName || undefined,
      opDesc:
        `批量转交财务：提交 ${uniq.length} 条，成功 ${success}（其中只补凭证 ${voucherOnly}），` +
        `跳过 ${skipped.length}，失败 ${failed.length}`,
      afterValue: { success, voucherOnly, skipped: skipped.length, failed: failed.length },
    });

    const parts = [`成功 ${success} 条`];
    if (voucherOnly) parts.push(`其中 ${voucherOnly} 条财务已有原单、只补了凭证`);
    if (skipped.length) parts.push(`跳过 ${skipped.length} 条`);
    if (failed.length) parts.push(`失败 ${failed.length} 条`);

    res.json(ok({ total: uniq.length, success, voucherOnly, skipped, failed }, `转交完成：${parts.join('，')}`));
  }),
);
