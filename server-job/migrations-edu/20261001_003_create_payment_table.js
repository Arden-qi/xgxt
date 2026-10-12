/**
 * 迁移脚本：创建缴费管理表
 *
 * 来源：教务管理原型 payment.html（缴费管理页）
 *   - 缴费总记录：类别 / 班级 / 班主任 / 学生姓名 / 缴费时间 / 到期时间 / 状态（正常·已冻结）
 *   - 即将到期：从缴费记录派生 —— 未冻结 且 剩余天数在 0~30 天内
 *     状态流转：待通知 →（通知）→ 待上传 →（上传凭证）→ 已上传
 *
 * 表设计要点：
 *   1. 只建一张表。原型里「即将到期」列表是从 paymentList 派生的（getExpiringList），
 *      不是独立数据，所以剩余天数不落库，查询时按 expiry_date 现算。
 *   2. exp_status 落在主表上，和原型里 `p.expStatus` 挂在 paymentList 条目上一致。
 *   3. frozen（冻结）会影响「正常/已冻结」统计，也是临期列表的过滤条件之一。
 */

const TABLE = 't_payment';

const COMMON = (table) => {
  table.string('id', 36).primary().comment('主键UUID');
  table.datetime('create_time').notNullable().comment('创建时间');
  table.string('create_by', 36).comment('创建人ID');
  table.datetime('update_time').comment('修改时间');
  table.string('update_by', 36).comment('修改人ID');
  table.boolean('is_deleted').notNullable().defaultTo(false).comment('逻辑删除');
};

/**
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable(TABLE, (table) => {
    COMMON(table);

    // ===== 业务字段 =====
    table.string('category', 20).notNullable().comment('费用类别：住宿费/保险费/餐费');
    table.string('class_name', 50).comment('班级');
    table.string('head_teacher_name', 50).comment('班主任');
    table.string('student_name', 50).notNullable().comment('学生姓名');

    table.date('pay_date').comment('缴费时间');
    table.date('expiry_date').comment('到期时间');

    table.boolean('frozen').notNullable().defaultTo(false).comment('是否冻结：true=已冻结 false=正常');

    // ===== 临期流程字段（原型「即将到期」Tab 用到）=====
    table
      .string('exp_status', 20)
      .nullable()
      .comment('临期状态：待通知/待上传/已上传');
    table.datetime('notify_time').comment('通知发送时间');
    table.datetime('upload_time').comment('凭证上传时间');
    table.string('certificate_name', 255).comment('凭证文件名');
    table.string('upload_remark', 500).comment('上传备注');

    // ===== 索引 =====
    table.index(['is_deleted', 'category'], 'idx_payment_cat');
    table.index(['is_deleted', 'class_name'], 'idx_payment_class');
    table.index(['is_deleted', 'expiry_date'], 'idx_payment_expiry');
    table.index(['is_deleted', 'frozen'], 'idx_payment_frozen');
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists(TABLE);
};
