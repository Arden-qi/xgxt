/**
 * 迁移脚本：学生主档补 4 个「档案类」字段
 *
 * 起因（斌哥 2026-09-30）：
 *   班级信息管理页要加「详情」弹窗，参考页的「基础信息」里有
 *   出生日期 / 籍贯 / 毕业院校 / 家庭住址 四栏，我们的学生表里没有。
 *
 * 为什么放学生主档（而不是新开一张"学生档案表"）：
 *   这 4 个字段和「姓名/性别/学历」是同一层级的**静态属性**，
 *   不是会不断增长的流水数据。放同一张表查起来最省事，
 *   也不用为了几列再写一次 join。
 *
 * ⚠️ 全部 nullable —— 历史数据（已存在的学生）这 4 个字段都是空的，
 *    给 NOT NULL 会直接把迁移跑挂。
 *
 * ⚠️ 身份证照片 / 户口本照片 **本期不加字段**：
 *    photo 走的是文件上传 + 存储，方案还没定（斌哥说"先做界面不接上传"）。
 *    等文件存储方案定下来再单独加一列存路径。
 *
 * ⚠️ 铁律：不许直接连数据库改表结构，一切变更走脚本！
 */

/**
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('t_student_base', (t) => {
    t.date('birth_date').nullable().comment('出生日期');
    t.string('native_place', 64).nullable().comment('籍贯，如「黑龙江哈尔滨」');
    t.string('graduate_school', 128).nullable().comment('毕业院校');
    t.string('home_address', 255).nullable().comment('家庭住址');
  });
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  await knex.schema.alterTable('t_student_base', (t) => {
    t.dropColumn('birth_date');
    t.dropColumn('native_place');
    t.dropColumn('graduate_school');
    t.dropColumn('home_address');
  });
};
