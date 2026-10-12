/**
 * 创建同步副本表（共享库 sms_common）
 * 负责人：学管模块（班级管理 8003）
 * 数据库：sms_common
 *
 * ⚠️ 这些表存的是**别的模块推给本模块的只读副本**：
 *   - 缴费信息   ← 财务管理（8005）
 *   - 催费信息   ← 教务管理（8002）
 *   - 宿舍信息   ← 教务管理（8002）
 *   铁律：不许直接读别人的库表；需要实时数据一律走 HTTP 接口。
 *
 * 幂等键：(source_system + source_id)
 */

function base(t) {
  t.string('id', 36).primary().comment('主键UUID（本模块生成）');
  t.datetime('create_time').notNullable().comment('创建时间');
  t.string('create_by', 36).comment('创建人ID');
  t.datetime('update_time').comment('最后修改时间');
  t.string('update_by', 36).comment('最后修改人ID');
  t.boolean('is_deleted').notNullable().defaultTo(false).comment('逻辑删除标记');
}

function syncMeta(t) {
  t.string('source_system', 20).notNullable().comment('上游系统 finance/edu');
  t.string('source_id', 64).notNullable().comment('上游主键（幂等键）');
  t.string('source_batch_no', 40).comment('上游同步批次号');
  t.datetime('source_update_time').comment('上游数据最后变更时间');
  t.integer('sync_status').notNullable().defaultTo(2).comment('1待同步2已同步3同步失败');
}

exports.up = async function up(knex) {
  // ---------- 缴费信息（← 财务管理 8005）----------
  await knex.schema.createTable('t_class_fee_sync', (t) => {
    base(t);
    syncMeta(t);
    t.string('student_id', 36).notNullable().comment('学生ID');
    t.string('student_no', 32).notNullable().comment('学号');
    t.string('student_name', 50).notNullable().comment('学生姓名');
    t.string('class_id', 36).comment('班级ID');
    t.string('class_name', 50).comment('班级名称');
    t.integer('fee_type').notNullable().comment('缴费类型 1学费2住宿费3餐费4保险费5试学费');
    /** 金额单位：分 */
    t.bigInteger('amount').notNullable().comment('应收金额（分）');
    t.bigInteger('paid_amount').comment('实收金额（分）');
    t.integer('pay_status').notNullable().defaultTo(1).comment('缴费状态 1待缴2已缴3已核对4逾期5冻结');
    t.date('pay_date').comment('缴费日期');
    t.date('expire_date').comment('到期日期');
    t.string('voucher_url', 255).comment('缴费凭证URL');
    t.string('pay_method', 32).comment('缴费方式');
    t.unique(['source_system', 'source_id'], { indexName: 'uk_fee_source' });
    t.index('student_id', 'idx_fee_student');
    t.index(['class_id', 'fee_type'], 'idx_fee_class_type');
    t.index('expire_date', 'idx_fee_expire');
    t.index('pay_status', 'idx_fee_status');
    t.comment('缴费信息同步副本（源：财务管理）');
  });

  // ---------- 催费信息（← 教务管理 8002）----------
  await knex.schema.createTable('t_class_urge_sync', (t) => {
    base(t);
    syncMeta(t);
    t.string('student_id', 36).notNullable().comment('学生ID');
    t.string('student_no', 32).notNullable().comment('学号');
    t.string('student_name', 50).notNullable().comment('学生姓名');
    t.string('class_id', 36).comment('班级ID');
    t.string('class_name', 50).comment('班级名称');
    t.string('phone', 32).comment('学生手机号');
    t.string('parent_phone', 32).comment('家长手机号');
    t.string('head_teacher_id', 36).comment('班主任ID');
    t.string('head_teacher_name', 50).comment('班主任姓名');
    t.integer('fee_type').notNullable().comment('欠费类型');
    /** 金额单位：分 */
    t.bigInteger('amount').notNullable().comment('欠费金额（分）');
    t.date('expire_date').notNullable().comment('到期日期');
    t.integer('pay_status').notNullable().defaultTo(1).comment('缴费状态');
    t.integer('urge_count').notNullable().defaultTo(0).comment('上游记录的催费次数');
    t.datetime('last_urge_time').comment('最近催费时间');
    t.unique(['source_system', 'source_id'], { indexName: 'uk_urge_source' });
    t.index('student_id', 'idx_urge_student');
    t.index('class_id', 'idx_urge_class');
    t.index('expire_date', 'idx_urge_expire');
    t.comment('催费信息同步副本（源：教务管理）');
  });

  // ---------- 宿舍房间（← 教务管理 8002）----------
  await knex.schema.createTable('t_class_dorm_room_sync', (t) => {
    base(t);
    syncMeta(t);
    t.string('building_id', 36).comment('楼栋ID');
    t.string('building_name', 50).comment('楼栋名称');
    t.integer('dorm_type').comment('宿舍类型 1男寝2女寝');
    t.string('dorm_no', 64).notNullable().comment('宿舍号，如 A栋-301');
    t.integer('bed_count').notNullable().defaultTo(0).comment('床位总数');
    t.integer('used_count').notNullable().defaultTo(0).comment('已住人数');
    t.string('leader_student_id', 36).comment('宿舍长学生ID');
    t.string('leader_student_name', 50).comment('宿舍长姓名');
    t.unique(['source_system', 'source_id'], { indexName: 'uk_room_source' });
    t.index('dorm_no', 'idx_room_no');
    t.index('dorm_type', 'idx_room_type');
    t.comment('宿舍房间同步副本（源：教务管理）');
  });

  // ---------- 宿舍住宿（学生 ↔ 宿舍，← 教务管理 8002）----------
  await knex.schema.createTable('t_class_dorm_live_sync', (t) => {
    base(t);
    syncMeta(t);
    t.string('student_id', 36).notNullable().comment('学生ID');
    t.string('student_no', 32).notNullable().comment('学号');
    t.string('student_name', 50).notNullable().comment('学生姓名');
    t.string('class_id', 36).comment('班级ID');
    t.string('class_name', 50).comment('班级名称');
    t.string('dorm_id', 36).notNullable().comment('宿舍ID');
    t.string('dorm_no', 64).notNullable().comment('宿舍号');
    t.date('check_in_date').comment('入住日期');
    t.unique(['source_system', 'source_id'], { indexName: 'uk_live_source' });
    t.index('student_id', 'idx_live_student');
    t.index('dorm_id', 'idx_live_dorm');
    t.comment('宿舍住宿同步副本（源：教务管理）');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('t_class_dorm_live_sync');
  await knex.schema.dropTableIfExists('t_class_dorm_room_sync');
  await knex.schema.dropTableIfExists('t_class_urge_sync');
  await knex.schema.dropTableIfExists('t_class_fee_sync');
};
