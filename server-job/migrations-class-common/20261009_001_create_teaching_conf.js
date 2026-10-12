/**
 * 教学域统一配置表（sms_common.t_teaching_conf）· 第 2 期
 * ============================================================
 *
 * 【为什么需要这张表】
 *   第 2 期要把「初高 / 大学 / 实训」三套出勤合成一套。
 *   但三套的**业务规则不一样**（出勤状态码、应到/实到口径），不能写死在代码里：
 *     · 写死 → 以后哪一学段改口径就要改代码、重新发版
 *     · 配置化 → 改一行 JSON 即可，三个学段互不影响
 *
 * 【它同时是后面 8 个域的配置载体】
 *   成绩公式、退费审批链、催费口径……将来都往这张表里放。
 *   所以这张表虽小，却是整个合并工程的基础设施。
 *
 * 【为什么放 sms_common】
 *   sms_common 本来就是「公共字典 / 跨模块共享」定位（已有 4 张 *_sync 表）。
 *   三个学段的库各连各的，配置放谁的库里都不合适，放公共库最自然。
 *
 * 【放的是 JSON 字符串】
 *   每个 conf_key 一行，值是一个 JSON：
 *     attendance.statusMap → { "jh": {...}, "class": {}, "job": {...} }
 *     attendance.scope     → { "jh": {...}, "class": {...}, "job": {...} }
 *   ⚠️ 代码里有**同值的硬编码默认值**（src/teaching/shared/conf.ts）——
 *      表不存在/没数据时自动降级，不会让整个出勤页打不开。
 */

const TABLE = 't_teaching_conf';

exports.up = async function up(knex) {
  const exists = await knex.schema.hasTable(TABLE);
  if (exists) return;

  await knex.schema.createTable(TABLE, (t) => {
    t.string('id', 36).primary().comment('主键UUID');
    t.string('conf_key', 64).notNullable().comment('配置键，如 attendance.statusMap');
    t.text('conf_value', 'longtext').notNullable().comment('配置值（JSON 字符串）');
    t.string('remark', 255).comment('说明');
    t.datetime('create_time').notNullable().comment('创建时间');
    t.string('create_by', 36).comment('创建人ID');
    t.datetime('update_time').comment('最后修改时间');
    t.string('update_by', 36).comment('最后修改人ID');
    t.boolean('is_deleted').notNullable().defaultTo(false).comment('逻辑删除');
    t.unique(['conf_key'], { indexName: 'uk_teaching_conf_key' });
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists(TABLE);
};
