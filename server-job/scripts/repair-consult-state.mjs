/**
 * 咨询侧状态 / 学号「对账补齐」脚本（幂等）
 *
 * ★ 2026-10-22 用户口径：「已经分班之后状态要改变」
 *
 * 【修的是什么】
 *   教学侧早就建档入班了（推送单已接收、学号都发下来了），
 *   但咨询侧 t_consult_student 还停在 consult_state=4「待分班」、
 *   student_no 还是空的 —— 列表上看起来「分了班状态没变、也没学号」。
 *
 *   实测现场：王麻子（学籍 3 试学）、李静静 / 跳跳鱼（学籍 5 正式在读），
 *   咨询侧全是 4「待分班」+ 无学号。
 *
 * 【为什么会这样】
 *   这几条是在 `/api/consult/student/internal/receive-ack`（接收回写）
 *   上线之前接收的。当时「接收」只建档、不回写咨询侧，状态就永久落后一步。
 *   现在接收链路已经会回写，但存量数据得对一次账。
 *
 * 【规则（只升不降、幂等、可重复跑）】
 *   · 学籍 student_status = 3（试学）→ 咨询 5（试学中）
 *   · 学籍 student_status = 5（正式在读）→ 咨询 7（正式在读）
 *   · 只在「目标状态 > 当前状态」时更新；退费/流失/未报名/未通过等终态一律不碰
 *   · 学号只补空，不覆盖已有值
 *   · 每次状态推进写一条 t_consult_history，可追溯
 *
 * 【怎么跑】
 *   cd server-job
 *   npm run fix:consult-state          # 实跑
 *   npm run fix:consult-state -- --dry # 只打印将要改什么，不落库
 */

import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';

const DRY = process.argv.includes('--dry');

const CONSULT_DB = process.env.DB_NAME_CONSULT || 'sms_consult';
const CLASS_DB = process.env.DB_NAME_CLASS || 'sms_class';
const CLASS_JH_DB = process.env.DB_NAME_CLASS_JH || 'sms_class_jh';

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

/** 终态 / 另一条流程 —— 对账不碰 */
const SKIP_STATES = [8, 9, 10, 11, 12, 13];

/** 学籍状态 → 咨询应有状态 */
const TARGET = { 3: 5, 5: 7 };

/** 读两套学籍（库/表不存在就跳过，不阻断） */
async function loadArchives(conn) {
  const out = [];
  const sources = [
    [CLASS_DB, 't_class_student', '大学部'],
    [CLASS_JH_DB, 't_class_student', '初高'],
  ];
  for (const [db, table, label] of sources) {
    try {
      const [rows] = await conn.query(
        `select source_id, student_no, student_status, class_id, class_name
           from \`${db}\`.\`${table}\`
          where is_deleted = 0
            and source_system = 'consult'
            and source_id is not null and source_id <> ''`,
      );
      for (const r of rows) out.push({ ...r, from: label });
    } catch (e) {
      console.warn(`  ⚠️  读 ${db}.${table} 失败，跳过：${e.message}`);
    }
  }
  return out;
}

async function main() {
  const conn = await mysql.createConnection({ ...CONN, database: CONSULT_DB });
  console.log(`\n咨询状态对账 ${DRY ? '（演练模式，不落库）' : ''}`);
  console.log(`库：${CONSULT_DB}  ← 学籍来源：${CLASS_DB} / ${CLASS_JH_DB}\n`);

  const archives = await loadArchives(conn);
  if (!archives.length) {
    console.log('没有来源=consult 的学籍档案，无需处理。');
    await conn.end();
    return;
  }

  const changes = [];
  for (const a of archives) {
    const id = String(a.source_id || '').trim();
    if (!id) continue;

    const [rows] = await conn.query(
      `select id, student_name, consult_state, student_no, class_id, class_name
         from \`${CONSULT_DB}\`.t_consult_student
        where id = ? and is_deleted = 0`,
      [id],
    );
    const stu = rows[0];
    if (!stu) continue;

    const patch = {};
    const cur = Number(stu.consult_state);
    const archNo = String(a.student_no || '').trim();

    // 1) 学号：只补空
    if (archNo && !String(stu.student_no || '').trim()) {
      patch.student_no = archNo;
    }

    // 2) 状态：只升不降，终态跳过
    const target = TARGET[Number(a.student_status)] || 0;
    if (target > cur && !SKIP_STATES.includes(cur)) {
      patch.consult_state = target;
      patch.student_status = Number(a.student_status);
      if (!String(stu.class_id || '').trim() && a.class_id) patch.class_id = a.class_id;
      if (!String(stu.class_name || '').trim() && a.class_name) patch.class_name = a.class_name;
    }

    if (!Object.keys(patch).length) continue;
    changes.push({ stu, cur, target, patch, archive: a });
  }

  if (!changes.length) {
    console.log('所有已入班学生的咨询状态 / 学号都已是正确的，无需处理。');
    await conn.end();
    return;
  }

  for (const c of changes) {
    const name = String(c.stu.student_name);
    const bits = [];
    if (c.patch.consult_state) {
      bits.push(
        `状态 ${STATE_NAME[c.cur] || c.cur} → ${STATE_NAME[c.patch.consult_state] || c.patch.consult_state}`,
      );
    }
    if (c.patch.student_no) bits.push(`学号补 ${c.patch.student_no}`);
    console.log(`  · ${name}（${c.archive.from}）：${bits.join('，')}`);

    if (DRY) continue;

    await conn.query(
      `update \`${CONSULT_DB}\`.t_consult_student
          set ${Object.keys(c.patch).map((k) => `\`${k}\` = ?`).join(', ')}, update_time = now()
        where id = ?`,
      [...Object.values(c.patch), c.stu.id],
    );

    if (c.patch.consult_state) {
      await conn.query(
        `insert into \`${CONSULT_DB}\`.t_consult_history
           (id, create_time, consult_student_id, by_name, by_title, action, text, is_deleted)
         values (?, now(), ?, '系统', '系统', 'REPAIR', ?, 0)`,
        [
          randomUUID(),
          c.stu.id,
          `系统对账：教学侧已建档入班（学籍状态 ${Number(c.archive.student_status)}），` +
            `咨询状态由「${STATE_NAME[c.cur] || c.cur}」补齐为「${STATE_NAME[c.patch.consult_state]}」`,
        ],
      );
    }
  }

  console.log(
    `\n${DRY ? '将处理' : '已处理'} ${changes.length} 条；` +
      `其中状态推进 ${changes.filter((c) => c.patch.consult_state).length} 条，` +
      `仅补学号 ${changes.filter((c) => !c.patch.consult_state).length} 条。\n`,
  );

  await conn.end();
}

main().catch((e) => {
  console.error('对账失败：', e.message);
  process.exit(1);
});
