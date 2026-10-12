/**
 * 教务模块 · 规范对齐迁移
 *
 * 来源：《04-数据库迁移规范 v1.0》第五节 + 《02-接口契约规范 v1.0》第八节
 *   1. 表名必须是 t_{模块}_{业务}_{类型} —— 教务模块缺 edu 前缀
 *   2. 金额必须是整数、单位「分」 —— 之前是 decimal(10,2) 存「元」
 *   3. 时间必须是 datetime YYYY-MM-DD HH:mm:ss —— 之前是 date 只到「日」
 *
 * ⚠️ 铁律：不许改别人已提交的脚本，写错了/要修正就新写一个。
 *    所以这里不改 001~004，而是在 005 里把结构修正到位。
 *
 * ⚠️ t_student_base 不动 —— 按规范它归属「市场咨询」模块，命名本来就是对的。
 */

// ---- 表名映射：旧名 → 新名（只动教务模块自己建的表）----
const RENAME_TABLES = [
  ['t_payment', 't_edu_payment'],
  ['t_dorm_room', 't_edu_dorm_room'],
  ['t_dorm_bed', 't_edu_dorm_bed'],
  ['t_dorm_change_apply', 't_edu_dorm_change_apply'],
  ['t_dorm_quit_apply', 't_edu_dorm_quit_apply'],
  ['t_dorm_checkout', 't_edu_dorm_checkout'],
  ['t_dorm_assignment', 't_edu_dorm_assignment'],
];

// ---- 需要 date → datetime 的字段 ----
const DATE_TO_DATETIME = [
  ['t_edu_payment', 'pay_date'],
  ['t_edu_payment', 'expiry_date'],
  ['t_edu_dorm_change_apply', 'apply_date'],
  ['t_edu_dorm_quit_apply', 'apply_date'],
  ['t_edu_dorm_checkout', 'checkout_date'],
];

const PAYMENT = 't_edu_payment';

exports.up = async function up(knex) {
  // ========== 1. 表名补 edu 前缀 ==========
  for (const [oldName, newName] of RENAME_TABLES) {
    const hasOld = await knex.schema.hasTable(oldName);
    const hasNew = await knex.schema.hasTable(newName);
    if (hasOld && !hasNew) {
      await knex.schema.renameTable(oldName, newName);
    }
  }

  // ========== 2. 金额：decimal(元) → integer(分) ==========
  const hasPayment = await knex.schema.hasTable(PAYMENT);
  if (hasPayment) {
    const hasAmount = await knex.schema.hasColumn(PAYMENT, 'amount');
    if (hasAmount) {
      // 先看当前是不是 decimal（已经改成整数就跳过，保证可重复执行）
      const col = await knex(PAYMENT).columnInfo();
      const isDecimal = String(col.amount && col.amount.type || '').includes('decimal');

      if (isDecimal) {
        // 2.1 建临时列存「分」
        const hasTmp = await knex.schema.hasColumn(PAYMENT, 'amount_fen');
        if (!hasTmp) {
          await knex.schema.alterTable(PAYMENT, (t) => {
            t.integer('amount_fen').nullable().comment('缴费金额（单位：分）');
          });
        }
        // 2.2 元 → 分（四舍五入，避免 5800.00 * 100 出现浮点尾巴）
        await knex.raw(
          `UPDATE ?? SET amount_fen = CAST(ROUND(COALESCE(amount, 0) * 100) AS SIGNED) WHERE amount_fen IS NULL OR amount IS NOT NULL`,
          [PAYMENT],
        );
        // 2.3 换掉原列
        await knex.schema.alterTable(PAYMENT, (t) => {
          t.dropColumn('amount');
        });
        await knex.schema.alterTable(PAYMENT, (t) => {
          t.renameColumn('amount_fen', 'amount');
        });
      }
    }
  }

  // ========== 3. 时间：date → datetime ==========
  for (const [table, column] of DATE_TO_DATETIME) {
    const hasTable = await knex.schema.hasTable(table);
    if (!hasTable) continue;
    const hasCol = await knex.schema.hasColumn(table, column);
    if (!hasCol) continue;
    const info = await knex(table).columnInfo();
    const type = String((info[column] && info[column].type) || '');
    if (type.includes('date') && !type.includes('datetime')) {
      await knex.schema.alterTable(table, (t) => {
        t.datetime(column).nullable().alter();
      });
    }
  }
};

exports.down = async function down(knex) {
  // ========== 回滚时间：datetime → date ==========
  for (const [table, column] of DATE_TO_DATETIME) {
    const hasTable = await knex.schema.hasTable(table);
    if (!hasTable) continue;
    const hasCol = await knex.schema.hasColumn(table, column);
    if (!hasCol) continue;
    const info = await knex(table).columnInfo();
    const type = String((info[column] && info[column].type) || '');
    if (type.includes('datetime')) {
      await knex.schema.alterTable(table, (t) => {
        t.date(column).nullable().alter();
      });
    }
  }

  // ========== 回滚金额：integer(分) → decimal(元) ==========
  const hasPayment = await knex.schema.hasTable(PAYMENT);
  if (hasPayment) {
    const hasAmount = await knex.schema.hasColumn(PAYMENT, 'amount');
    if (hasAmount) {
      const col = await knex(PAYMENT).columnInfo();
      const isDecimal = String(col.amount && col.amount.type || '').includes('decimal');
      if (!isDecimal) {
        const hasTmp = await knex.schema.hasColumn(PAYMENT, 'amount_yuan');
        if (!hasTmp) {
          await knex.schema.alterTable(PAYMENT, (t) => {
            t.decimal('amount_yuan', 10, 2).nullable().comment('缴费金额（单位：元）');
          });
        }
        await knex.raw(
          `UPDATE ?? SET amount_yuan = ROUND(COALESCE(amount, 0) / 100, 2)`,
          [PAYMENT],
        );
        await knex.schema.alterTable(PAYMENT, (t) => {
          t.dropColumn('amount');
        });
        await knex.schema.alterTable(PAYMENT, (t) => {
          t.renameColumn('amount_yuan', 'amount');
        });
      }
    }
  }

  // ========== 回滚表名 ==========
  for (const [oldName, newName] of RENAME_TABLES) {
    const hasNew = await knex.schema.hasTable(newName);
    const hasOld = await knex.schema.hasTable(oldName);
    if (hasNew && !hasOld) {
      await knex.schema.renameTable(newName, oldName);
    }
  }
};
