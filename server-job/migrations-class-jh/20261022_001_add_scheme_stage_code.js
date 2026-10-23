/**
 * 迁移：阶段方案明细加「阶段编码」列
 *
 * ★ 2026-10-22。背景（真实故障）：
 *
 *   阶段方案里只存了「阶段名称 + 学制月数」，**没有阶段编码**。
 *   而班级 / 学生表里的 `stage` 是整数编码（101~107 / 201~206 / 301~303），
 *   于是「名称 → 编码」只能靠 t_uni_stage_def 按名字反查：
 *
 *     const code = codeOf.get([dept, stageName].join('|'));
 *     if (code === undefined) continue;      // ← 查不到就当没有，直接丢弃
 *
 *   结果：用户在方案里写「实训」「1」这类字典里没有的名字，
 *   这个阶段就被静默丢掉 —— 班级表单选完方案后「阶段」下拉是空的，
 *   班级管理点「升实训」时就业部阶段显示「无数据」。
 *
 *   修法：方案明细自己带编码，读的时候不再依赖名字匹配。
 *   列可空：历史数据由下一条迁移回填；运行期写入时由代码补齐。
 */

const TABLE = 't_class_stage_scheme_stage';
const COL = 'stage_code';

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) return;
  if (await knex.schema.hasColumn(TABLE, COL)) return;
  await knex.schema.alterTable(TABLE, (t) => {
    t.integer(COL).nullable().comment('阶段编码（1xx 初高 / 2xx 大学 / 3xx 就业），对应班级、学生表的 stage');
    t.index(['scheme_id', COL], `${TABLE}_${COL}_idx`);
  });
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable(TABLE))) return;
  if (!(await knex.schema.hasColumn(TABLE, COL))) return;
  await knex.schema.alterTable(TABLE, (t) => {
    t.dropIndex(['scheme_id', COL], `${TABLE}_${COL}_idx`);
    t.dropColumn(COL);
  });
};
