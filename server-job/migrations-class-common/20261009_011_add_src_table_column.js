/**
 * 第 3 期 · 阶段 B 补丁：给 6 张表补 `src_table` 列
 * ============================================================
 *
 * 【为什么补 —— 这是阶段 C 迁移实测抓出来的建表遗漏】
 *   阶段 B 我在 `t_uni_student` / `t_uni_class` 两张表手写了
 *   `t.string('src_table', 64)`，另外 6 张忘了写。
 *   阶段 C 迁移脚本报 `Unknown column 'src_table'` 才暴露出来。
 *
 *   为什么阶段 B 的验收脚本没抓到？
 *   —— 它只检查了 `src_db` + `src_id`（我设计铁律⑤时只想到了这两个），
 *      **没把 `src_table` 列进必检清单**。
 *   → 教训：验收脚本的「必检列」必须和建表脚本的「设计意图」逐条对齐，
 *      否则漏一列要到运行时才发现。
 *
 * 【为什么这列必须补】
 *   `src_db` 只说明「来自哪个库」，但一个库里可能有多张源表
 *   （如 sms_class 里有 t_class_info / t_class_attendance / …）。
 *   没有 `src_table` 就无法回答「这条记录原来在哪张表」，溯源链断一半。
 *
 * 【幂等】列已存在就跳过，所以可以重复跑。
 */

const TABLES = [
  't_uni_student',
  't_uni_class',
  't_uni_class_student',
  't_uni_attendance',
  't_uni_exam',
  't_uni_exam_field',
  't_uni_repeat',
  't_uni_dorm_apply',
];

const up = async function (knex) {
  for (const t of TABLES) {
    const exists = await knex.schema.hasColumn(t, 'src_table');
    if (exists) continue;
    await knex.schema.alterTable(t, (tb) => {
      tb.string('src_table', 64).comment('★来源表名（阶段 B 首版漏建，阶段 C 实测发现后补）');
    });
  }
};

const down = async function (knex) {
  for (const t of TABLES) {
    const exists = await knex.schema.hasColumn(t, 'src_table');
    if (!exists) continue;
    await knex.schema.alterTable(t, (tb) => {
      tb.dropColumn('src_table');
    });
  }
};

module.exports = { up, down };
