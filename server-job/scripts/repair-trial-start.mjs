/**
 * 咨询侧「进班日（trial_start）」对账补齐脚本（幂等）
 *
 * ★ 2026-10-23 用户口径：
 *   「退费日期选择最开始的日期是分班之后开始，没来之前的日期不能选择」
 *
 * 【修的是什么】
 *   已经分班 / 已在读的学生，`t_consult_student.trial_start` 是空的。
 *   退费弹窗靠这一列算「最早可选日」，空了就变成不设下限，
 *   日历一路能选到几个月前，试学天数被算成 80 天，多扣住宿餐费、退费金额做小。
 *
 * 【为什么是空的】
 *   /internal/receive-ack 以前只在「→ 试学中」的分支写 trial_start，
 *   缴全款直接转「正式在读」的学生走的是 FORMAL 分支，这一列就永远没值。
 *   （该分支已改为两种状态都写，但存量数据得对一次账。）
 *
 * 【规则（只补空、不覆盖、幂等、可重复跑）】
 *   · 范围：consult_state in (5 试学中, 6 缴费中待确认, 7 正式在读)
 *   · 取值：跟进历史里最早的入班动作（ASSIGN_CLASS / ENROLL_TO_CLASS）当天
 *           → 没有历史则退到建档日 create_time
 *   · 已有 trial_start 的一律不动（首次进班日才是基准）
 *   · 每次补齐写一条 t_consult_history（action=REPAIR），可追溯
 *
 * 【怎么跑】
 *   cd server-job
 *   npm run fix:trial-start          # 实跑
 *   npm run fix:trial-start -- --dry # 只打印将要改什么，不落库
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

/** 已入班（应该有进班日）的咨询状态 */
const ENROLLED_STATES = [5, 6, 7];

const STATE_NAME = {
  5: '试学中',
  6: '缴费中·待确认',
  7: '正式在读',
};

/** Date / 'YYYY-MM-DD HH:mm:ss' → 'YYYY-MM-DD' */
function day(v) {
  if (!v) return '';
  if (typeof v === 'string') return v.slice(0, 10);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function main() {
  const conn = await mysql.createConnection({ ...CONN, database: CONSULT_DB });
  console.log(`\n进班日（trial_start）对账 ${DRY ? '（演练模式，不落库）' : ''}`);
  console.log(`库：${CONSULT_DB}\n`);

  const [rows] = await conn.query(
    `select id, student_name, consult_state, class_name, create_time
       from \`${CONSULT_DB}\`.t_consult_student
      where is_deleted = 0
        and trial_start is null
        and consult_state in (${ENROLLED_STATES.join(',')})
      order by create_time asc`,
  );

  if (!rows.length) {
    console.log('已入班学生的进班日都齐了，无需处理。');
    await conn.end();
    return;
  }

  const changes = [];
  for (const stu of rows) {
    const [his] = await conn.query(
      `select create_time, action, text
         from \`${CONSULT_DB}\`.t_consult_history
        where consult_student_id = ? and is_deleted = 0
          and action in ('ASSIGN_CLASS', 'ENROLL_TO_CLASS')
        order by create_time asc
        limit 1`,
      [stu.id],
    );
    const fromHistory = day(his[0]?.create_time);
    const value = fromHistory || day(stu.create_time);
    if (!value) continue;
    changes.push({ stu, value, source: fromHistory ? '入班历史' : '建档日' });
  }

  if (!changes.length) {
    console.log('没有可推导的进班日（历史与建档时间都缺失），跳过。');
    await conn.end();
    return;
  }

  for (const c of changes) {
    console.log(
      `  · ${c.stu.student_name}（${STATE_NAME[c.stu.consult_state] || c.stu.consult_state}` +
        `${c.stu.class_name ? ` · ${c.stu.class_name}` : ''}）：进班日补 ${c.value}（来源：${c.source}）`,
    );
    if (DRY) continue;

    await conn.query(
      `update \`${CONSULT_DB}\`.t_consult_student
          set trial_start = ?, update_time = now()
        where id = ? and trial_start is null`,
      [c.value, c.stu.id],
    );

    await conn.query(
      `insert into \`${CONSULT_DB}\`.t_consult_history
         (id, create_time, consult_student_id, by_name, by_title, action, text, is_deleted)
       values (?, now(), ?, '系统', '系统', 'REPAIR', ?, 0)`,
      [
        randomUUID(),
        c.stu.id,
        `系统对账：已入班学生缺少进班日，按${c.source}补齐为 ${c.value}` +
          `（退费试学期间不得早于该日）`,
      ],
    );
  }

  const byHistory = changes.filter((c) => c.source === '入班历史').length;
  console.log(
    `\n${DRY ? '将处理' : '已处理'} ${changes.length} 条；` +
      `按入班历史 ${byHistory} 条，按建档日兜底 ${changes.length - byHistory} 条。\n`,
  );

  await conn.end();
}

main().catch((e) => {
  console.error('对账失败：', e.message);
  process.exit(1);
});
