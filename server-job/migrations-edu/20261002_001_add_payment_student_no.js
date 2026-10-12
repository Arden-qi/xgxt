/**
 * 缴费记录关联学生
 *
 * 缴费管理「缴费总记录」要按缴费类别分子页，表格需要展示
 * 学号、学生状态 —— 这两个信息在 t_student_base 上，
 * 所以给 t_payment 加一列 student_no 做关联。
 *
 * ⚠️ 允许为空：导入/新建时可能只填了姓名，关联不上也要能入库。
 */
exports.up = async (knex) => {
  const has = await knex.schema.hasColumn('t_payment', 'student_no');
  if (!has) {
    await knex.schema.alterTable('t_payment', (t) => {
      t.string('student_no', 32).nullable().comment('学号，关联 t_student_base.student_no');
      t.index(['student_no'], 'idx_payment_student_no');
    });
  }
};

exports.down = async (knex) => {
  const has = await knex.schema.hasColumn('t_payment', 'student_no');
  if (has) {
    await knex.schema.alterTable('t_payment', (t) => {
      t.dropIndex(['student_no'], 'idx_payment_student_no');
      t.dropColumn('student_no');
    });
  }
};
