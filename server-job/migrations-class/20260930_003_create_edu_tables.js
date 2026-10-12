/**
 * 创建教务运行与宿舍相关表：出勤、考试、成绩、宿舍申请与调宿
 * 负责人：学管模块（班级管理 8003）
 * 数据库：sms_class
 *
 * 说明：宿舍的「房间 / 住宿」主数据同步自教务管理，存在共享库 sms_common；
 *      本库只放**由本模块发起的**申请与调宿流水。
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
  // ---------- 出勤 ----------
  await knex.schema.createTable('t_class_attendance', (t) => {
    base(t);
    t.string('class_id', 36).notNullable().comment('班级ID');
    t.string('class_name', 50).notNullable().comment('班级名称');
    t.date('attendance_date').notNullable().comment('考勤日期');
    t.integer('should_count').notNullable().defaultTo(0).comment('应到人数');
    t.integer('present_count').notNullable().defaultTo(0).comment('实到人数');
    t.integer('absent_count').notNullable().defaultTo(0).comment('缺勤人数');
    t.decimal('attendance_rate', 5, 2).notNullable().defaultTo(0).comment('出勤率（百分比）');
    t.string('teacher_name', 50).comment('教员姓名');
    t.string('head_teacher_name', 50).comment('班主任姓名');
    t.unique(['class_id', 'attendance_date'], { indexName: 'uk_class_date' });
    t.index('attendance_date', 'idx_att_date');
    t.comment('出勤记录表（按班级按天）');
  });

  await knex.schema.createTable('t_class_attendance_absent', (t) => {
    base(t);
    t.string('attendance_id', 36).notNullable().comment('出勤记录ID');
    t.string('student_id', 36).notNullable().comment('学生ID');
    t.string('student_no', 32).notNullable().comment('学号');
    t.string('student_name', 50).notNullable().comment('学生姓名');
    t.string('class_name', 50).comment('班级名称');
    t.string('phone', 32).comment('联系电话');
    t.string('absent_reason', 255).notNullable().comment('缺勤原因');
    t.index('attendance_id', 'idx_ab_att');
    t.index('student_id', 'idx_ab_student');
    t.comment('缺勤明细表');
  });

  // ---------- 考试 ----------
  await knex.schema.createTable('t_class_exam', (t) => {
    base(t);
    t.string('exam_name', 100).notNullable().comment('考试名称');
    t.integer('exam_type').notNullable().comment('考试类型 1月考2质素考核3阶段考核4结业考试5其他');
    t.string('creator_id', 36).comment('创建人ID');
    t.string('creator_name', 50).comment('创建人姓名');
    t.date('exam_date').notNullable().comment('考试时间');
    t.string('class_id', 36).comment('班级ID');
    t.string('class_name', 50).comment('班级名称');
    t.integer('attendee_count').notNullable().defaultTo(0).comment('参考人数');
    t.index('exam_date', 'idx_exam_date');
    t.index('class_id', 'idx_exam_class');
    t.comment('考试信息表');
  });

  await knex.schema.createTable('t_class_exam_content', (t) => {
    base(t);
    t.string('exam_id', 36).notNullable().comment('考试ID');
    t.integer('exam_content_type').notNullable().comment('内容类型 1笔试2机试3面试4其他');
    t.integer('full_score').notNullable().defaultTo(100).comment('满分');
    t.string('content_name', 50).comment('自定义内容名称（类型为其他时使用，如「作品评分」）');
    t.index('exam_id', 'idx_ec_exam');
    t.comment('考试内容项表');
  });

  await knex.schema.createTable('t_class_exam_field', (t) => {
    base(t);
    t.string('field_key', 50).notNullable().comment('字段名');
    t.string('field_type', 20).notNullable().defaultTo('数值').comment('字段类型 数值/文本');
    t.string('default_value', 255).comment('默认值');
    t.string('source', 50).notNullable().defaultTo('自定义字段').comment('来源 系统内置/自定义字段');
    t.unique(['field_key'], { indexName: 'uk_field_key' });
    t.comment('考试自定义字段表');
  });

  await knex.schema.createTable('t_class_grade', (t) => {
    base(t);
    t.string('student_id', 36).notNullable().comment('学生ID');
    t.string('student_no', 32).notNullable().comment('学号');
    t.string('student_name', 50).notNullable().comment('学生姓名');
    t.string('class_id', 36).comment('班级ID');
    t.string('class_name', 50).comment('班级名称');
    t.string('exam_id', 36).comment('考试ID');
    t.string('exam_name', 100).comment('考试名称');
    t.decimal('written_score', 6, 2).comment('笔试分数');
    t.decimal('machine_score', 6, 2).comment('机试分数');
    t.decimal('interview_score', 6, 2).comment('面试分数');
    t.decimal('comp_score', 6, 2).comment('综合成绩（笔试×50%+面试×50%，后端计算）');
    t.integer('exam_result').notNullable().comment('考试结果 1通过（升班）2未通过（末班）');
    t.string('analysis', 500).comment('素质分析（非必填）');
    t.string('remark', 500).comment('备注 / 末班说明');
    t.index('student_id', 'idx_gr_student');
    t.index('exam_id', 'idx_gr_exam');
    t.index('exam_result', 'idx_gr_result');
    t.comment('成绩记录表');
  });

  // ---------- 宿舍：申请与调宿流水（房间/住宿主数据在 sms_common）----------
  await knex.schema.createTable('t_class_dorm_apply', (t) => {
    base(t);
    t.string('apply_no', 40).notNullable().comment('申请单号');
    t.integer('apply_category').notNullable().comment('1换宿 2退宿');
    t.string('student_id', 36).notNullable().comment('学生ID');
    t.string('student_no', 32).notNullable().comment('学号');
    t.string('student_name', 50).notNullable().comment('学生姓名');
    t.string('class_id', 36).comment('班级ID');
    t.string('class_name', 50).comment('班级名称');
    t.string('from_dorm_id', 36).comment('原宿舍ID');
    t.string('from_dorm_no', 64).comment('原宿舍号');
    t.string('to_dorm_id', 36).comment('目标宿舍ID');
    t.string('to_dorm_no', 64).comment('目标宿舍号');
    t.string('apply_reason', 500).notNullable().comment('申请原因');
    t.integer('apply_status').notNullable().defaultTo(1).comment('申请状态 1待审核2已同意3已驳回');
    t.string('reject_reason', 255).comment('驳回原因');
    t.boolean('has_goods_checked').notNullable().defaultTo(false).comment('宿舍物品完好确认');
    t.string('applicant_id', 36).comment('申请人ID');
    t.string('applicant_name', 50).comment('申请人姓名');
    t.datetime('apply_time').notNullable().comment('申请时间');
    t.string('approver_id', 36).comment('审批人ID');
    t.string('approver_name', 50).comment('审批人姓名');
    t.datetime('approve_time').comment('审批时间');
    t.index('student_id', 'idx_da_student');
    t.index('apply_status', 'idx_da_status');
    t.comment('宿舍申请表（换宿/退宿）');
  });

  await knex.schema.createTable('t_class_dorm_change_log', (t) => {
    base(t);
    t.string('student_id', 36).notNullable().comment('学生ID');
    t.string('student_no', 32).notNullable().comment('学号');
    t.string('student_name', 50).notNullable().comment('学生姓名');
    t.string('from_dorm_id', 36).comment('原宿舍ID');
    t.string('from_dorm_no', 64).comment('原宿舍号');
    t.string('to_dorm_id', 36).comment('现宿舍ID');
    t.string('to_dorm_no', 64).comment('现宿舍号');
    t.datetime('change_time').notNullable().comment('调整时间');
    t.string('change_reason', 500).notNullable().comment('调整原因');
    t.index('student_id', 'idx_dc_student');
    t.comment('调宿记录表');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('t_class_dorm_change_log');
  await knex.schema.dropTableIfExists('t_class_dorm_apply');
  await knex.schema.dropTableIfExists('t_class_grade');
  await knex.schema.dropTableIfExists('t_class_exam_field');
  await knex.schema.dropTableIfExists('t_class_exam_content');
  await knex.schema.dropTableIfExists('t_class_exam');
  await knex.schema.dropTableIfExists('t_class_attendance_absent');
  await knex.schema.dropTableIfExists('t_class_attendance');
};
