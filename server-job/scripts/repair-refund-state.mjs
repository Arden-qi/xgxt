/**
 * 退费状态「驳回未回滚」对账脚本（幂等）
 *
 * ★ 2026-10-26 用户报障：「财务驳回之后没办法二次发起退费」
 *
 * 【现象】
 *   退费列表里那张单已经是「已驳回（有疑问）」，但学生管理里这个人还是
 *   「退费·待财务打款」，而且：
 *     · 「发起退费」下拉搜不到他（下拉按状态排除 8/9）；
 *     · 学生管理里一个操作按钮都没有（退费状态没有可执行动作）；
 *     · 退费列表那行操作列是「—」，没有重新发起的入口。
 *   一次财务驳回，把学生彻底卡死在流程里，闭环不了。
 *
 * 【原因】
 *   `syncRefundFromFinance` 处理财务驳回（财务 refundStatus=7）时，
 *   只把 t_consult_refund.status 改成 4（已驳回）+ 写一条历史，
 *   **没有回滚 t_consult_student.consult_state**，人永远停在 8/9。
 *   （代码已修：驳回走统一的 restoreStudentAfterReject；本脚本修存量数据）
 *
 * 【规则（幂等、可重复跑）】
 *   · 只处理 consult_state ∈ (8 退费·待经理审批, 9 退费·待财务打款) 的学生；
 *   · 该生若还有「待经理审批(1) / 待财务打款(2)」的退费单 → 属于正常在途，不碰；
 *   · 其余（单子已驳回 4 / 已打款 3 / 压根没有单）→ 认定状态是脏的，回滚：
 *       - 单据上有 origin_state ∈ (3,4,5) → 用它（发起时的真实状态）
 *       - 否则按有没有分班推断：有 class_id → 试学中(5)，没有 → 待分班(4)
 *   · 已打款(3) 的单回滚到 10（已退费）—— 打款成功却停在 9 也是脏数据
 *   · 每次回滚写一条 t_consult_history，可追溯
 *
 * 【怎么跑】
 *   cd server-job
 *   npm run fix:refund-state           # 实跑
 *   npm run fix:refund-state -- --dry  # 只打印将要改什么，不落库
 */

import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';

const DRY = process.argv.includes('--dry');

const CONSULT_DB = process.env.DB_NAME_CONSULT || 'sms_consult';

const CONN = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  charset: 'utf8mb4',
  timezone: '+08:00',
};

const STATE_NAME = {
  1: '待分配',
  2: '待面试',
  3: '咨询中',
  4: '待分班',
  5: '试学中',
  6: '缴费中·待确认',
  7: '正式在读',
  8: '退费·待经理审批',
  9: '退费·待财务打款',
  10: '已退费',
  11: '未报名·待跟进',
  12: '流失',
  13: '未通过',
};

const REFUND_STATUS_NAME = {
  1: '待经理审批',
  2: '待财务打款',
  3: '已打款',
  4: '已驳回',
};

/** 还在途的退费单状态：这些学生确实在退费流程中，不能动 */
const IN_FLIGHT = [1, 2];
/** 可以拿来当回滚落点的状态（退费只允许从这三个发起） */
const RESTORABLE = [3, 4, 5];

async function main() {
  const conn = await mysql.createConnection({ ...CONN, database: CONSULT_DB });
  console.log(`\n退费状态对账 ${DRY ? '（演练模式，不落库）' : ''}`);
  console.log(`库：${CONSULT_DB}\n`);

  // 1) 所有卡在「退费中」的学生
  const [students] = await conn.query(
    `select id, student_name, consult_state, student_status, class_id, class_name
       from \`${CONSULT_DB}\`.t_consult_student
      where is_deleted = 0 and consult_state in (8, 9)
      order by student_name`,
  );

  if (!students.length) {
    console.log('没有卡在「退费中」的学生，无需处理。');
    await conn.end();
    return;
  }

  const changes = [];
  for (const stu of students) {
    const [refunds] = await conn.query(
      `select id, refund_no, status, reject_reason, origin_state, finance_refund_id
         from \`${CONSULT_DB}\`.t_consult_refund
        where consult_student_id = ? and is_deleted = 0
        order by create_time desc`,
      [stu.id],
    );

    // 2) 正常在途 → 不碰
    const inFlight = refunds.find((r) => IN_FLIGHT.includes(Number(r.status)));
    if (inFlight) continue;

    // 3) 决定回滚落点
    const latest = refunds[0] || null;
    let target = 0;
    let why = '';

    const paidOne = refunds.find((r) => Number(r.status) === 3);
    const origin = Number(latest?.origin_state) || 0;

    if (paidOne) {
      // 财务已经打款，只是状态没推进到「已退费」
      target = 10;
      why = `退费单 ${paidOne.refund_no} 已打款，但学生状态没流转到「已退费」`;
    } else if (RESTORABLE.includes(origin)) {
      target = origin;
      why = `按退费单 ${latest?.refund_no || ''} 记录的发起前状态回滚`;
    } else {
      target = String(stu.class_id || '').trim() ? 5 : 4;
      why = `单据没记录发起前状态（老数据），按${String(stu.class_id || '').trim() ? '已分班' : '未分班'}推断`;
    }

    if (target === Number(stu.consult_state)) continue;
    changes.push({ stu, latest, target, why, refunds });
  }

  if (!changes.length) {
    console.log(`检查了 ${students.length} 个「退费中」学生，状态都是对的，无需处理。`);
    await conn.end();
    return;
  }

  for (const c of changes) {
    const cur = Number(c.stu.consult_state);
    const refundsTxt = c.refunds.length
      ? c.refunds
          .map((r) => `${r.refund_no}=${REFUND_STATUS_NAME[r.status] || r.status}`)
          .join('，')
      : '无退费单';
    console.log(
      `  · ${c.stu.student_name}：${STATE_NAME[cur] || cur} → ${STATE_NAME[c.target] || c.target}` +
        `（${refundsTxt}；${c.why}）`,
    );
    if (DRY) continue;

    /**
     * 目标 10（已退费）对应学籍 7（退学）；
     * 3/4/5 三个状态在 CONSULT_TO_STUDENT_STATUS 里都映射到 3（试学中）。
     */
    const studentStatus = c.target === 10 ? 7 : 3;

    await conn.query(
      `update \`${CONSULT_DB}\`.t_consult_student
          set consult_state = ?, student_status = ?, update_time = now(), update_by = '系统对账'
        where id = ?`,
      [c.target, studentStatus, c.stu.id],
    );

    await conn.query(
      `insert into \`${CONSULT_DB}\`.t_consult_history
         (id, create_time, consult_student_id, by_name, by_title, action, text, is_deleted)
       values (?, now(), ?, '系统对账', '系统', 'REPAIR', ?, 0)`,
      [
        randomUUID(),
        c.stu.id,
        `系统对账：退费单已终态（${
          c.refunds.map((r) => `${r.refund_no}=${REFUND_STATUS_NAME[r.status] || r.status}`).join('，') ||
          '无退费单'
        }），学生状态由「${STATE_NAME[cur] || cur}」回滚为「${STATE_NAME[c.target] || c.target}」，可重新发起退费`,
      ],
    );
  }

  console.log(`\n${DRY ? '将处理' : '已处理'} ${changes.length} 条。\n`);
  await conn.end();
}

main().catch((e) => {
  console.error('退费状态对账失败：', e.message);
  process.exit(1);
});
