/**
 * 迁移脚本：创建班级交接记录表 t_job_class_transfer
 *
 * 归属模块：就业管理 > 实训阶段（马志斌）
 * 字段依据：docs/换班交接-字段定稿.md
 * 执行：npm run migrate
 *
 * 【业务含义】（2026-09-29 斌哥拍板 方案A）
 *   一次交接 = 一个班「换负责人」：原班主任/教员/助教 → 新班主任/教员/助教。
 *   学生不动，整个班跟着新负责人走。
 *
 *   ⚠️ 注意与「学生换班」「末班」区分：
 *      - 本表记的是【老师层面】的班交接（谁把这班交给谁）
 *      - 学生个别转班走 t_job_class_student 的 leaveType=1换班转出 / 2末班转出
 *
 * 【关键决策】
 *   1. 不走审批，提交即生效（斌哥拍板）
 *   2. 存「交接快照」：交接那一刻的人数 / 出勤率 / 学生名单
 *      —— 事后可查「当时交出去的是什么状态」，责任清晰
 *
 * ⚠️ 铁律：不许直接连数据库改表结构，一切变更走脚本！
 */

/**
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('t_job_class_transfer', (table) => {
    // ---- 主键与公共字段 ----
    table.string('id', 36).primary().comment('主键UUID');
    table.datetime('create_time').notNullable().comment('创建时间');
    table.string('create_by', 36).comment('创建人ID');
    table.string('create_by_name', 50).comment('创建人姓名（快照）');
    table.datetime('update_time').comment('修改时间');
    table.string('update_by', 36).comment('修改人ID');
    table.boolean('is_deleted').notNullable().defaultTo(false).comment('逻辑删除');

    // ---- 班级信息（快照）----
    table.string('class_id', 36).notNullable().comment('班级ID');
    table.string('class_name', 50).comment('班级名称（快照）');
    table.string('class_code', 32).comment('班级编号（快照）');
    table.integer('class_status').comment('交接时班级状态 1开放 2封班 3待结业 4已结业');
    table.integer('stage').comment('阶段 1一阶段 2二阶段 3三阶段');

    // ---- 交接双方：原负责人 ----
    table.string('old_head_teacher_id', 36).comment('原班主任ID');
    table.string('old_head_teacher_name', 50).comment('原班主任姓名');
    table.string('old_teacher_id', 36).comment('原教员ID');
    table.string('old_teacher_name', 50).comment('原教员姓名');
    table.string('old_assistant_id', 36).comment('原助教ID');
    table.string('old_assistant_name', 50).comment('原助教姓名');

    // ---- 交接双方：新负责人 ----
    table.string('new_head_teacher_id', 36).notNullable().comment('新班主任ID');
    table.string('new_head_teacher_name', 50).comment('新班主任姓名');
    table.string('new_teacher_id', 36).comment('新教员ID');
    table.string('new_teacher_name', 50).comment('新教员姓名');
    table.string('new_assistant_id', 36).comment('新助教ID');
    table.string('new_assistant_name', 50).comment('新助教姓名');

    // ---- 交接本身 ----
    table.date('transfer_date').notNullable().comment('交接日期');
    table.integer('transfer_type').notNullable().defaultTo(1)
      .comment('交接原因类型 1调岗 2离职 3排课调整 4组织调整 5其他');
    table.string('transfer_reason', 200).comment('交接说明/原因');
    table.string('remark', 500).comment('备注');

    // ---- 交接快照（斌哥拍板：要存）----
    table.integer('snapshot_student_count').notNullable().defaultTo(0)
      .comment('交接时在班人数');
    table.decimal('snapshot_attendance_rate', 5, 2)
      .comment('交接时累计出勤率（%）');
    table.text('snapshot_student_list')
      .comment('交接时在班学生名单快照（JSON字符串，[{id,no,name}]）');
    table.text('snapshot_detail')
      .comment('交接内容清单（JSON字符串，多选：学生名单/出勤记录/考试记录/缴费情况/宿舍/其他）');

    // ---- 索引 ----
    table.index(['class_id'], 'idx_ct_class_id');
    table.index(['transfer_date'], 'idx_ct_transfer_date');
    table.index(['new_head_teacher_id'], 'idx_ct_new_head');
    table.index(['old_head_teacher_id'], 'idx_ct_old_head');
    table.index(['is_deleted'], 'idx_ct_is_deleted');

    table.comment('班级交接记录表（就业管理-实训）');
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('t_job_class_transfer');
};
