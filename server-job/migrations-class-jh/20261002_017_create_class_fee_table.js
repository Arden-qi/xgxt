/**
 * 迁移：缴费台账（镜像）t_class_fee
 *
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('t_class_fee', (table) => {
    // ---- 公共字段 ----
    table.string('id', 36).primary().comment('主键UUID');
    table.datetime('create_time').notNullable().comment('创建时间');
    table.string('create_by', 36).comment('创建人ID');
    table.datetime('update_time').comment('修改时间');
    table.string('update_by', 36).comment('修改人ID');
    table.boolean('is_deleted').notNullable().defaultTo(false).comment('逻辑删除');

    // ---- 业务字段 ----
    table.string('student_id', 36).notNullable().comment('学生ID');
    table.string('student_no', 32).notNullable().comment('学号');
    table.string('student_name', 50).notNullable().comment('学生姓名');
    table.string('class_id', 36).comment('班级ID');
    table.string('class_name', 50).comment('班级名称');
    table.integer('dept_code').defaultTo(1).comment('部门 1初高部 2大学部');
    table.integer('fee_type').notNullable().comment('缴费类型 1学费2住宿费3餐费4保险费5试学费');
    table.integer('fee_amount').notNullable().comment('金额（分）');
    table.integer('pay_status').notNullable().defaultTo(1).comment('缴费状态 1待缴2已缴3已核对4逾期5冻结');
    table.date('pay_date').comment('缴费日期');
    table.date('expire_date').comment('到期日期');
    table.string('voucher_url', 255).comment('缴费凭证');

    // ---- 索引 ----
    table.index(['student_id'], 'idx_student_id');
    table.index(['class_id', 'fee_type'], 'idx_class_fee');
    table.index(['expire_date'], 'idx_expire_date');

    table.comment('缴费台账表（镜像）');
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('t_class_fee');
};
