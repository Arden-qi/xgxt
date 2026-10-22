/**
 * 迁移：统一班级表补 `class_no`（班号）+ 回填初高历史班
 * ============================================================
 * 【为什么】
 *   2026-10-21 的学号新规：学号 = LZ + J/T + **班号(3位)** + 班内序号(3位)。
 *   远端那版迁移只给老表 `sms_class_jh.t_class_info` 加了 class_no，
 *   P8 之后建班/建学生都写 `sms_common.t_uni_class` → 缺这一列会直接报
 *   「数据库字段不存在」，初高部新建班级/学生全部失败。
 *
 * 【回填口径（与远端一致）】
 *   · 只补 class_no 为 NULL 的初高班（不覆盖已分配的班号，可重复执行）
 *   · 按「学部组」各自从 101 起：J 组(预科 101 + 初中 102~104) / T 组(高中 105~107)
 *   · 组内按 create_time 先后编号
 */

const TABLE = 't_uni_class';

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable(TABLE))) return;
  if (!(await knex.schema.hasColumn(TABLE, 'class_no'))) {
    await knex.schema.alterTable(TABLE, (t) => {
      t.integer('class_no').comment(
        '班号(101起, 同学部组按创建顺序分配; 学号=LZ+J/T+班号+班内序号)',
      );
    });
  }

  // 回填：初高班按学部组（J: <105 / T: >=105）各自从 101 递增
  const rows = await knex(TABLE)
    .where({ edu_stage: 'jh' })
    .whereNull('class_no')
    .orderBy('create_time', 'asc')
    .select('id', 'stage_code');
  if (!rows.length) return;

  const seq = { J: 100, T: 100 };
  for (const r of rows) {
    const letter = Number(r.stage_code) >= 105 ? 'T' : 'J';
    seq[letter] += 1;
    // eslint-disable-next-line no-await-in-loop
    await knex(TABLE).where({ id: r.id }).update({ class_no: seq[letter] });
  }
};

exports.down = async function (knex) {
  if (!(await knex.schema.hasTable(TABLE))) return;
  if (!(await knex.schema.hasColumn(TABLE, 'class_no'))) return;
  await knex.schema.alterTable(TABLE, (t) => t.dropColumn('class_no'));
};
