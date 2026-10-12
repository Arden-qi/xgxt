/**
 * 角色编码统一 —— 历史数据刷码
 *
 * 【为什么需要】
 *   2026-10-02 实训模块的角色编码从 `ROLE_*` 改为与权限模块（8006）一致的无前缀编码。
 *   代码改完了，但**数据库里还有历史数据存着旧码** —— 不刷的话，
 *   查历史审批单 / 消息时会显示不出角色名，按角色查消息也会漏。
 *
 * 【改哪些列】
 *   t_job_approval.current_handler_role   审批单·当前处理角色
 *   t_job_approval.applicant_role         审批单·发起人角色
 *   t_job_approval_log.operator_role      审批轨迹·操作人角色
 *   t_job_notice.receiver_role            消息·接收人角色
 *   t_job_notice.receiver_id              消息·接收人 ID（有些行直接存角色码）
 *
 * ⚠️ `ROLE_FINANCE` 不在映射表里 —— 财务角色已删除，那批是历史遗留，**保留原样**。
 * ⚠️ `U_ROLE_*` 是"角色级假身份"的 userId（演示用），一并按同规则改写。
 */

/** 旧码 → 新码（与 shared-types/src/enums.ts 保持一致） */
const MAP = {
  ROLE_ADMIN: 'SYS_ADMIN',
  ROLE_PRINCIPAL: 'RM_PRINCIPAL',
  ROLE_CONSULT: 'MKT_CONSULT',
  ROLE_HEAD_TEACHER: 'TEACH_HEAD',
  ROLE_TEACHER: 'TEACH_TUTOR',
  ROLE_ASSISTANT: 'TEACH_ASSIST',
  ROLE_QUALITY_MGR: 'TEACH_QTY',
  ROLE_ACADEMIC_MGR: 'ACAD_MANAGER',
  ROLE_DEAN: 'TEACH_DEAN',
  ROLE_EDU_ADMIN: 'ACAD_STAFF',
  ROLE_EMPLOYMENT: 'JOB_STAFF',
  // 演示假身份的 userId：U_ROLE_XXX → U_新码
  U_ROLE_HEAD_TEACHER: 'U_TEACH_HEAD',
  U_ROLE_TEACHER: 'U_TEACH_TUTOR',
  U_ROLE_ASSISTANT: 'U_TEACH_ASSIST',
  U_ROLE_EDU_ADMIN: 'U_ACAD_STAFF',
  U_ROLE_DEAN: 'U_TEACH_DEAN',
  U_ROLE_PRINCIPAL: 'U_RM_PRINCIPAL',
  U_ROLE_ADMIN: 'U_SYS_ADMIN',
  U_ROLE_EMPLOYMENT: 'U_JOB_STAFF',
};

/** [表, 列] */
const TARGETS = [
  ['t_job_approval', 'current_handler_role'],
  ['t_job_approval', 'applicant_role'],
  ['t_job_approval_log', 'operator_role'],
  ['t_job_notice', 'receiver_role'],
  ['t_job_notice', 'receiver_id'],
];

/** 反向映射（回滚用）：新码 → 旧码 */
const REVERSE = Object.fromEntries(
  Object.entries(MAP)
    .filter(([k]) => !k.startsWith('U_'))
    .map(([k, v]) => [v, k]),
);

async function apply(knex, map) {
  let total = 0;
  for (const [table, column] of TARGETS) {
    for (const [from, to] of Object.entries(map)) {
      const n = await knex(table).where(column, from).update({ [column]: to });
      if (n > 0) {
        console.log(`      ${table}.${column}: ${from} → ${to}  (${n} 行)`);
        total += n;
      }
    }
  }
  return total;
}

exports.up = async function (knex) {
  console.log('[015] 角色编码统一 · 历史数据刷码');
  const n = await apply(knex, MAP);
  console.log(`[015] 完成，共更新 ${n} 行`);
};

exports.down = async function (knex) {
  console.log('[015] 回滚：新码 → 旧码');
  const n = await apply(knex, REVERSE);
  console.log(`[015] 回滚完成，共更新 ${n} 行`);
};

// 供一次性 dry-run 统计复用
exports.MAP = MAP;
exports.TARGETS = TARGETS;
