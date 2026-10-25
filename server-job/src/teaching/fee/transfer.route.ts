/**
 * 催费「批量上传到财务」· 三部门统一实现
 * ============================================================
 *
 * ★★ 2026-10-22 用户要求：
 *   「催费列表里大学部和就业部也要能上传凭证、批量上传到财务」
 *
 * ★★ 2026-10-23 用户追加两条：
 *   ① 「列表只显示没有上传过的内容」→ 候选接口在 SQL 里过滤掉「已上传到位」的行，
 *      前端拿到的每一条都是可转交的（不再靠「只选未上传过」按钮绕）。
 *   ② 「大学部上传到财务时，财务那里没有对应信息」→ 不是转交没生效，而是财务
 *      「缴费管理」的硬约束是「必须有凭证」，而大学/就业的现金收款本来就没有截图
 *      （登记缴费允许现金不传图）→ 单建出来了但列表里查不到。
 *      修在 `finance/services/fee.service.ts::buildFeeQuery`：已收款的单也进核对台。
 *
 * ★★ 2026-10-25 用户追加：
 *   「重新登记也要出现在批量上传到财务列表中，传到财务」。
 *   原来「已上传」是靠 `finance_fee_id` 一票否决的 → 班主任重新登记（改金额/换截图）
 *   之后那条永远回不来，财务那张单收不到更新。
 *   现在：登记缴费会把 `finance_transfer_time` 清空（`finance_fee_id` 保留）→
 *   候选条件放宽成「没上传过 OR 上传后又重新登记过」，
 *   提交时对这类行走「回写财务原单」，**不会新建第二张单**。
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
import {
  addFee as financeAddFee,
  syncPaymentFromUpstream as financeSyncPayment,
} from '../../finance/services/fee.service';
import { wrap } from '../../utils/wrap';
import { BizError } from '../../middleware/errorHandler';
import { ok } from '../../utils/response';
import { validate } from '../../middleware/validate';
import { checkPayDate, PAY_METHOD_NAME, todayStr } from '../../utils/feeVoucher';
import { writeOpLog } from '../../class-jh/utils/opLog';
import { tbl, uniUpdCols, uniTableOf } from '../shared/uniTable';

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
function isTransferred(row: any, _dept: Dept): boolean {
  /**
   * ★ 2026-10-22 收口：**只认 `finance_fee_id`**，不再拿 source_system 兜底。
   *
   * 原因：初高 `t_class_fee` 的 `source_system='finance'` 现在有**两种**含义 ——
   *   ① 这张单是财务同步过来的（syncFeeToJh 写的）；
   *   ② 2026-10-20 那版「转交成功」时回写的标记。
   * 两者都是 'finance' + source_id，靠它判「是否已转交」会把**所有从财务同步来的单**
   * 都判成已转交 → 一条都转不出去。
   * 现在三部门的单都能从财务同步，这个问题必然暴露，所以统一只看新列。
   */
  return !!row.finance_fee_id;
}

/**
 * 是否「已上传过财务、且之后没再重新登记」
 *
 * ★ 2026-10-25 用户要求：「重新登记也要出现在批量上传到财务列表中，传到财务」。
 *
 *   `finance_fee_id` = 财务那张单是谁（**永久**，转交/回写都靠它防重复建单）；
 *   `finance_transfer_time` = 最近一次把凭证交到财务的时间。
 *
 *   登记缴费（三部门的 `/voucher`）在「该行已有 finance_fee_id」时会把
 *   `finance_transfer_time` 清空 —— 等价于「有新登记、待上传」。
 *   所以只有**两者都有值**才算「已同步到位」，可以从候选里排除；
 *   有 id 但时间为空 = 重新登记过，必须重新出现在列表里。
 */
function isUploadedUpToDate(row: any): boolean {
  return !!row.finance_fee_id && !!row.finance_transfer_time;
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
  /** ★ 2026-10-25：已有财务单、但转交后又重新登记过 → 本次是「更新财务原单」 */
  retransfer: boolean;
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
    // 有财务单、但上传时间是空的 = 重新登记过（见 isUploadedUpToDate 注释）
    retransfer: !!row.finance_fee_id && !row.finance_transfer_time,
    financeFeeId: transferredFinanceId(row, dept),
  };
}

/**
 * 候选查询结果 + 诊断
 *
 * ★ 2026-10-22：加 `scanned`（该部门在册的未删除单据数）与 `paid`（其中已登记缴费的）
 *   是因为「弹窗空着」有二义性 —— 到底是「这个部门一条单都没有」、
 *   「有单但都没登记缴费」、还是「查询出错」？在本地能靠查库分清，
 *   在别人机器上就只能靠猜。把这三个数直接返回给前端展示，谁的环境都能一眼定位。
 */
interface CandidateScan {
  list: TransferCandidate[];
  /** 该部门未删除的单据总数 */
  scanned: number;
  /** 其中「已登记缴费」的条数（= 候选来源） */
  paid: number;
  /** 其中「已经上传过财务」的条数（这些不再出现在弹窗列表里，只用于统计口径） */
  transferred: number;
}

/**
 * 部门 → 候选来源
 *
 * ★★ 2026-10-23：三个部门**一律走 `tbl()`**（→ 统一表 `t_uni_*`）。
 *   原来初高是裸 `jhDb('t_class_fee')`（老表），而催费列表读统一表 ——
 *   结果是「页面刚登记缴费的单，转交弹窗里一条都没有」，
 *   以及「转交成功但 finance_fee_id 写进老表，统一表里仍是未转交 → 重复建单」。
 *
 * ⚠️ 大学 `t_class_urge_sync` 是「三个学段共用一张」的只读副本，靠 `edu_stage` 收窄：
 *    不加过滤会把就业推来的（source_system='edu'）也算成大学部的单，
 *    转交时就会被按「大学部（部门码 2）」建到财务去。
 *
 * ⚠️ 排序第二列不同：初高/大学用 `expire_date`，就业老表只有 `due_date`。
 */
const CAND_SRC: Record<Dept, { conn: any; dbName: string; table: string; dateCol: string }> = {
  jh: { conn: jhDb, dbName: 'sms_class_jh', table: 't_class_fee', dateCol: 'expire_date' },
  class: { conn: commonDb, dbName: 'sms_common', table: 't_class_urge_sync', dateCol: 'expire_date' },
  employ: { conn: jobDb, dbName: 'sms_job', table: 't_job_fee_call', dateCol: 'due_date' },
};

/** 「已登记缴费」判据：有缴费方式或有实缴金额（只说有截图不够，现金本来就没截图） */
const paidCond = (qb: any) => {
  qb.whereNotNull('pay_method').orWhereNotNull('paid_amount');
};

/**
 * 取某部门的转交候选
 *
 * ★★ 2026-10-23 用户要求：**列表只显示还没上传过财务的**。
 *   改造前候选接口把 `transferred=true` 的行也返回，靠前端「只选未上传过」按钮规避，
 *   结果弹窗里一半是躺在那里点不动的历史行，看着像「重复列出」。
 *
 * ★★ 2026-10-25：条件放宽成「没上传过 **或** 上传后又重新登记过」，
 *   见 `isUploadedUpToDate()` 的注释。
 *
 *   `transferred` 计数仍要单独查：弹窗顶部要能说清
 *   「共 66 单 · 已登记缴费 5 单 · 待上传 3 单」，否则「只剩 3 条」会被当成查询漏了数据。
 */
async function candidatesOf(dept: Dept): Promise<CandidateScan> {
  const spec = CAND_SRC[dept];
  const stage = DEPT_STAGE[dept];
  const base0 = () => tbl(spec.conn, spec.dbName, spec.table, stage).where('is_deleted', false);

  const [scannedRow, paidRow, transferredRow, rows] = await Promise.all([
    base0().count({ c: '*' }) as any as Promise<any[]>,
    base0().andWhere(paidCond).count({ c: '*' }) as any as Promise<any[]>,
    // 「已上传到位」= 有财务单 且 上传时间非空（重新登记会把时间清空，见 isUploadedUpToDate）
    base0()
      .andWhere(paidCond)
      .whereNotNull('finance_fee_id')
      .whereNotNull('finance_transfer_time')
      .count({ c: '*' }) as any as Promise<any[]>,
    base0()
      .andWhere(paidCond)
      /**
       * ★ 2026-10-25：候选 = 没上传过 的 + 上传后又重新登记过 的。
       *   原来只 `whereNull('finance_fee_id')` → 重新登记的单调不回来，
       *   用户改完金额/换完截图，财务那张单永远收不到更新。
       */
      .andWhere((qb: any) =>
        qb.whereNull('finance_fee_id').orWhereNull('finance_transfer_time'),
      )
      .orderBy('pay_date', 'desc')
      .orderBy(spec.dateCol, 'desc')
      .limit(500) as any as Promise<any[]>,
  ]);

  const num = (r: any) => Number(r?.[0]?.c ?? 0);
  return {
    list: (rows as any[]).map((r) => base(r, dept)),
    scanned: num(scannedRow),
    paid: num(paidRow),
    transferred: num(transferredRow),
  };
}

const CANDIDATE_LOADERS: Record<Dept, () => Promise<CandidateScan>> = {
  jh: () => candidatesOf('jh'),
  class: () => candidatesOf('class'),
  employ: () => candidatesOf('employ'),
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
    /**
     * 每部门的口径拆解（★ 2026-10-23 加 `transferred`）
     *
     * scanned = 该部门全部未删除单据；paid = 其中已登记缴费的；
     * transferred = 其中已上传过财务的；picked = 本次返回（= 待上传）的条数。
     * 四个数摆出来，「弹窗只剩 3 条」才不会被认为是查询漏数据。
     */
    const stats: Array<{
      dept: Dept;
      deptName: string;
      scanned: number;
      paid: number;
      transferred: number;
      picked: number;
      error?: string;
    }> = [];

    for (const dept of depts) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const scan = await CANDIDATE_LOADERS[dept]();
        list.push(...scan.list);
        stats.push({
          dept,
          deptName: DEPT_NAME[dept],
          scanned: scan.scanned,
          paid: scan.paid,
          transferred: scan.transferred,
          picked: scan.list.length,
        });
      } catch (e: any) {
        const message = e?.message || '查询失败';
        errors.push({ dept, deptName: DEPT_NAME[dept], message });
        stats.push({
          dept,
          deptName: DEPT_NAME[dept],
          scanned: 0,
          paid: 0,
          transferred: 0,
          picked: 0,
          error: message,
        });
      }
    }

    // 按应缴日期倒序（没日期的排最后），与初高老接口的排序口径一致
    list.sort((a, b) => (b.expireDate || '0000').localeCompare(a.expireDate || '0000'));

    res.json(ok({ list, errors, stats }, '查询成功'));
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
      ? tbl(jhDb, 'sms_class_jh', 't_class_fee', 'jh')
      : dept === 'class'
        ? tbl(commonDb, 'sms_common', 't_class_urge_sync', stage)
        : tbl(jobDb, 'sms_job', 't_job_fee_call', stage);

  const rows = (await qb.whereIn('id', ids).where('is_deleted', false)) as any[];
  return new Map(rows.map((r) => [String(r.id), r]));
}

/**
 * 回写「已转交」（三部门各写自己的表）
 *
 * ★★ 2026-10-22 修：这里原来靠 `uniUpdCols` 过滤列，**缺列时是静默剔除的** ——
 *   协作者拉代码后如果没跑 `npm run migrate`（少了 20261022_001 那两列），
 *   表现会是：
 *     · 转交「成功」，财务里也真的建了单；
 *     · 但 `finance_fee_id` 一个字都没写进去 → 刷新后这条还是「未转交」；
 *     · 再点一次又建一张财务单 → **财务里重复记账**。
 *   而且从头到尾没有任何报错，最难查。
 *
 *   所以这里**先显式检查列存在**，缺列直接抛明确错误 ——
 *   宁可这次转交失败（并且说清原因），也不能「钱转了、标记没写」。
 */
async function assertTransferColumns(conn: any, srcDb: string, table: string): Promise<void> {
  /**
   * ★ 2026-10-23：必须检查**实际写入的那张表**。
   *   统一表模式下 `t_class_fee` / `t_job_fee_call` 都写 `sms_common.t_uni_fee`，
   *   只查老表 = 查了个不影响结果的地方：
   *   老表有列 → 放行 → `uniUpdCols` 按统一表列过滤 → 缺列被静默剔除
   *   → 又回到「转交成功、标记没写、财务重复记账」，防护形同虚设。
   *   （`t_uni_fee` 少了这两列，就是 20261023_001 这个迁移补的。）
   */
  const uni = uniTableOf(srcDb, table);
  const targetConn: any = uni ? commonDb : conn;
  const targetSchema = uni ? 'sms_common' : srcDb;
  const targetTable = uni || table;

  const rows = await targetConn
    .select(targetConn.raw('COLUMN_NAME AS name'))
    .from(targetConn.raw('information_schema.COLUMNS'))
    .whereRaw('TABLE_SCHEMA = ? AND TABLE_NAME = ?', [targetSchema, targetTable]);
  const have = new Set(rows.map((r: any) => r.name));
  const missing = ['finance_fee_id', 'finance_transfer_time'].filter((c) => !have.has(c));
  if (missing.length) {
    throw new Error(
      `${targetSchema}.${targetTable} 缺列 ${missing.join(' / ')} —— 在 server-job 目录执行 npm run migrate 后重启后端再试`,
    );
  }
}

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
    // ★ 2026-10-23：同样走 tbl() + uniUpdCols（原来写老表 → 页面读不到，会重复建单）
    await assertTransferColumns(jhDb, 'sms_class_jh', 't_class_fee');
    const cols = await uniUpdCols(jhDb, 'sms_class_jh', 't_class_fee', {
      ...patch,
      source_system: 'finance',
      source_id: financeFeeId,
    });
    await tbl(jhDb, 'sms_class_jh', 't_class_fee', 'jh').where({ id }).update(cols as never);
    return;
  }

  const stage = DEPT_STAGE[dept];
  const conn: any = dept === 'class' ? commonDb : jobDb;
  const srcDb = dept === 'class' ? 'sms_common' : 'sms_job';
  const table = dept === 'class' ? 't_class_urge_sync' : 't_job_fee_call';

  // ★ 先确认列真的存在（见函数头注释：缺列时必须报错，不能静默丢）
  await assertTransferColumns(conn, srcDb, table);

  // 再过 uniUpdCols：切到统一表模式时目标表的列可能不一致
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
    /** 财务里已有这张单 → 回写（只更新凭证/方式/实缴，不新建）的条数 */
    let voucherOnly = 0;
    /** 其中「重新登记后再次上传」的条数（★ 2026-10-25） */
    let retransferred = 0;

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
      if (isUploadedUpToDate(row)) {
        skipped.push({ dept, deptName, feeId, reason: '已上传过财务，重新登记后才会再出现' });
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
        /**
         * 这张催费单对应的**财务缴费单**（有 → 回写那张单，没有 → 在财务新建）
         *
         * ★ 2026-10-22：原来只判大学部。现在三部门的单都从财务同步
         *   （催费单怎么来，就业同初高），所以三部门统一按 source_system/source_id 认。
         * ★ 2026-10-25：**优先用 `finance_fee_id`**。
         *   重新登记的行 `source_system` 可能是 'edu'（就业推来的），
         *   只看 source_* 会判成「财务没有这张单」→ 再建一张 → 财务重复记账。
         *   `finance_fee_id` 是上次转交时记下的那张财务单，最可靠。
         */
        const existFinanceId = String(
          row.finance_fee_id ||
            (row.source_system === 'finance' && row.source_id ? row.source_id : '') ||
            '',
        );

        if (existFinanceId) {
          /**
           * ★ 2026-10-22：三部门统一 —— 财务里本来就有这张单，就**把登记缴费的结果回写给它**
           *   （不在财务新建、不产生重复账）。
           *
           * 回写内容：凭证（有才写）+ 缴费方式 + 实缴金额 + 缴费日期。
           *   · 原来只调 attachVoucher，只能补凭证 —— 现金收的款没有截图，那一支根本走不通；
           *   · 现在走 syncPaymentFromUpstream，现金也能把「方式+实缴」记到财务备注里。
           */
          await financeSyncPayment(
            existFinanceId,
            {
              voucherUrl: row.voucher_url || null,
              payMethodName: method == null ? null : (PAY_METHOD_NAME[method] ?? ''),
              paidAmount: Number(row.paid_amount ?? row.fee_amount ?? row.amount ?? 0) || null,
              payDate,
              remark: row.pay_remark || null,
            },
            operator,
          );
          await markTransferred(dept, feeId, existFinanceId, operator.userId);
          voucherOnly += 1;
          // 上次已经传过这张财务单 → 这次是重新登记后的更新
          if (row.finance_fee_id) retransferred += 1;
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
        `批量转交财务：提交 ${uniq.length} 条，成功 ${success}（其中回写财务原单 ${voucherOnly}，` +
        `含重新登记后再传 ${retransferred}），跳过 ${skipped.length}，失败 ${failed.length}`,
      afterValue: { success, voucherOnly, retransferred, skipped: skipped.length, failed: failed.length },
    });

    const parts = [`成功 ${success} 条`];
    if (voucherOnly) {
      parts.push(
        `其中 ${voucherOnly} 条财务已有原单、已更新凭证信息` +
          (retransferred ? `（含 ${retransferred} 条重新登记后重传）` : ''),
      );
    }
    if (skipped.length) parts.push(`跳过 ${skipped.length} 条`);
    if (failed.length) parts.push(`失败 ${failed.length} 条`);

    res.json(
      ok(
        { total: uniq.length, success, voucherOnly, retransferred, skipped, failed },
        `转交完成：${parts.join('，')}`,
      ),
    );
  }),
);
