/**
 * 迁移脚本：创建宿舍管理相关表
 *
 * 来源：教务管理原型 dorm.html（宿舍管理页）
 *   - 宿舍总名单：楼栋 / 宿舍号 / 类别 / 额定人数 + 每间 8 个床位的入住明细
 *   - 申请审批：换宿申请、退宿申请
 *   - 退宿名单：已退宿记录
 *
 * 表设计要点：
 *   1. t_dorm_room   一间宿舍一行（A-1 楼 101 房）
 *   2. t_dorm_bed    一个床位一行。非空床位也有记录，但 student_no 为空，
 *                    这样前端才能渲染出「8 行床位、空床位显示空床位」的效果
 *   3. 两张申请表分开建，因为字段差异不小（退宿多一个联系电话，换宿多目标宿舍）
 *
 * ⚠️ 铁律：不许直接连数据库改表结构，一切变更走脚本！
 */

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
  /* ---------- 1. 宿舍房间 ---------- */
  if (!(await knex.schema.hasTable('t_dorm_room'))) {
    await knex.schema.createTable('t_dorm_room', (table) => {
      COMMON(table);

      table.integer('category').notNullable().comment('类别 1男寝 2女寝');
      table.string('building', 20).notNullable().comment('宿舍楼 A-1/A-2/B-1/B-2');
      table.string('room', 20).notNullable().comment('宿舍号 如 101');
      table.integer('capacity').notNullable().defaultTo(8).comment('额定人数');

      table.unique(['building', 'room'], { indexName: 'uk_dorm_building_room' });
      table.index(['category'], 'idx_dorm_category');
      table.index(['building'], 'idx_dorm_building');

      table.comment('宿舍房间表');
    });
  }

  /* ---------- 2. 床位 / 入住明细 ---------- */
  if (!(await knex.schema.hasTable('t_dorm_bed'))) {
    await knex.schema.createTable('t_dorm_bed', (table) => {
      COMMON(table);

      table.string('room_id', 36).notNullable().comment('所属宿舍ID');
      table.string('bed_no', 10).notNullable().comment('床位号 1-下/1-上/2-下/2-上/3-下/3-上/4-下/4-上');
      table.integer('bed_index').notNullable().comment('床位序号 1~8，用于固定排序');

      // 空床位这几列都为空
      table.string('student_no', 32).comment('入住宿学生学号');
      table.string('student_name', 50).comment('入住学生姓名');
      table.string('class_name', 50).comment('班级');
      table.string('head_teacher_name', 50).comment('班主任');

      table.unique(['room_id', 'bed_no'], { indexName: 'uk_bed_room_bedno' });
      table.index(['room_id'], 'idx_bed_room');
      table.index(['student_no'], 'idx_bed_student_no');

      table.comment('宿舍床位入住明细表');
    });
  }

  /* ---------- 3. 换宿申请 ---------- */
  if (!(await knex.schema.hasTable('t_dorm_change_apply'))) {
    await knex.schema.createTable('t_dorm_change_apply', (table) => {
      COMMON(table);

      table.string('apply_no', 32).notNullable().comment('申请单号');
      table.string('student_name', 50).notNullable().comment('申请人');
      table.string('class_name', 50).comment('班级');
      table.string('head_teacher_name', 50).comment('班主任');

      table.string('from_building', 20).comment('现居宿舍楼');
      table.string('from_room', 20).comment('现居宿舍号');
      table.string('from_bed', 10).comment('现床位号');

      table.string('to_building', 20).comment('更换宿舍楼');
      table.string('to_room', 20).comment('更换宿舍号');
      table.string('to_bed', 10).comment('新床位号');

      table.string('reason', 100).comment('更换原因');
      table.date('apply_date').comment('申请日期');
      table.integer('status').notNullable().defaultTo(1).comment('状态 1待审核 2已同意 3已驳回');
      table.string('reject_reason', 200).comment('驳回原因');

      table.index(['status'], 'idx_change_status');
      table.index(['class_name'], 'idx_change_class');

      table.comment('换宿申请表');
    });
  }

  /* ---------- 4. 退宿申请 ---------- */
  if (!(await knex.schema.hasTable('t_dorm_quit_apply'))) {
    await knex.schema.createTable('t_dorm_quit_apply', (table) => {
      COMMON(table);

      table.string('apply_no', 32).notNullable().comment('申请单号');
      table.string('student_name', 50).notNullable().comment('申请人');
      table.string('class_name', 50).comment('班级');
      table.string('head_teacher_name', 50).comment('班主任');

      table.string('quit_building', 20).comment('退宿宿舍楼');
      table.string('quit_room', 20).comment('退宿宿舍号');
      table.string('quit_bed', 10).comment('床位号');

      table.string('reason', 100).comment('退宿原因');
      table.date('apply_date').comment('申请日期');
      table.string('phone', 20).comment('联系电话');
      table.integer('status').notNullable().defaultTo(1).comment('状态 1待审核 2已同意 3已驳回');
      table.string('reject_reason', 200).comment('驳回原因');

      table.index(['status'], 'idx_quit_status');
      table.index(['class_name'], 'idx_quit_class');

      table.comment('退宿申请表');
    });
  }

  /* ---------- 5. 退宿名单（已退宿） ---------- */
  if (!(await knex.schema.hasTable('t_dorm_checkout'))) {
    await knex.schema.createTable('t_dorm_checkout', (table) => {
      COMMON(table);

      table.string('student_name', 50).notNullable().comment('申请人');
      table.string('quit_building', 20).comment('退宿宿舍楼');
      table.string('quit_room', 20).comment('退宿宿舍号');
      table.string('quit_bed', 10).comment('床位号');
      table.string('class_name', 50).comment('班级');
      table.date('checkout_date').comment('退宿时间');
      table.string('phone', 20).comment('联系电话');

      table.index(['class_name'], 'idx_checkout_class');
      table.index(['quit_building'], 'idx_checkout_building');

      table.comment('已退宿名单表');
    });
  }
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('t_dorm_checkout');
  await knex.schema.dropTableIfExists('t_dorm_quit_apply');
  await knex.schema.dropTableIfExists('t_dorm_change_apply');
  await knex.schema.dropTableIfExists('t_dorm_bed');
  await knex.schema.dropTableIfExists('t_dorm_room');
};
