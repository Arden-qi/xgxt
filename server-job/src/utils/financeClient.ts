/**
 * ⭐ 就业模块 → 财务模块 的 HTTP 客户端
 *
 * ============================================================
 * 【为什么需要它】
 *   就业侧的退费审批（`routes/refund.route.ts` 的 `/approve`）走到最后一步
 *   「全部通过」时，**必须把这张退费单推给财务**，否则财务那边毫无记录
 *   —— 这正是 2026-10-08 斌哥报的问题②：
 *     「就业模块退费审批通过后，财务那边没有记录」。
 *
 *   实测根因：`/approve` 的事务里第 652-653 行只有一句注释
 *     「★ 全部通过 = 通知财务退费（本模块只改状态，出款是财务在 8005 做的）」
 *   —— 注释下面直接 `});` 结束，**从未有过任何推送代码**。
 *
 * 【为什么不让前端直接调财务】
 *   ① 跨域：前端 5173，财务 8005，浏览器会拦
 *   ② 鉴权：机器调用用统一的「服务身份」token，不该把用户 token 透传
 *   ③ 兜底：财务挂了不该让就业侧的审批事务回滚
 *
 * 【与 consult/services/finance.client.ts 的关系】
 *   咨询模块有一份同源实现（先做的，走 `consult/services/service-token.ts`）。
 *   本文件是**就业模块自己的**客户端，刻意**不复用** consult 那份：
 *     · 避免 job（legacy 四板块）反向依赖 consult 的业务目录，依赖方向混乱
 *     · 只暴露就业侧真正需要的方法（applyRefund），不背咨询侧的其余接口
 *   两者共用同一个财务后端契约，改契约时两边都要动。
 *
 * ⚠️ 失败策略：**绝不阻断主流程**。就业侧的审批是「本模块自己的状态流转」，
 *    推财务失败只记日志（调用方 catch），本地留 `finance_*` 字段便于人工补录。
 *    这与咨询侧 `reportToFinance` 的口径完全一致。
 * ============================================================
 */

import { getServiceToken } from '../consult/services/service-token';
import { BizError } from '../middleware/errorHandler';
import type { BizCode } from 'shared-types';
/**
 * ★ 2026-10-14：底层 HTTP 从原生 fetch 换成公共 axios 封装（src/shared/http.ts）。
 *   本文件用 `raw: true` —— 因为它的成功码口径特殊（0 与 200 都算成功，见下方
 *   `request` 里的说明），需要自己判断，不能让统一拦截器代判。
 */
import { remoteGet, remotePost, isRemoteTimeout } from '../shared/http';

/** 调用财务接口的超时时间（毫秒）—— 超过就放弃 */
const TIMEOUT_MS = 3000;

/**
 * 下游（财务）不可用时的错误码。
 *
 * ⚠️ 主包 `BizCode` 里没有专门的「下游超时」码（它定义在
 *    `shared-types/consult/common.ts`，那是咨询模块私有的一套）。
 *    就业模块沿用**主包** BizCode，所以这里直接用一个 5 位业务码，
 *    与咨询侧 50004 同段位，便于日志统一检索。
 */
const DOWNSTREAM_ERROR_CODE = 50004;

/** 财务接口返回体（统一 {code,message,data}） */
interface FinanceResponse<T> {
  code: number;
  message: string;
  data: T;
}

/**
 * 基础请求：带超时、带服务身份鉴权、自动解包
 *
 * ★ 2026-10-14 改造：底层由原生 fetch 换成公共 axios 封装，语义逐条保持——
 *   · 超时 / 连不上 / 对方拒绝 → 统一抛 `BizError(50004)`（错误码与改造前一致）
 *   · **成功码 0 与 200 都算成功**（财务早期返回 0）→ 用 `raw: true` 自己判，
 *     不让统一拦截器按「非 200 即失败」处理，否则会把对方的成功当业务错误抛出去
 *
 * @param path  财务侧路径，如 `/api/finance/refund/apply`
 * @param body  POST 请求体
 */
async function request<T>(path: string, body?: unknown): Promise<T> {
  let payload: FinanceResponse<T>;
  try {
    payload = await remotePost<FinanceResponse<T>>('finance', path, body, {
      timeout: TIMEOUT_MS,
      headers: {
        // 服务身份 JWT：财务侧对 kind==='service' 放行，不再卡 modules
        // ⚠️ 传 'job' —— 让财务侧建单时 applicant_name 显示「就业模块（服务调用）」，
        //    而不是复用咨询身份导致显示成「市场咨询模块」（本轮实测踩过）。
        Authorization: `Bearer ${getServiceToken('job')}`,
      },
      raw: true,
    });
  } catch (err: any) {
    // ① 超时
    if (isRemoteTimeout(err)) {
      throw new BizError(
        DOWNSTREAM_ERROR_CODE as unknown as BizCode,
        `财务模块响应超时（超过 ${TIMEOUT_MS / 1000} 秒）。请确认财务模块是否已启动。`,
      );
    }
    // ② 对方明确返回了错误体（HTTP 4xx/5xx，响应体带 code/message）
    const p = err?.payload;
    if (p && typeof p === 'object' && 'code' in p) {
      throw new BizError(
        (p.code || DOWNSTREAM_ERROR_CODE) as unknown as BizCode,
        `财务模块拒绝了本次请求：${p.message || '未知错误'}`,
      );
    }
    // ③ 连不上 / 其他网络层错误
    throw new BizError(
      DOWNSTREAM_ERROR_CODE as unknown as BizCode,
      `无法连接财务模块：${err?.message || '网络错误'}`,
    );
  }

  // 对方返回的不是 JSON（例如网关的 HTML 错误页）
  if (!payload || typeof payload !== 'object') {
    throw new BizError(DOWNSTREAM_ERROR_CODE as unknown as BizCode, '财务模块返回了非 JSON 内容');
  }

  // ⚠️ 财务侧成功码历史上出现过 0，此处保留 0/200 双兼容（与改造前一致）
  if (payload.code !== 0 && payload.code !== 200) {
    throw new BizError(
      (payload.code || DOWNSTREAM_ERROR_CODE) as unknown as BizCode,
      `财务模块拒绝了本次请求：${payload.message || '未知错误'}`,
    );
  }
  return payload.data;
}

/* ============================================================
 * 退费相关
 * ============================================================ */

/** 财务退费申请入参（对齐 `finance/routes/refund.route.ts` 的 applySchema） */
export interface FinanceApplyRefundPayload {
  /** 学生 ID（必填） */
  studentId: string;
  /** 学号（必填） */
  studentNo: string;
  /** 姓名（必填） */
  studentName: string;
  classId?: string;
  className?: string;
  /** 部门编码（1 初高 / 2 大学） */
  deptCode?: number;
  /**
   * 退费项目（必填，至少 1 个）
   * ⚠️ 值域 = 财务的 FeeType：1 学费 / 2 住宿费 / 3 餐费 / 4 保险费 / 5 试学费
   *    与就业侧的 RefundType 值域**一致**（两边都是 1-5），可直接透传。
   */
  refundItems: number[];
  /** ⚠️ 金额单位「分」 */
  refundAmount: number;
  /** 退费原因（必填，≤255） */
  refundReason: string;
  /** 来源类型：1 咨询 / 2 就业（就业侧固定传 2） */
  sourceType?: number;
  remark?: string;
}

/** 财务退费申请结果 */
export interface FinanceApplyRefundResult {
  id: string;
  orderNo: string;
}

/**
 * 向财务提交退费申请
 *
 * 对应财务接口：`POST /api/finance/refund/apply`（需 `finance:refund:apply`，
 * 财务角色 FIN_STAFF 持有；服务身份 token 也放行）。
 *
 * @returns { id, orderNo } —— 调用方应把 id 存到本地（如 t_job_refund.finance_refund_id）
 */
export async function applyRefundToFinance(
  payload: FinanceApplyRefundPayload,
): Promise<FinanceApplyRefundResult> {
  return request<FinanceApplyRefundResult>('/api/finance/refund/apply', {
    ...payload,
    // 就业侧来源固定为 2
    sourceType: payload.sourceType ?? 2,
  });
}

/**
 * 查财务退费单详情（用于回读打款状态，参照咨询侧 syncRefundFromFinance）
 *
 * ⚠️ 财务的 detail 是 **GET**，本客户端的 request 固定用 POST，
 *    所以这里单独实现一次 GET。
 */
export async function getFinanceRefundDetail(
  refundId: string,
): Promise<{ id: string; refundStatus: number } | null> {
  try {
    const payload = await remoteGet<FinanceResponse<any>>(
      'finance',
      `/api/finance/refund/detail?id=${encodeURIComponent(refundId)}`,
      {
        timeout: TIMEOUT_MS,
        headers: { Authorization: `Bearer ${getServiceToken('job')}` },
        raw: true,
      },
    );
    if (!payload || typeof payload !== 'object') return null;
    if (payload.code !== 0 && payload.code !== 200) return null;
    return payload.data || null;
  } catch {
    // 回读失败不阻断主流程，与改造前一致（静默返回 null）
    return null;
  }
}
