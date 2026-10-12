/**
 * 第 4 期 · 第 4 批（2026-10-11 · 班级域）：`t_uni_class_transfer` 拆出岗位列
 * ============================================================
 *
 * 【★★ 为什么要加这一列 —— 这是七铁律第④条「语义冲突列必须分列」的一次补课】
 *
 *   一张 `t_uni_class_transfer` 现在被**两件完全不同的事**共用：
 *
 *     ① 岗位交接（`class/modules/class/class.route.ts` 的 `/transfer/add`）
 *        老表 `t_class_transfer.transfer_type` 是 `varchar(20)`，
 *        存的是**岗位名**：`headTeacher` / `teacher` / `assistant`
 *        → 回答的问题是「**换的是哪个岗位的人**」
 *
 *     ② 学生升学转班（`class/modules/approval/upgrade.route.ts`）
 *        统一表 `transfer_type` 是 `int(11)`，字典 1~5 + 6=升学转班，
 *        存的是**事由** → 回答的问题是「**为什么换**」
 *
 *   一个问「谁」、一个问「为什么」，塞进同一列 —— 后果实测过：
 *     `Incorrect integer value: 'headTeacher' for column
 *      sms_common.t_uni_class_transfer.transfer_type`
 *
 * 【★★ 斌哥 2026-10-11 拍板：方案 B（拆两列），不是 A（加字典档位）】
 *   A 方案（新增 7/8/9=班主任/教员/助教三档）：
 *     改动小，但把「人事动作（调岗/离职）」和「班级岗位名」混在同一列，
 *     将来这个模块要接人事异动时语义会打架 —— 且打破刚立的铁律④。
 *
 *   B 方案（本迁移）：
 *     `transfer_type` 回归「事由」语义（岗位交接一律填 1=调岗）；
 *     新列 `post_transfer_type` 专门回答「换的是哪个岗位」。
 *     一个字段只回答一个问题，将来「本月几次班主任交接」直接
 *     `where post_transfer_type = 1`，不用 like、不用靠人工解释历史。
 *
 * 【★ 为什么不给 `post_transfer_type` 加 NOT NULL + DEFAULT】
 *   铁律③说「NOT NULL 一律给默认」，但这里**必须可空**：
 *   现有 6 行种子数据、以及②学生升学转班写的行，`post_transfer_type`
 *   语义上就是「不适用」，硬给 0 或 1 反而是把不存在的岗位信息编造出来。
 *   → `int(11) NULL DEFAULT NULL`，不适用就留空，这是诚实的表达。
 *
 * 【幂等】先查列是否存在，存在直接跳过。
 * 【回滚】down 直接删列（会丢岗位信息，仅供紧急回退）。
 */

const TABLE = 't_uni_class_transfer';
const COL = 'post_transfer_type';

const COMMENT =
  '岗位交接类型 1班主任 2教员 3助教（★只对「岗位交接」这一类记录有值；' +
  '学生升学转班/其他事由交接一律留 NULL，不要瞎填）';

async function hasColumn(knex, col) {
  const r = await knex('information_schema.COLUMNS')
    .select('COLUMN_NAME as cn')
    .where('TABLE_SCHEMA', 'sms_common')
    .where('TABLE_NAME', TABLE)
    .where('COLUMN_NAME', col)
    .first();
  return !!r;
}

const up = async function (knex) {
  if (await hasColumn(knex, COL)) {
    console.log('  · ' + TABLE + '.' + COL + ' 已存在，跳过');
    return;
  }

  /* ★ 位置放在 transfer_type 之后，读表结构时一眼能看到「事由 + 岗位」这一对 */
  await knex.raw(
    'ALTER TABLE `' + TABLE + '` ADD COLUMN `' + COL + '` int(11) NULL DEFAULT NULL ' +
      "COMMENT '" +
      COMMENT +
      "' AFTER `transfer_type`",
  );
  console.log('  ✔ 已给 ' + TABLE + ' 增加 ' + COL + ' int(11) NULL（岗位交接类型）');

  /* 自检：确认列真的建出来了，且可空（铁律③在本列刻意破例，见文件头说明） */
  const c = await knex('information_schema.COLUMNS')
    .select('DATA_TYPE as dt', 'IS_NULLABLE as nullable')
    .where('TABLE_SCHEMA', 'sms_common')
    .where('TABLE_NAME', TABLE)
    .where('COLUMN_NAME', COL)
    .first();
  if (!c) throw new Error(COL + ' 建表后仍查不到，迁移中止');
  if (c.nullable !== 'YES') throw new Error(COL + ' 应为可空，实际 ' + c.nullable + '，迁移中止');
  console.log('  ✔ 自检通过：' + COL + ' 类型=' + c.dt + ' 可空=' + c.nullable);
};

const down = async function (knex) {
  if (!(await hasColumn(knex, COL))) {
    console.log('  · ' + COL + ' 不存在，无需回滚');
    return;
  }
  await knex.raw('ALTER TABLE `' + TABLE + '` DROP COLUMN `' + COL + '`');
  console.log('  ⚠ 已删除 ' + COL + '（岗位信息丢失，仅供紧急回退）');
};

module.exports = { up, down };