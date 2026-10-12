/**
 * 迁移脚本：就业阶段业务表（2026-10-02 从齐晋霄的包合并进来，编号已重排）
 *
 * ⚠️ 对应《就业.xmind》脑图：
 *    信息档案(基础信息/宿舍分配/复盘信息/就业日志记录)
 *    就业日志 / 复盘填写 / 数据统计
 *
 * ⚠️ 原「消息通知表 t_notification」**未搬** —— 2026-10-02 斌哥拍板「通知合一」，
 *    全模块统一使用 t_job_notice（见 utils/notice.ts 与 routes/notice.route.ts）。
 *
 * 执行方式：
 *    npm run migrate
 */

/**
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  /* ============================================================
   * 0. 学生表补充「简历」字段（脑图 - 基础信息）
   * ============================================================ */
  const hasResumeName = await knex.schema.hasColumn('t_student_base', 'resume_name');
  if (!hasResumeName) {
    await knex.schema.alterTable('t_student_base', (table) => {
      table.string('resume_name', 200).comment('简历文件名');
      table.text('resume_data').comment('简历内容 base64');
    });
  }

  /* ============================================================
   * 1. 宿舍表（脑图 - 信息档案 / 宿舍分配）
   * ============================================================ */
  await knex.schema.createTable('t_dorm', (table) => {
    table.string('id', 36).primary().comment('主键UUID');
    table.datetime('create_time').notNullable().comment('创建时间');
    table.string('create_by', 36).comment('创建人ID');
    table.datetime('update_time').comment('修改时间');
    table.string('update_by', 36).comment('修改人ID');
    table.boolean('is_deleted').notNullable().defaultTo(false).comment('逻辑删除');

    table.string('dorm_no', 20).notNullable().comment('宿舍号 如 A-301');
    table.string('building', 20).notNullable().comment('楼栋 如 A 栋');
    table.integer('floor').notNullable().defaultTo(1).comment('楼层');
    table.integer('room_type').notNullable().comment('宿舍类型 1男寝 2女寝');
    table.integer('bed_total').notNullable().defaultTo(4).comment('总床位数');
    table.string('remark', 500).comment('备注');

    table.unique(['dorm_no'], { indexName: 'uk_dorm_no' });
    table.index(['building'], 'idx_dorm_building');
    table.index(['room_type'], 'idx_dorm_room_type');

    table.comment('宿舍信息表');
  });

  /* ============================================================
   * 2. 就业日志表（脑图 - 就业日志 / 信息档案·就业日志记录）
   * ============================================================ */
  await knex.schema.createTable('t_employment_log', (table) => {
    table.string('id', 36).primary().comment('主键UUID');
    table.datetime('create_time').notNullable().comment('创建时间');
    table.string('create_by', 36).comment('创建人ID');
    table.datetime('update_time').comment('修改时间');
    table.string('update_by', 36).comment('修改人ID');
    table.boolean('is_deleted').notNullable().defaultTo(false).comment('逻辑删除');

    table.string('student_id', 36).notNullable().comment('学生ID');
    table.string('student_no', 32).comment('学号（冗余，列表免关联）');
    table.string('student_name', 50).comment('姓名（冗余）');
    table.string('class_name', 50).comment('班级名称（冗余）');
    table.date('log_date').notNullable().comment('日志日期');
    table.integer('resume_count').notNullable().defaultTo(0).comment('有效简历投递数');
    table.integer('interview_invite').notNullable().defaultTo(0).comment('面试邀约数');
    table.integer('interview_count').notNullable().defaultTo(0).comment('面试场次');
    table.string('interview_time', 32).comment('面试时间');
    table.string('company', 100).comment('面试公司');
    table.string('position', 100).comment('岗位');
    table.decimal('salary', 10, 2).comment('薪资（元/月）');
    table.text('interview_situation').comment('面试情况');

    table.index(['student_id'], 'idx_log_student');
    table.index(['log_date'], 'idx_log_date');
    table.index(['company'], 'idx_log_company');

    table.comment('就业日志表');
  });

  /* ============================================================
   * 3. 复盘表（脑图 - 复盘填写 / 信息档案·复盘信息）
   * ============================================================ */
  await knex.schema.createTable('t_review', (table) => {
    table.string('id', 36).primary().comment('主键UUID');
    table.datetime('create_time').notNullable().comment('创建时间');
    table.string('create_by', 36).comment('创建人ID');
    table.datetime('update_time').comment('修改时间');
    table.string('update_by', 36).comment('修改人ID');
    table.boolean('is_deleted').notNullable().defaultTo(false).comment('逻辑删除');

    table.string('student_id', 36).notNullable().comment('学生ID');
    table.string('student_no', 32).comment('学号（冗余）');
    table.string('student_name', 50).comment('姓名（冗余）');
    table.string('class_name', 50).comment('班级名称（冗余）');
    table.string('review_time', 32).notNullable().comment('复盘时间');
    table.string('interview_time', 32).comment('面试时间');
    table.string('position', 100).comment('岗位');
    table.decimal('salary', 10, 2).comment('工资（元/月）');
    table.integer('interview_conclusion').comment('面试结论 1待反馈2已发offer3通过4未通过');
    table.integer('review_conclusion').comment('复盘结论 1保持策略2强化辅导3调整方向4已签约');
    table.string('audio_name', 200).comment('录音文件名');
    table.text('audio_data').comment('录音内容 base64');
    table.text('detail').comment('复盘详情');

    table.index(['student_id'], 'idx_review_student');
    table.index(['review_time'], 'idx_review_time');
    table.index(['review_conclusion'], 'idx_review_conclusion');

    table.comment('就业复盘表');
  });


  /* ============================================================
   * 5. KPI 目标表（脑图 - 数据统计 / kpi）
   * ============================================================ */
  await knex.schema.createTable('t_kpi_target', (table) => {
    table.string('id', 36).primary().comment('主键UUID');
    table.datetime('create_time').notNullable().comment('创建时间');
    table.string('create_by', 36).comment('创建人ID');
    table.datetime('update_time').comment('修改时间');
    table.string('update_by', 36).comment('修改人ID');
    table.boolean('is_deleted').notNullable().defaultTo(false).comment('逻辑删除');

    table.decimal('target_rate', 5, 2).notNullable().defaultTo(85).comment('目标就业率 %');
    table.integer('target_offer').notNullable().defaultTo(60).comment('目标 offer 数');
    table.decimal('target_resume', 8, 2).notNullable().defaultTo(20).comment('目标人均投递简历数');

    table.comment('就业 KPI 目标表');
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('t_kpi_target');
  await knex.schema.dropTableIfExists('t_review');
  await knex.schema.dropTableIfExists('t_employment_log');
  await knex.schema.dropTableIfExists('t_dorm');

  const hasResumeName = await knex.schema.hasColumn('t_student_base', 'resume_name');
  if (hasResumeName) {
    await knex.schema.alterTable('t_student_base', (table) => {
      table.dropColumn('resume_name');
      table.dropColumn('resume_data');
    });
  }
};
