/**
 * ⭐ 财务管理 → 班级管理：缴费信息推送
 *
 * ============================================================
 * 【为什么有它】2026-10-05 联调发现的断链
 * ============================================================
 *   班级管理的「缴费管理」页读的是共享库只读副本
 *     sms_common.t_class_fee_sync
 *   接收口 POST /api/class/fee/sync 早就写好了，但**没有任何一方推过** ——
 *   所以班主任在班级模块永远看不到缴费记录。
 *   本文件补上生产端。
 *
 * 【什么时候推】缴费单**新增 / 变更**就推（用户 2026-10-05 定的口径）：
 *   新增(add) / 回传凭证(attach-voucher) / 核对(verify) / 打回(reject)
 *   ⚠️ 独立服务时可以放在 fee.service 里；合并成单体后为免循环依赖，
 *      改成路由层显式调用（见 routes/fee.route.ts）。
 *
 * ★ 2026-10-06 扩：一份单推**两个收方**（用户需求：三处详情缴费情况统一与财务对齐）
 *   · 大学部（班级管理）→ sms_common.t_class_fee_sync        原链路，不动
 *   · 初高（教学管理）  → sms_class_jh.t_class_fee            新增；只推
 *     dept_code=1（财务页面显示为「二三期」）且学号能在初高库里找到的单
 *
 * 【失败怎么办】**绝不能影响主流程** —— 钱已经收好了，同步失败只是
 *   班主任那边晚一点看到。所以这里只记日志、不抛错（非阻断语义）。
 */

import { db } from '../utils/db';
import { classSync } from '../../utils/classSync';
// ★ 2026-10-25：催费侧「核对失败(6)」由财务「打回(is_rejected)」换算而来，见 urgePayStatusOf
import { PayStatus } from 'shared-types/class-jh';
// ★ P3 切读层：推给初高的两张表（`sms_class_jh.t_class_student` / `t_class_fee`）
//   都已归一 → 读走 tbl()、写走 tblIns()。本文件 `db` 连的是 sms_job，
//   属于**跨库**调用，`tbl()` 会自动补库名前缀（与改造前的 `db('库.表')` 一致）。
import { tbl, tblIns, uniUpdCols } from '../../teaching/shared/uniTable';

/** 缴费单表（与 fee.service.ts 的 FEE_TABLE 一致，这里本地声明避免循环依赖） */
const FEE_TABLE = 't_finance_fee';

/** 日期 → YYYY-MM-DD（class 侧 pay_date / expire_date 只收日期串） */
function dateOnly(v: any): string | null {
  if (!v) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 财务单 → 催费侧展示状态
 *
 * ★ 2026-10-25：财务「打回」在催费侧要显示成「核对失败(6)」。
 *
 *   财务打回（`fee.service.ts::rejectFee`）的做法是把单退回
 *   `pay_status = 2 已缴` + `is_rejected = 1` + `reject_reason`，
 *   等班主任重传凭证。如果催费侧照搬 2，班主任打开催费列表看到的还是
 *   「已缴」，压根不知道截图被打回，也就不会去重传。
 *
 *   所以这里做一次换算：**有打回标记 → 6 核对失败**，其余原样透传。
 *   ⚠️ 6 不算「未结清」：钱确实交过了，只是凭证有问题 →
 *      初高的 `UNPAID_STATUSES` 不含 6，不会被派生成「逾期 4」。
 *   ⚠️ 班主任重新登记缴费后，`voucher-push` 会清掉 `is_rejected`，
 *      催费侧同时把状态推回 2，这条换算自然恢复。
 */
function urgePayStatusOf(row: Record<string, any>): number {
  const raw = Number(row.pay_status ?? PayStatus.UNPAID);
  return row.is_rejected ? PayStatus.REJECTED : raw;
}

/**
 * 缴费单 → class 侧 SyncRequest 的 item
 *
 * ⚠️ 状态码是【数字契约】，两个模块的 PayStatus 取值完全一致（1待缴…5冻结），
 *    只有 2 的中文名不同（财务叫「待核对」、班级叫「已缴」），数值照传即可。
 *
 * ⚠️ 不传 studentId：财务只有学号，收方（班级）会按学号回查自己的学生 ID
 *    （见 class/modules/shared/studentRef.ts）。
 */
export function feeToSyncItem(row: Record<string, any>): Record<string, unknown> {
  const payStatus = urgePayStatusOf(row);
  const amount = Number(row.amount ?? 0);
  return {
    sourceId: String(row.id),
    studentNo: String(row.student_no || ''),
    studentName: String(row.student_name || ''),
    classId: row.class_id || null,
    className: row.class_name || null,
    feeType: Number(row.fee_type),
    amount,
    // 待缴(1) 视为未收到钱；其余状态（待核对/已缴/冻结）按已收金额展示
    paidAmount: payStatus === 1 ? 0 : amount,
    payStatus,
    payDate: dateOnly(row.pay_date),
    expireDate: dateOnly(row.expire_date),
    voucherUrl: row.voucher_url || null,
    payMethod: null,
    // ★ 2026-10-06 新增：费用周期 + 部门，让「缴费情况」三处展示同一套字段
    period: row.period || null,
    deptCode: row.dept_code == null ? null : Number(row.dept_code),
  };
}

/**
 * 把一张缴费单推送到班级管理（幂等：class 侧按 sourceSystem+sourceId 更新）
 *
 * ⚠️ 永不抛错 —— 调用方不需要 try/catch，也不该因为它失败而回滚业务。
 */
export async function syncFeeToClass(feeId: string): Promise<void> {
  if (!feeId) return;
  try {
    const row = (await db(FEE_TABLE).where({ id: feeId, is_deleted: false }).first()) as
      | Record<string, any>
      | undefined;
    if (!row) return; // 单子被删了，没什么可同步的

    const r = await classSync.feeSync([feeToSyncItem(row)]);
    if (!r.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[finance→class] 缴费单 ${feeId} 同步失败（不影响本次操作）：${r.message}`);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[finance→class] 缴费单 ${feeId} 同步异常（不影响本次操作）：${(e as Error).message}`);
  }
}

/* ============================================================
 * ★ 2026-10-06 新增：财务管理 → 教学管理（初高）缴费台账副本
 *   sms_class_jh.t_class_fee
 *
 * 【幂等键（2026-10-23 升级）】
 *   ① source_system + source_id → ② 同学号 + 同费用项 → ③ 新建
 *   （详见 findUrgeTarget 的注释；初高催费页直接读这张表，重复会显示成两行）
 *
 *   为什么要副本：初高「学生详情 · 缴费情况」的取数口径是
 *   **实时为主 + 副本兜底**（用户 2026-10-06 拍板）——
 *   实时查不到财务数据时，页面回落到这张表，所以它必须保持新鲜。
 *
 *   只推两类单，避免污染初高库：
 *     1. dept_code = 1（财务页面的「二三期」＝初高部）
 *     2. 学号能在 sms_class_jh.t_class_student 里回查到
 *        （查得到说明确实是初高的学生；查不到就不推）
 * ============================================================ */

/** 初高缴费台账（兜底副本）—— ★ 已归一 → 写走 tblIns() */
const JH_FEE_TABLE = 't_class_fee';
/** 初高学生表（按学号回查学生 ID 用）—— ★ 已归一 → 读走 tbl() */
const JH_STUDENT_TABLE = 't_class_student';
/** 初高库（本文件的 `db` 连的是 sms_job → 这两个常量让切读层补库名前缀） */
const JH_DB = 'sms_class_jh';
/** 统一表 `edu_stage` 取值：初高 */
const JH_STAGE = 'jh' as const;

/**
 * ★ 切读层连接的**纯类型**转换（不改任何运行时行为）
 *
 * `src/finance/utils/db.ts` 导出的是「带表名校验的函数 `db`」，它把
 * `client` / `transaction` / `raw` 等静态成员挂在函数本身上（有意为之，见该文件注释）。
 * 而 `tbl()` 的第一个参数声明成 `Knex` 实例，只用来「调用取 QueryBuilder」+
 * 读 `client.config.connection.database` —— **这两件事 finance 的 `db` 都满足**。
 * → 运行时 100% 兼容，仅类型层面需要一次断言。
 */
const CONN = db as unknown as Parameters<typeof tbl>[0];

/* ============================================================
 * ★★ 2026-10-23：催费同步的「三级命中」（幂等键升级）
 *
 * 【用户口径】「财务核对完一个人的数据，回写催费时在**原记录上改状态**就行，
 *   没必要再新生成一条已核对的数据。」
 *
 * 【为什么原来会新增一行】
 *   三条同步链路原来只认 `source_system + source_id` **一条**幂等键。
 *   而教学侧的催费台账里，同一学生同一个费用项**本来就有一条行**
 *   （演示数据 `source_system='local'` / 班主任登记 / 大学 `seed`），
 *   财务单同步下来时按这条键匹配不上 → 插成第二行
 *   → 催费页同一个学生的学费出现两条：老的一条「已缴」+ 新的一条「已核对」。
 *   实测（2026-10-23）：初高 27 组、大学 10 组重复，全是这个成因。
 *
 * 【修法】命中顺序改成三级：
 *   ① 本单自己   ：source_system='finance' + source_id=财务单id（原有幂等）
 *   ② 同科目台账 ：同学号 + 同费用项 + **非财务来源**（本次新增，核心）
 *   ③ 都没有     ：才 insert
 *
 * 【为什么②限定「非财务来源」】
 *   同一学生同一费用项确实可能存在**多笔**收款（补缴 / 分期）—— 那是一人多单，
 *   不该由同步逻辑替业务合并（金额相加会串账）。
 *   → ②只对「教学侧自己登记的那条」生效；财务来源的行仍然一人一笔，各自走①。
 *
 * 【②命中后要不要改它的 source】
 *   要。一并更新成本单的 source_system/source_id，等于把这条台账「认领」到财务单上，
 *   下次同步直接走①命中，行为稳定、可追溯。
 * ============================================================ */
async function findUrgeTarget(
  conn: Parameters<typeof tbl>[0],
  dbName: string,
  table: string,
  stage: 'jh' | 'class' | 'job',
  opt: { sourceId: string; studentNo: string; feeType: number },
): Promise<Record<string, any> | null> {
  /**
   * ① 已认领到**本张财务单**的台账（`finance_fee_id` 为准）
   *
   * ★★ 2026-10-25 修：这是就业/大学最常见的形态 —— 催费行本身由财务同步而来，
   *   身上已经有 `finance_fee_id = 本单`，但 `source_id` 可能为空。
   *   原来没有这一级 → 财务核对回写时匹配不到 → **新增一行**
   *   （用户实测：567 那张餐费单核对后变成「已缴 + 已核对」两行）。
   */
  const linked = (await tbl(conn, dbName, table, stage)
    .where({ finance_fee_id: opt.sourceId, is_deleted: false })
    .first()) as Record<string, any> | undefined;
  if (linked) return linked;

  /** ② 老口径：source_system='finance' + source_id=财务单 id（历史数据兼容） */
  const own = (await tbl(conn, dbName, table, stage)
    .where({ source_system: 'finance', source_id: opt.sourceId })
    .first()) as Record<string, any> | undefined;
  if (own) return own;

  /**
   * ③ 同学号 + 同费用项，但**排除已归属其它财务单**的台账
   *
   * ★★ 2026-10-25 修：原来这里写死了 `source_system <> 'finance'`，
   *   把「来源是财务」的台账整片排除 —— 而就业/大学的催费台账恰恰都是财务同步来的，
   *   结果永远匹配不到，每核对一次就多插一行。
   *   正确口径：只排除「已经被**另一张**财务单认领」的行（finance_fee_id/source_id
   *   指向别的单），未被认领或正好指向本单的都能命中。
   */
  const rows = (await tbl(conn, dbName, table, stage)
    .where({ student_no: opt.studentNo, fee_type: opt.feeType, is_deleted: false })
    .where(function (this: any) {
      this.whereNull('finance_fee_id').orWhere('finance_fee_id', opt.sourceId);
    })
    .where(function (this: any) {
      this.whereNull('source_id').orWhere('source_id', opt.sourceId);
    })
    .orderBy('create_time', 'asc')
    .limit(1)) as Record<string, any>[];
  return rows[0] || null;
}

/** 按学号回查初高学生（查不到返回 null；跨库异常也返回 null，不抛） */
async function findJhStudent(studentNo: string): Promise<Record<string, any> | null> {
  if (!studentNo) return null;
  try {
    const row = (await tbl(CONN, JH_DB, JH_STUDENT_TABLE, JH_STAGE)
      .where({ student_no: studentNo, is_deleted: false })
      .first()) as Record<string, any> | undefined;
    return row || null;
  } catch {
    return null;
  }
}

/**
 * 把一张缴费单推送到初高缴费台账
 *
 * ★ 幂等口径（2026-10-23）：命中已有台账就**就地改成财务的状态**，不新增行。
 *
 * ⚠️ 永不抛错 —— 同步失败只是初高页面的兜底数据旧一点，不该影响收款主流程。
 */
export async function syncFeeToJh(feeId: string): Promise<void> {
  if (!feeId) return;
  try {
    const row = (await db(FEE_TABLE).where({ id: feeId, is_deleted: false }).first()) as
      | Record<string, any>
      | undefined;
    if (!row) return;

    // 只推「二三期」（初高部）的单
    if (row.dept_code != null && Number(row.dept_code) !== 1) return;

    // 学号必须是初高的学生，否则不推（避免大学部/咨询试学的单落到初高库）
    const stu = await findJhStudent(String(row.student_no || ''));
    if (!stu) return;

    const now = new Date();
    const feeType = Number(row.fee_type ?? 1);

    /**
     * 财务侧事实 —— **每次同步都覆盖**（update / insert 共用）
     *
     * ⚠️ 刻意不含 `create_time` / `create_by` / `id`：
     *    这三项是「这条台账诞生那一刻」的事实，update 时不该被改
     *    （create_time 被覆成本次同步时间会让「建单时间」失真）。
     */
    const facts: Record<string, any> = {
      update_time: now,
      update_by: 'finance-sync',
      is_deleted: false,
      student_id: stu.id,
      student_no: String(row.student_no || ''),
      student_name: String(stu.student_name || row.student_name || ''),
      class_id: stu.class_id ?? row.class_id ?? null,
      class_name: stu.class_name ?? row.class_name ?? null,
      dept_code: 1,
      fee_type: feeType,
      fee_amount: Number(row.amount ?? 0),
      pay_status: urgePayStatusOf(row),
      expire_date: dateOnly(row.expire_date),
      source_system: 'finance',
      source_id: String(row.id),
    };

    /**
     * ★ 2026-10-23：收款展示字段**只有财务确实有值时才覆盖**。
     *
     * 背景（用户反馈）：核对后缴费状态变了，但「实缴金额 / 缴费方式」这类字段没了。
     * 这几项是班主任在催费页「登记缴费」时写进台账的**本地收款事实**：
     * 财务表只有 `voucher_url` / `pay_date` / `period`，**没有** `pay_method` / `paid_amount`。
     * 照抄 `row.xxx ?? null` 的话，财务那边为空就把本地登记好的信息冲成空 ——
     * 用户看到的就是「钱交过了、方式没了」。
     * 所以这里一律「有值才写」，没值就保持台账原值（不传该列 = update 不碰它）。
     */
    const payDate = dateOnly(row.pay_date);
    if (payDate) facts.pay_date = payDate;
    if (row.voucher_url) facts.voucher_url = row.voucher_url;
    if (row.period) facts.period = row.period;

    /**
     * ★ 2026-10-23：三级命中（详见 findUrgeTarget 的注释）
     *   —— 命中已有台账就「在原地改成财务的状态」，不再新增一行。
     */
    const target = await findUrgeTarget(CONN, JH_DB, JH_FEE_TABLE, JH_STAGE, {
      sourceId: String(row.id),
      studentNo: String(row.student_no || ''),
      feeType,
    });

    if (target) {
      // update 路径必须过 uniUpdCols（列名翻译 + 剔统一表没有的列 + NOT NULL 兜底）
      const patch = await uniUpdCols(CONN, JH_DB, JH_FEE_TABLE, facts);
      await tbl(CONN, JH_DB, JH_FEE_TABLE, JH_STAGE)
        .where({ id: target.id })
        .update(patch as never);
    } else {
      await tblIns(CONN, JH_DB, JH_FEE_TABLE, JH_STAGE, {
        id: String(row.id),
        create_time: now,
        create_by: 'finance-sync',
        ...facts,
      });
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[finance→class-jh] 缴费单 ${feeId} 同步异常（不影响本次操作）：${(e as Error).message}`);
  }
}

/** 批量版（批量核对用）：串行推送，避免一瞬间打爆数据库 */
export async function syncFeesToClass(feeIds: string[]): Promise<void> {
  for (const id of feeIds) {
    // eslint-disable-next-line no-await-in-loop
    await syncFeeToClass(id);
  }
}

/** 批量推送给初高（与 syncFeesToClass 配对，路由层一起调） */
export async function syncFeesToJh(feeIds: string[]): Promise<void> {
  for (const id of feeIds) {
    // eslint-disable-next-line no-await-in-loop
    await syncFeeToJh(id);
  }
}

/* ============================================================
 * ★ 2026-10-22 新增：财务管理 → 大学部**催费副本**
 *   sms_common.t_class_urge_sync （统一表 t_uni_urge, edu_stage='class'）
 *
 * 【★ 为什么必须单独加这一路（这是「催费页缺学生」的根因）】
 *   三部门的催费页各读各的表，而**只有大学这一路的表不是财务同步的目标**：
 *     · 初高催费页 → sms_class_jh.t_class_fee      ← 财务同步直接写这张表 ✅
 *     · 就业催费页 → sms_job.t_job_fee_call          ← 财务同步直接写这张表 ✅
 *     · 大学催费页 → sms_common.t_class_urge_sync    ← ★ 财务同步写的是
 *        t_class_fee_sync（缴费副本），两张表**不联动** ❌
 *   结果：财务建了单、大学催费页却看不到 —— 用户反馈「缴费里有的学生，
 *   催费页里没有」。
 *
 * 【为什么大学要分开两张表】
 *   t_class_fee_sync = **缴费副本**（这学生欠多少、缴没缴）——
 *     供「学生详情 · 缴费情况」和退费可选项目来源用。
 *   t_class_urge_sync = **催费副本**（催了几次、催到哪一步）——
 *     供「催费管理」页用，带 urge_count / last_urge_time / 催收流水。
 *   两者业务含义不同，不能拿一张顶另一张（否则催费页会丢掉催收进度）。
 *
 * 【只推 dept_code = 2（大学部）且学号能在大学学生表回查到的单】
 *   判据与初高、就业两条完全一致（部门对 + 学号能对上）。
 *   ⚠️ 实测：财务大学部学号 U26001~U26018 与教务大学 U26001~U26032
 *      **是同一套**（18/18 全匹配）→ 这一路能真正走通；
 *      而初高财务是 J26xxx、教务初高是 S2026xxx，两套号 → 回查不到就跳过
 *      （这是数据口径问题，不是代码问题，见 4.4 记忆）。
 *
 * 【幂等键（2026-10-23 升级）】
 *   ① source_system='finance' + source_id=财务单id → ② 同学号 + 同费用项 → ③ 新建
 *   ⚠️ 不用 onConflict：统一表 t_uni_urge 没有 (source_system, source_id) 唯一索引
 *      （只有普通索引 idx_source），knex 的 onConflict 在 MySQL 上只认主键
 *      → 会每次同步都插一行新记录。
 * ============================================================ */

/** 大学催费副本（老表名；切读层会自动映射到 t_uni_urge） */
const CLASS_URGE_TABLE = 't_class_urge_sync';
/** 大学学生表（按学号回查学生 ID / 班级 / 班主任） */
const CLASS_STUDENT_TABLE = 't_class_student';
/** 大学库（本文件的 `db` 连的是 sms_finance → 这两个常量让切读层补库名前缀） */
const CLASS_DB = 'sms_class';
/** 催费副本所在库（t_class_urge_sync 本来就住在 sms_common） */
const URGE_DB = 'sms_common';
/** 统一表 edu_stage 取值：大学 */
const CLASS_STAGE = 'class' as const;

/** 按学号回查大学学生（查不到返回 null；跨库异常也返回 null，不抛） */
async function findClassStudent(studentNo: string): Promise<Record<string, any> | null> {
  if (!studentNo) return null;
  try {
    const row = (await tbl(CONN, CLASS_DB, CLASS_STUDENT_TABLE, CLASS_STAGE)
      .where({ student_no: studentNo, is_deleted: false })
      .first()) as Record<string, any> | undefined;
    return row || null;
  } catch {
    return null;
  }
}

/**
 * 把一张财务缴费单推送到大学部催费副本（★ 2026-10-23：命中已有台账就改状态，不新增）
 *
 * ⚠️ 永不抛错 —— 同步失败只是大学催费页少一条数据，不该影响收款主流程。
 */
export async function syncFeeToClassUrge(feeId: string): Promise<void> {
  if (!feeId) return;
  try {
    const row = (await db(FEE_TABLE).where({ id: feeId, is_deleted: false }).first()) as
      | Record<string, any>
      | undefined;
    if (!row) return;

    // 只推「大学部」的单
    if (row.dept_code == null || Number(row.dept_code) !== 2) return;

    // 学号必须是大学的学生，否则不推（避免初高/就业的单混进大学催费页）
    const stu = await findClassStudent(String(row.student_no || ''));
    if (!stu) return;

    const now = new Date();
    // ★ 财务打回 → 6 核对失败（见 urgePayStatusOf）
    const payStatus = urgePayStatusOf(row);

    /**
     * 财务侧事实 —— **每次同步都覆盖**（update / insert 共用）
     *
     * ⚠️ 刻意不含 `create_time` / `create_by` / `id`：见 syncFeeToJh 里的同款说明。
     * ⚠️ 刻意不含 `urge_count`：催收进度是催费表的本地业务状态，
     *    财务改一次单就把「已经催了 3 次」清回 0 会直接打乱班主任的节奏。
     */
    const facts: Record<string, any> = {
      update_time: now,
      update_by: 'finance-sync',
      is_deleted: false,
      student_id: stu.id,
      student_no: String(row.student_no || ''),
      student_name: String(stu.student_name || row.student_name || ''),
      class_id: stu.class_id ?? row.class_id ?? null,
      class_name: stu.class_name ?? row.class_name ?? null,
      head_teacher_id: stu.head_teacher_id ?? null,
      head_teacher_name: stu.head_teacher_name ?? null,
      fee_type: Number(row.fee_type ?? 1),
      amount: Number(row.amount ?? 0),
      expire_date: dateOnly(row.expire_date),
      pay_status: payStatus,
      source_system: 'finance',
      source_id: String(row.id),
      sync_status: 2,
    };

    /**
     * ★ 2026-10-23：三级命中（详见 findUrgeTarget 的注释）
     *   —— 命中已有台账就「在原地改成财务的状态」，不再新增一行。
     *
     * 【为什么仍然不用 onConflict】
     *   统一表 t_uni_urge 没有 (source_system, source_id) 唯一索引（只有普通索引 idx_source），
     *   knex 的 onConflict 在 MySQL 上只认**主键** → 每次同步都会插一行新记录。
     *   → 走「先查后写」，且查询范围扩大到业务键（同学号 + 同费用项）。
     */
    const target = await findUrgeTarget(CONN, URGE_DB, CLASS_URGE_TABLE, CLASS_STAGE, {
      sourceId: String(row.id),
      studentNo: String(row.student_no || ''),
      feeType: Number(row.fee_type ?? 1),
    });

    if (target) {
      // update 路径必须过 uniUpdCols（列名翻译 + 剔统一表没有的列 + NOT NULL 兜底）
      const patch = await uniUpdCols(CONN, URGE_DB, CLASS_URGE_TABLE, facts);
      await tbl(CONN, URGE_DB, CLASS_URGE_TABLE, CLASS_STAGE)
        .where({ id: target.id })
        .update(patch as never);
    } else {
      await tblIns(CONN, URGE_DB, CLASS_URGE_TABLE, CLASS_STAGE, {
        id: String(row.id),
        create_time: now,
        create_by: 'finance-sync',
        ...facts,
        // 催收进度：新建时给初值（催费页要显示催收状态）
        urge_count: 0,
      });
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[finance→class-urge] 缴费单 ${feeId} 同步异常（不影响本次操作）：${(e as Error).message}`);
  }
}

/* ============================================================
 * ★ 2026-10-22 新增：财务管理 → 就业催费单（sms_job.t_job_fee_call）
 *
 * 【为什么加】用户要求「催费单怎么来，就业同初高」——
 *   初高的催费单是财务缴费单自动同步来的，就业原来是**教务人工发起**的。
 *   从这天起就业也改成「财务建单 → 自动同步成催费单」。
 *
 * 【只推 dept_code = 3（就业部）且学号能在 sms_job.t_student_base 回查到的单】
 *   和初高那条同一套判据：部门对 + 学号能对上，才说明确实是这个部门的学生。
 *
 * 【幂等键（2026-10-23 升级）】① source_system + source_id → ② 同学号 + 同费用项 → ③ 新建
 *
 * 【⚠️ 不覆盖本地字段】
 *   财务侧只负责「金额 / 到期日 / 缴费状态 / 凭证 / 缴费信息」这些事实。
 *   催收进度（call_status）、催收原因、处理备注、负责班主任是**本地业务状态**，
 *   同步时不能覆盖 —— 否则每次财务改单都会把「催缴中」打回「待催缴」。
 *   所以 merge 的 payload 里刻意不含这些列。
 * ============================================================ */

/**
 * ★ 2026-10-23 修：**不能再裸写 sms_job 老表**
 *   就业催费页（`routes/feeCall.route.ts`）读的是切读层 → 统一表 `t_uni_fee`(job)。
 *   而这里原来写的是 `sms_job.t_job_fee_call`（老表），属于「切读后写得进、读不回」——
 *   财务核对完，就业催费页一条财务单都看不到（实测 t_uni_fee job 里 finance 来源 0 行）。
 *   → 改用 `tbl` / `tblIns` 切读写。
 */
/** 就业库（让切读层补库名前缀 / 认 edu_stage） */
const JOB_DB = 'sms_job';
/** 就业催费单（老表名；切读层映射到 t_uni_fee） */
const JOB_FEE_TABLE = 't_job_fee_call';
/** 就业学生表（按学号回查学生 ID / 班级 / 班主任） */
const JOB_STUDENT_TABLE = 't_student_base';
/** 统一表 edu_stage 取值：就业 */
const JOB_STAGE = 'job' as const;

/** 按学号回查就业学生（查不到返回 null；跨库异常也返回 null，不抛） */
async function findJobStudent(studentNo: string): Promise<Record<string, any> | null> {
  if (!studentNo) return null;
  try {
    const row = (await tbl(CONN, JOB_DB, JOB_STUDENT_TABLE, JOB_STAGE)
      .where({ student_no: studentNo, is_deleted: false })
      .first()) as Record<string, any> | undefined;
    return row || null;
  } catch {
    return null;
  }
}

/**
 * 把一张财务缴费单推送到就业催费单（★ 2026-10-23：命中已有台账就改状态，不新增）
 *
 * ⚠️ 永不抛错 —— 同步失败只是就业催费页少一条数据，不该影响收款主流程。
 */
export async function syncFeeToJob(feeId: string): Promise<void> {
  if (!feeId) return;
  try {
    const row = (await db(FEE_TABLE).where({ id: feeId, is_deleted: false }).first()) as
      | Record<string, any>
      | undefined;
    if (!row) return;

    // 只推「就业部」的单
    if (row.dept_code == null || Number(row.dept_code) !== 3) return;

    // 学号必须是就业的学生，否则不推
    const stu = await findJobStudent(String(row.student_no || ''));
    if (!stu) return;

    const now = new Date();
    // ★ 财务打回 → 6 核对失败（见 urgePayStatusOf）
    const payStatus = urgePayStatusOf(row);
    const feeType = Number(row.fee_type ?? 2);

    /**
     * 财务侧事实 —— **每次同步都覆盖**（update / insert 共用）
     *
     * ⚠️ 刻意不含 `create_time` / `create_by` / `id`：见 syncFeeToJh 里的同款说明。
     * ⚠️ 刻意不含 `call_status` / `call_reason`：催收进度是教学侧的本地业务状态，
     *    财务改一次单就把「催缴中」打回「待催缴」，班主任的节奏会被冲掉。
     */
    const facts: Record<string, any> = {
      update_time: now,
      update_by: 'finance-sync',
      is_deleted: false,
      fee_type: feeType,
      student_id: stu.id,
      student_no: String(row.student_no || ''),
      student_name: String(stu.student_name || row.student_name || ''),
      class_id: stu.class_id ?? row.class_id ?? null,
      class_name: stu.class_name ?? row.class_name ?? null,
      dept_code: 3,
      head_teacher_id: stu.head_teacher_id ?? null,
      head_teacher_name: stu.head_teacher_name ?? null,
      fee_amount: Number(row.amount ?? 0),
      due_date: dateOnly(row.expire_date),
      // ★ 状态直接搬财务的（与初高同码），前端不再折算
      pay_status: payStatus,
      source_system: 'finance',
      source_id: String(row.id),
    };

    /**
     * ★★ 2026-10-23 修正：**绝不在这里写 `pay_method` / `paid_amount`**。
     *
     * 用户反馈「财务核对后状态变了，但实缴金额、缴费方式这些字段没了」，根因就在这两行：
     *   `pay_method: row.pay_method ?? null` / `paid_amount: row.paid_amount ?? null`
     * 而财务表 `t_finance_fee` **根本没有这两列** → row 上永远是 undefined
     * → 每次财务核对回写都把就业催费单登记好的「微信支付 / 500 元」冲成空。
     *
     * 「钱怎么交的」只有催费侧登记时才写（feeCall.route.ts 的 /voucher），
     * 财务那边没有权威来源，就**不许拿来覆盖**。
     *
     * 其余收款字段同理：财务有值才覆盖，为空时保持台账原值。
     * `pay_remark` 也**不覆盖** —— 它是班主任登记时写的催费备注，
     * 和财务的 `remark`（财务内部备注/核对说明）不是一回事。
     */
    const payDate = dateOnly(row.pay_date);
    if (payDate) facts.pay_date = payDate;
    if (row.voucher_url) facts.voucher_url = row.voucher_url;

    /** ★ 2026-10-23：三级命中（详见 findUrgeTarget 的注释）—— 命中就改状态，不新增 */
    const target = await findUrgeTarget(CONN, JOB_DB, JOB_FEE_TABLE, JOB_STAGE, {
      sourceId: String(row.id),
      studentNo: String(row.student_no || ''),
      feeType,
    });

    if (target) {
      const patch = await uniUpdCols(CONN, JOB_DB, JOB_FEE_TABLE, facts);
      await tbl(CONN, JOB_DB, JOB_FEE_TABLE, JOB_STAGE)
        .where({ id: target.id })
        .update(patch as never);
    } else {
      await tblIns(CONN, JOB_DB, JOB_FEE_TABLE, JOB_STAGE, {
        id: String(row.id),
        create_time: now,
        create_by: 'finance-sync',
        ...facts,
        /**
         * 新建时才补「催收进度」初值。
         * ⚠️ 不能进 facts：update 时它会把班主任改过的催收进度冲掉。
         * ★ 核对失败(6) 也算「已缴清」：钱交过了，只是凭证被打回，
         *   不该在催收进度上显示成「待催缴」。
         */
        call_status:
          payStatus === PayStatus.PAID ||
          payStatus === PayStatus.VERIFIED ||
          payStatus === PayStatus.REJECTED
            ? 3
            : 1,
        call_reason: '财务缴费单同步',
        applicant_id: 'finance-sync',
        applicant_name: '财务同步',
      });
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[finance→job] 缴费单 ${feeId} 同步异常（不影响本次操作）：${(e as Error).message}`);
  }
}

/** 批量推送给就业 */
export async function syncFeesToJob(feeIds: string[]): Promise<void> {
  for (const id of feeIds) {
    // eslint-disable-next-line no-await-in-loop
    await syncFeeToJob(id);
  }
}

/* ============================================================
 * 统一出口：一张缴费单推给**所有**下游
 *   路由层只调这两个，以后再加收方（比如实训）不用到处补调用。
 * ============================================================ */

/** 单条：大学部（班级管理）+ 初高（教学管理）+ 就业（催费单） */
export async function syncFeeToAll(feeId: string): Promise<void> {
  /**
   * ★★ 2026-10-25 修：**按单据所属部门分流**，不再无差别写四张台账。
   *
   *   原来一张单会同时推进初高/大学缴费副本/大学催费副本/就业四处 ——
   *   就业学生的单因此也在「大学部」台账里长出一行（edu_stage=class 的就业学生），
   *   催费页就出现"同一个学生两条"的怪现象。
   *   现在按 `t_finance_fee.dept_code` 只写它该去的台账：
   *     1 初高 → 初高缴费台账
   *     2 大学 → 大学缴费副本 + 大学催费副本（催费页读后者）
   *     3 就业 → 就业催费台账
   *   dept_code 为空的老数据 → 保持原行为（四路都写），避免漏同步。
   */
  let dept = 0;
  try {
    const row = (await db(FEE_TABLE).where({ id: feeId, is_deleted: false }).first()) as
      | Record<string, any>
      | undefined;
    dept = Number(row?.dept_code ?? 0);
  } catch {
    dept = 0;
  }

  if (dept === 1) {
    await syncFeeToJh(feeId);
    return;
  }
  if (dept === 2) {
    await syncFeeToClass(feeId);
    await syncFeeToClassUrge(feeId);
    return;
  }
  if (dept === 3) {
    await syncFeeToJob(feeId);
    return;
  }

  await syncFeeToClass(feeId);
  await syncFeeToJh(feeId);
  await syncFeeToClassUrge(feeId);
  await syncFeeToJob(feeId);
}

/** 批量：串行，避免一瞬间打爆数据库 */
export async function syncFeesToAll(feeIds: string[]): Promise<void> {
  for (const id of feeIds) {
    // eslint-disable-next-line no-await-in-loop
    await syncFeeToAll(id);
  }
}
