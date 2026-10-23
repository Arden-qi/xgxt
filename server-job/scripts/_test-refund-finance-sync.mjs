/**
 * 自检：退费「校长审批通过 → 推送财务 → 财务出款 → 自动回写上游」整条链
 * ============================================================
 *
 * 【它为什么存在】
 *   用户 2026-10-22 反馈（截图）：财务「退费管理」详情里，审批流转记录
 *   **除了第一条「班主任提交申请」，后面全是「待处理」**，看着像单子没推过来。
 *   排查结论：推送本身是通的，是 `applyRefund()` 只写了 `apply_time`，
 *   `pushed_time` 从未落库，而前端时间轴**纯按时间戳渲染** → 全变「待处理」。
 *
 * 【用户给的验收口径（原话）】
 *   ① 「只要这个退费审批校长同意了就推送财务退费管理就行」
 *   ② 「自动回写（推荐）」—— 财务出款后自动写回上游，上游不再人工点「财务登记出款」
 *   ③ 「每一个费用项都要在财务那里对应一行」（主单 + 明细行）
 *
 * 【断言清单】
 *   1. 校长审批通过后，财务侧**确实建了单**，且来源三元组写对（幂等键）
 *   2. `pushed_time` / `principal_approve_time` 非空 —— 时间轴不再全「待处理」
 *   3. 费用项**一项一行**，金额与教学侧明细一致（合计 = 主单金额）
 *   4. 重复推送**幂等**：同 (source_module, source_refund_id) 不再建第二条
 *   5. 内部回写接口**鉴权**：无 x-internal-token → 401
 *   6. 财务出款后**自动回写**上游：财务单号 / 出款时间落到教学退费单
 *   7. 财务 list / detail 都带回 `items`（前端展开行与详情明细表要的数据）
 *
 * 【前提】
 *   后端在跑（8004）。没跑会自动拉起（与其它自检脚本同款）。
 *   跑完自动清理本次夹具。
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  BASE,
  buildRow,
  conn,
  killAll,
  login,
  makeChecker,
  mirrorRow,
  req,
  startServices,
} from './_e2e-lib.mjs';

const require = createRequire(import.meta.url);
const jwt = require('jsonwebtoken');

const BE = 'http://127.0.0.1:8004';
const API = `${BASE}/api/teaching/refund`;
const FIN = `${BASE}/api/finance/refund`;

const { check, summary } = makeChecker();

/* ============================================================
 * 服务身份 token（复刻 consult/services/service-token.ts）
 *   财务 `/apply` `/pay` 要 `finance:refund:apply|pay`；
 *   服务身份（role=ROLE_SERVICE）在财务 auth 里直接放行。
 * ============================================================ */

function readEnv(key, fallback) {
  try {
    const txt = readFileSync(new URL('../.env', import.meta.url), 'utf8');
    const line = txt.split(/\r?\n/).find((l) => l.trim().startsWith(`${key}=`));
    if (!line) return fallback;
    return line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '') || fallback;
  } catch {
    return fallback;
  }
}

const JWT_SECRET = readEnv('JWT_SECRET', 'sms-dev-secret-change-me');
const INTERNAL_TOKEN = readEnv('INTERNAL_TOKEN', 'CHANGE_ME_INTERNAL_TOKEN');

function serviceToken() {
  return jwt.sign(
    {
      userId: 'SVC_JOB',
      roles: ['ROLE_SERVICE'],
      permissions: ['*'],
      dataScope: 4,
      modules: ['job', 'finance'],
      kind: 'service',
      account: 'svc-job',
      userName: '就业模块（服务调用）',
    },
    JWT_SECRET,
    { expiresIn: '1h' },
  );
}

/* ============================================================
 * 服务可用性：能连上就复用，连不上再拉起
 * ============================================================ */

async function backendUp() {
  try {
    const r = await fetch(`${BE}/health`, { signal: AbortSignal.timeout(1500) });
    return r.ok || r.status < 500;
  } catch {
    return false;
  }
}

(async () => {
  const dbJob = conn('sms_job');
  const dbFin = conn('sms_finance');
  const uniDb = conn('sms_common');

  /** 夹具登记：[库连接, 表, id] */
  const fixtures = [];
  const reg = (k, table, id) => id && fixtures.push([k, table, id]);

  /**
   * 教学退费单「实际落在哪张表」—— 两处都查，哪张有就用哪张。
   *
   * ⚠️ 2026-10-22 踩过的假红（记下来，别再犯）：
   *   `_e2e-lib.mjs` 的 `USE_UNI` 是 `TEACHING_UNI_TABLE === '1'`（**默认关**），
   *   而后端 `uniTable.ts` 是 `!== '0'`（**默认开**）—— 两套默认值正好相反。
   *   不设环境变量跑自检时，后端把单写进 `sms_common.t_uni_refund`，
   *   脚本却按 `USE_UNI=false` 去 `sms_job.t_job_refund` 读 →
   *   「自动回写」三条断言全红，可库里明明写对了（纯假红）。
   *   → 断言钉**行为**不钉开关：不猜，两张表都看。
   */
  const refundRowOf = async (id) => {
    if (!id) return null;
    try {
      const uni = await uniDb('t_uni_refund').where({ id }).first();
      if (uni) return uni;
    } catch {
      /* 统一表不可用 → 再看老表 */
    }
    try {
      return (await dbJob('t_job_refund').where({ id }).first()) || null;
    } catch {
      return null;
    }
  };

  let jobId = null;
  let finRefundId = null;
  let jobStuId = null;

  try {
    if (!(await backendUp())) {
      console.log('后端未在跑，正在拉起……');
      await startServices();
    }

    /* ---------- 登录：项目经理 / 学管 / 校长 ---------- */
    const tPm = await login('sunjl'); // 实训项目经理（发起）
    const tDean = await login('congym'); // 学管主任
    const tPrincipal = await login('qiansy'); // 校长
    check('登录三个审批角色', !!tPm && !!tDean && !!tPrincipal);

    /* ---------- 造一个实训学生 ---------- */
    const stu = await buildRow(dbJob, 't_student_base', {
      student_no: 'FT' + Math.random().toString(36).slice(2, 7).toUpperCase(),
      student_name: '自检-退费同步',
      student_status: 1,
      is_deleted: 0,
    });
    await dbJob('t_student_base').insert(stu);
    reg(dbJob, 't_student_base', stu.id);
    // ★ 切读开时仓储读 sms_common.t_uni_student —— 只写老表会报「学生不存在」（铁律：夹具双写）
    await mirrorRow(uniDb, 'sms_job', 't_student_base', stu, 'job', (_d, t, id) =>
      reg(uniDb, t, id),
    );
    jobStuId = stu.id;

    /* ---------- 发起一张**两个费用项**的退费单 ---------- */
    const ITEM1 = { feeType: 1, amount: 100000 }; // 学费 1000.00
    const ITEM2 = { feeType: 2, amount: 20000 }; // 住宿费 200.00
    const TOTAL = ITEM1.amount + ITEM2.amount;

    const cJob = await req(`${API}/create`, {
      method: 'POST',
      token: tPm,
      body: {
        stage: 'job',
        studentId: stu.id,
        items: [ITEM1, ITEM2],
        refundAmount: TOTAL,
        refundReason: '自检-退费同步',
        submit: true,
      },
    });
    check('实训：项目经理发起（学费 + 住宿费 两项）', cJob.json?.code === 200, cJob.json?.message || '');
    jobId = cJob.json?.data?.id;
    if (!jobId) throw new Error('建单失败，后续断言无法进行');
    // 清理两张都登记：后端实际写哪张由 `TEACHING_UNI_TABLE` 决定，不靠开关猜（见 refundRowOf 的说明）
    reg(uniDb, 't_uni_refund', jobId);
    reg(dbJob, 't_job_refund', jobId);

    /* ---------- 学管 → 校长 审批 ---------- */
    const ap1 = await req(`${API}/approve`, {
      method: 'POST',
      token: tDean,
      body: { stage: 'job', id: jobId, comment: '学管同意' },
    });
    check('实训：学管审批通过', ap1.json?.code === 200, ap1.json?.message || '');

    const ap2 = await req(`${API}/approve`, {
      method: 'POST',
      token: tPrincipal,
      body: { stage: 'job', id: jobId, comment: '校长同意' },
    });
    check(
      '★ 校长审批通过 → 推送财务返回 pushed=true',
      ap2.json?.code === 200 && ap2.json?.data?.pushed === true,
      JSON.stringify(ap2.json?.data || ap2.json?.message),
    );

    /* ============================================================
     * 断言 1：财务侧确实建了单，来源三元组正确
     * ============================================================ */
    const fin = await dbFin('t_finance_refund')
      .where({ source_module: 'teaching', source_refund_id: jobId })
      .first();
    finRefundId = fin?.id || null;
    check(
      '★ 财务侧已建单（source_module=teaching / source_stage=job / source_refund_id 对得上）',
      !!fin && fin.source_stage === 'job',
      fin ? `${fin.order_no} dept=${fin.dept_code}` : '没查到财务退费单',
    );
    if (finRefundId) {
      reg(dbFin, 't_finance_refund', finRefundId);
    }

    /* ============================================================
     * 断言 2：时间轴不再全「待处理」
     * ============================================================ */
    check(
      '★ pushed_time 已落库（截图 bug：原来恒为 NULL → 前端显示「待处理」）',
      !!fin?.pushed_time,
      `pushed_time=${fin?.pushed_time ?? 'NULL'}`,
    );
    check(
      '★ principal_approve_time 已落库（上游校长审批真实时间）',
      !!fin?.principal_approve_time,
      `principal_approve_time=${fin?.principal_approve_time ?? 'NULL'}`,
    );
    check(
      '财务状态 = 4（待财务出款），财务可以出款',
      Number(fin?.refund_status) === 4,
      `refund_status=${fin?.refund_status}`,
    );

    /* ============================================================
     * 断言 3：费用项一项一行，金额一致
     * ============================================================ */
    const finItems = finRefundId
      ? await dbFin('t_finance_refund_item')
          .where({ refund_id: finRefundId, is_deleted: 0 })
          .orderBy('fee_type')
      : [];
    for (const it of finItems) reg(dbFin, 't_finance_refund_item', it.id);

    check(
      '★ 费用项一项一行（2 项：学费 / 住宿费）',
      finItems.length === 2,
      `行数=${finItems.length} → ${finItems.map((i) => `${i.fee_type}:${i.amount}`).join(', ')}`,
    );
    check(
      '★ 明细金额与教学侧一致（1000.00 + 200.00）',
      Number(finItems[0]?.amount) === ITEM1.amount && Number(finItems[1]?.amount) === ITEM2.amount,
      `明细合计=${finItems.reduce((s, i) => s + Number(i.amount), 0)} / 主单=${fin?.refund_amount}`,
    );
    check(
      '主单金额 = 明细合计 = 教学侧金额',
      Number(fin?.refund_amount) === TOTAL &&
        finItems.reduce((s, i) => s + Number(i.amount), 0) === TOTAL,
      `主单=${fin?.refund_amount} 期望=${TOTAL}`,
    );

    /* ============================================================
     * 断言 4：重复推送幂等（不建第二条）
     * ============================================================ */
    const svc = serviceToken();
    const reapply = await req(`${FIN}/apply`, {
      method: 'POST',
      token: svc,
      body: {
        studentId: stu.id,
        studentNo: stu.student_no,
        studentName: stu.student_name,
        deptCode: 3,
        refundItems: [1, 2],
        refundItemDetails: [ITEM1, ITEM2],
        refundAmount: TOTAL,
        refundReason: '自检-重复推送',
        sourceType: 2,
        sourceModule: 'teaching',
        sourceStage: 'job',
        sourceRefundId: jobId,
        upstreamApproveTime: '2026-10-22 10:00:00',
        upstreamApproverName: '自检校长',
      },
    });
    const dupCount = await dbFin('t_finance_refund')
      .where({ source_module: 'teaching', source_refund_id: jobId })
      .count({ n: '*' });
    check(
      '★ 重复推送幂等：返回 duplicated=true 且财务单仍是 1 条',
      reapply.json?.data?.duplicated === true && Number(dupCount[0]?.n) === 1,
      `duplicated=${reapply.json?.data?.duplicated} 单数=${dupCount[0]?.n} 单号=${reapply.json?.data?.orderNo}`,
    );

    /* ============================================================
     * 断言 5：内部回写接口鉴权
     * ============================================================ */
    const noToken = await req(`${BASE}/api/teaching/refund/internal/finance-paid`, {
      method: 'POST',
      body: { stage: 'job', id: jobId },
    });
    check(
      '★ 内部回写接口无令牌 → 401（不能裸奔）',
      noToken.status === 401 || noToken.json?.code === 40101,
      `status=${noToken.status} code=${noToken.json?.code}`,
    );

    /* ============================================================
     * 断言 6：财务出款 → 自动回写上游
     * ============================================================ */
    const beforePay = await refundRowOf(jobId);
    /**
     * ⚠️ 2026-10-22 改过：这里原来断言「出款前没有 finance_refund_no」，是**错的**。
     *
     * 单号有两次回写窗口：
     *   ① 推送成功那一刻（`pushRefundToFinance` → `setPushInfo`）—— 教务侧要立刻能看到单号
     *   ② 财务出款时再补一次（`applyFinancePayment`）—— 兜底推送阶段写失败的场景
     * 所以「出款前应该有单号」，拿它当「出款触发」的判据必然假红。
     * 真正只由**出款**写的字段是 `refund_time` → 用它当判据。
     */
    check(
      '出款前：推送阶段已回写财务单号（教务侧立刻能追踪）',
      !!beforePay?.finance_refund_no,
      `finance_refund_no=${beforePay?.finance_refund_no ?? 'NULL'}`,
    );
    check(
      '出款前：还没有出款时间（回写是出款触发的，不是审批时写的）',
      !beforePay?.refund_time,
      `refund_time=${beforePay?.refund_time ?? 'NULL'}`,
    );

    const payRes = await req(`${FIN}/pay`, {
      method: 'POST',
      token: svc,
      body: { id: finRefundId, payMethod: 1, remark: '自检-出款' },
    });
    check('财务确认出款成功', payRes.json?.code === 200, payRes.json?.message || '');

    const finAfter = await dbFin('t_finance_refund').where({ id: finRefundId }).first();
    check(
      '财务侧：状态 = 6 已退费 + 出款时间已写',
      Number(finAfter?.refund_status) === 6 && !!finAfter?.finance_pay_time,
      `refund_status=${finAfter?.refund_status} pay_time=${finAfter?.finance_pay_time}`,
    );

    const bill = await dbFin('t_finance_bill').where({ source_id: finRefundId, bill_type: 2 }).first();
    if (bill) reg(dbFin, 't_finance_bill', bill.id);

    // ⚠️ 回写是「事务提交后 + 失败只 warn」的异步动作，给它一点时间落地
    let jobAfter = null;
    for (let i = 0; i < 10; i++) {
      jobAfter = await refundRowOf(jobId);
      if (jobAfter?.finance_refund_no) break;
      await new Promise((r) => setTimeout(r, 300));
    }
    check(
      '★★ 自动回写上游：退费单拿到 finance_refund_no',
      !!jobAfter?.finance_refund_no,
      `finance_refund_no=${jobAfter?.finance_refund_no ?? 'NULL'}`,
    );
    check(
      '★★ 自动回写上游：finance_refund_id 对得上财务单',
      String(jobAfter?.finance_refund_id || '') === String(finRefundId || ''),
      `教学侧=${jobAfter?.finance_refund_id ?? 'NULL'} / 财务侧=${finRefundId}`,
    );
    check(
      '★★ 自动回写上游：出款时间已写（出款前为 NULL）',
      !!jobAfter?.refund_time,
      `refund_time=${jobAfter?.refund_time ?? 'NULL'}`,
    );

    /* ============================================================
     * 断言 7：财务 list / detail 带回 items
     * ============================================================ */
    const detail = await req(`${FIN}/detail?id=${finRefundId}`, { token: svc });
    check(
      '★ 财务详情返回 items（前端明细表的数据源）',
      Array.isArray(detail.json?.data?.items) && detail.json.data.items.length === 2,
      `items=${JSON.stringify(detail.json?.data?.items || [])}`,
    );
    check(
      '财务详情带 sourceModule（前端据此切换时间轴口径）',
      detail.json?.data?.sourceModule === 'teaching',
      `sourceModule=${detail.json?.data?.sourceModule}`,
    );

    const list = await req(`${FIN}/list?page=1&size=50&refundStatus=6`, { token: svc });
    const hit = (list.json?.data?.list || []).find((r) => r.id === finRefundId);
    check(
      '★ 财务列表返回 items + pushedTime（列表展开行 + 「推送到财务」列）',
      !!hit && Array.isArray(hit.items) && hit.items.length === 2 && !!hit.pushedTime,
      hit ? `items=${hit.items.length} pushedTime=${hit.pushedTime}` : '列表里没找到该单',
    );

    /* ============================================================
     * 断言 8：教学列表能看到财务单号（教务侧可追踪）
     * ============================================================ */
    const tList = await req(`${API}/list?stage=job&size=100`, { token: tPrincipal });
    const tHit = (tList.json?.data?.list || []).find((r) => r.id === jobId);
    check(
      '★ 教学退费列表带 financeRefundNo（教务侧不用去财务系统翻单号）',
      !!tHit && !!tHit.financeRefundNo,
      tHit ? `financeRefundNo=${tHit.financeRefundNo}` : '教学列表里没找到该单',
    );
  } catch (e) {
    check('执行过程无异常', false, e?.stack || e?.message || String(e));
  } finally {
    /* ---------- 清理夹具 ---------- */
    let removed = 0;

    // 教学侧：费用项 + 审批单 + 审批轨迹
    try {
      if (jobId) {
        // ⚠️ 费用项子表**不随切读开关走**：仓储固定写 sms_job.t_class_refund_item
        await dbJob('t_class_refund_item').where({ refund_id: jobId }).del().catch(() => 0);
        // 审批单/轨迹两套都清（同 refundRowOf 的开关陷阱，删不存在的表会抛，catch 掉即可）
        for (const [k, mainT, logTbl] of [
          [uniDb, 't_uni_approval_main', 't_uni_approval_log'],
          [dbJob, 't_job_approval', 't_job_approval_log'],
        ]) {
          try {
            await k(logTbl)
              .whereIn('approval_id', k(mainT).select('id').where({ biz_id: jobId }))
              .del();
            await k(mainT).where({ biz_id: jobId }).del();
          } catch {
            /* 这张表这轮没用到 */
          }
        }
      }
    } catch {
      /* 忽略 */
    }

    for (const [k, table, id] of fixtures.reverse()) {
      try {
        removed += Number(await k(table).where({ id }).del());
      } catch {
        /* 忽略 */
      }
    }
    if (jobStuId) {
      try {
        removed += Number(await dbJob('t_student_base').where({ id: jobStuId }).del());
      } catch {
        /* 忽略 */
      }
    }
    console.log(`\n（已清理自检夹具 ${removed} 行）`);

    await dbJob.destroy();
    await dbFin.destroy();
    await uniDb.destroy();
    const allPass = summary();
    // 自检自身不改端口、不杀外部进程：只有在本次拉起过服务时才清
    if (!(await backendUp())) killAll();
    process.exit(allPass ? 0 : 1);
  }
})();
