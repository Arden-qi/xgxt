/**
 * 缴费记录：学生休学/退学自动冻结
 *
 * 业务规则：学生状态变成「休学 / 退学」时，TA 名下所有缴费记录由系统冻结，
 *          且不允许人工解冻（要解冻必须先把学生状态改回在读）。
 *
 * 加一列 auto_frozen 是为了把「系统冻结」和「教务手动冻结」区分开：
 *   - auto_frozen = 1：由学生状态触发，解冻动作由学生状态回退触发
 *   - auto_frozen = 0：教务在页面上手动冻结的，学生复学时不能被误解冻
 *
 * up 里顺带做一次历史数据同步 —— 已经存在的休学/退学学生，
 * 他们名下的缴费记录也要立刻符合这条规则，不用等下次改档案。
 */
exports.up = async (knex) => {
  const has = await knex.schema.hasColumn('t_payment', 'auto_frozen');
  if (!has) {
    await knex.schema.alterTable('t_payment', (t) => {
      t.tinyint('auto_frozen').notNullable().defaultTo(0).comment('是否由学生休学/退学触发的系统冻结');
    });
  }

  // 历史数据同步：休学(6) / 退学(7) 学生的缴费记录置为冻结 + 标记系统冻结
  await knex.raw(
    `UPDATE t_payment p
       JOIN t_student_base s ON s.student_no = p.student_no AND s.is_deleted = 0
        SET p.frozen = 1, p.auto_frozen = 1
      WHERE p.is_deleted = 0 AND s.student_status IN (6, 7)`,
  );
};

exports.down = async (knex) => {
  // 回滚：把系统冻结的那一批解冻，再删列
  await knex.raw('UPDATE t_payment SET frozen = 0 WHERE is_deleted = 0 AND auto_frozen = 1');

  const has = await knex.schema.hasColumn('t_payment', 'auto_frozen');
  if (has) {
    await knex.schema.alterTable('t_payment', (t) => {
      t.dropColumn('auto_frozen');
    });
  }
};
