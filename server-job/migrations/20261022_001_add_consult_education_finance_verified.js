/**
 * 迁移：咨询学生「学历」+ 收款单「财务核对人/核对时间」
 *
 * ★ 2026-10-22 用户口径：
 *   ① 「新建学生里边加一个学历」
 *   ② 「财务侧状态和操作人不对」—— 收款与缴费列表的「操作人/操作时间」
 *      一直是咨询侧发起人，财务侧到底是谁核对、什么时候核对完全看不到，
 *      需要把财务的 verified_by_name / verified_time 同步回咨询库。
 *
 * 两处改动：
 *   · t_consult_student.education            —— 学历（新建学生时录入，推送班级时带过去）
 *   · t_consult_fee_order.finance_verified_by / finance_verified_time
 *                                            —— 财务核对人 / 核对时间快照
 *
 * ⚠️ up()/down() 都先判表判列再改，可重复执行、可回滚（项目铁律）。
 */

/**
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  /* ---------- 1. 咨询学生：学历 ---------- */
  if (await knex.schema.hasTable('t_consult_student')) {
    const hasEdu = await knex.schema.hasColumn('t_consult_student', 'education');
    if (!hasEdu) {
      await knex.schema.alterTable('t_consult_student', (t) => {
        // 位置放在 age 之后，和老表结构一致；SQLite/低版本 MySQL 不支持 after 会自动忽略
        t.string('education', 20).comment('学历（初中/高中/中专/大专/本科/硕士及以上）');
      });
    }
  }

  /* ---------- 2. 收款单：财务核对人 / 核对时间 ---------- */
  if (await knex.schema.hasTable('t_consult_fee_order')) {
    const hasBy = await knex.schema.hasColumn('t_consult_fee_order', 'finance_verified_by');
    const hasTime = await knex.schema.hasColumn('t_consult_fee_order', 'finance_verified_time');
    if (!hasBy || !hasTime) {
      await knex.schema.alterTable('t_consult_fee_order', (t) => {
        if (!hasBy) t.string('finance_verified_by', 50).comment('财务核对人姓名（从财务侧同步）');
        if (!hasTime) t.dateTime('finance_verified_time').comment('财务核对时间（从财务侧同步）');
      });
    }
  }
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  if (await knex.schema.hasTable('t_consult_student')) {
    const hasEdu = await knex.schema.hasColumn('t_consult_student', 'education');
    if (hasEdu) {
      await knex.schema.alterTable('t_consult_student', (t) => {
        t.dropColumn('education');
      });
    }
  }

  if (await knex.schema.hasTable('t_consult_fee_order')) {
    const hasBy = await knex.schema.hasColumn('t_consult_fee_order', 'finance_verified_by');
    const hasTime = await knex.schema.hasColumn('t_consult_fee_order', 'finance_verified_time');
    if (hasBy || hasTime) {
      await knex.schema.alterTable('t_consult_fee_order', (t) => {
        if (hasBy) t.dropColumn('finance_verified_by');
        if (hasTime) t.dropColumn('finance_verified_time');
      });
    }
  }
};
