/**
 * 新增：学生床位号 + 咨询推送单
 * 负责人：学管模块（班级管理 8003）
 * 数据库：sms_class
 *
 * 背景（需求 v1.2）：
 *   ① 床位号：学生的宿舍信息里要带床位号，展示为「宿舍号-床位号」（如 301-1，301 为宿舍号）。
 *      学生的 dorm_id / dorm_no / bed_no 三者构成「谁住在哪个床位」的唯一真源，
 *      班级信息管理页的宿舍列由它派生，宿舍管理页按它渲染床位占用。
 *   ② 咨询推送：学生信息可能来自咨询模块 → 推送到班主任 → 班主任同意接收后补充信息建档。
 */

function base(t) {
  t.string('id', 36).primary().comment('主键UUID');
  t.datetime('create_time').notNullable().comment('创建时间');
  t.string('create_by', 36).comment('创建人ID');
  t.datetime('update_time').comment('最后修改时间');
  t.string('update_by', 36).comment('最后修改人ID');
  t.boolean('is_deleted').notNullable().defaultTo(false).comment('逻辑删除标记');
}

exports.up = async function up(knex) {
  // ---------- 学生表：补床位号 ----------
  await knex.schema.alterTable('t_class_student', (t) => {
    t.integer('bed_no').comment('床位号（同宿舍内序号，展示为 宿舍号-床位号，如 301-1）');
  });

  // ---------- 咨询推送单 ----------
  await knex.schema.createTable('t_class_consult_push', (t) => {
    base(t);
    t.string('consult_no', 40).notNullable().comment('咨询推送单号');
    t.string('student_name', 50).notNullable().comment('学员姓名');
    t.integer('gender').comment('1男 2女');
    t.string('phone', 32).comment('本人手机号');
    t.string('parent_phone', 32).comment('家长手机号');
    t.integer('age').comment('年龄');
    t.string('education', 32).comment('学历');
    t.string('origin', 100).comment('籍贯');
    t.string('graduate_school', 100).comment('毕业学校');
    t.string('home_address', 200).comment('家庭住址');
    t.integer('intend_dept_code').comment('意向部门');
    t.integer('intend_stage').comment('意向阶段');
    t.string('intend_class_id', 36).comment('意向班级ID（咨询侧给的）');
    t.string('intend_class_name', 50).comment('意向班级名称');
    t.string('remark', 500).comment('咨询备注');
    t.integer('apply_status').notNullable().defaultTo(1)
      .comment('状态 1待接收2已接收3已驳回');
    t.datetime('push_time').notNullable().comment('咨询模块推送时间');
    t.string('receiver_id', 36).comment('接收人（班主任）ID');
    t.string('receiver_name', 50).comment('接收人姓名');
    t.datetime('receive_time').comment('接收时间');
    t.string('reject_reason', 500).comment('驳回原因（驳回时必填，回传咨询模块）');
    /** 接收建档后指向学生表的学生 ID */
    t.string('student_id', 36).comment('接收建档后的学生ID');
    t.string('student_no', 32).comment('接收建档后的学号');
    t.string('source_system', 32).comment('来源系统（默认 consult）');
    t.index('apply_status', 'idx_cp_status');
    t.index('receiver_id', 'idx_cp_receiver');
    t.index('consult_no', 'idx_cp_no');
    t.comment('咨询推送单（咨询模块 → 班主任，接收后补充信息建档）');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('t_class_consult_push');
  await knex.schema.alterTable('t_class_student', (t) => {
    t.dropColumn('bed_no');
  });
};
