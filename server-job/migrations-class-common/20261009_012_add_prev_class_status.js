/**
 * 第 3 期补丁：给 t_uni_class 补 `prev_class_status`
 * ============================================================
 *
 * 【为什么补 —— 写第 4 期方案时实测发现】
 *   `t_job_class`（实训班级表）有两列 `t_uni_class` 没有：
 *     · `student_count`      → 已由 `student_count_cached` 覆盖 ✅
 *     · `prev_class_status`  → **漏了** ❌
 *
 *   `prev_class_status` 是「**封班前是什么状态**」——
 *   实训班封班后想回退，要靠它恢复原状态（1开放 / 2封班）。
 *   第 2 期班级域做「结业」时用过（`repo.job.ts` 的 save() 里写它）。
 *
 * 【为什么现在补最便宜】
 *   表里 0 行 —— 加列不需要搬数据、不需要回填。
 *   等灌了真实数据再加，就得重写一遍迁移脚本。
 *
 * 【幂等】列已存在就跳过。
 */

const up = async function (knex) {
  const exists = await knex.schema.hasColumn('t_uni_class', 'prev_class_status');
  if (exists) return;
  await knex.schema.alterTable('t_uni_class', (t) => {
    t.integer('prev_class_status').comment(
      '★封班/结业前的班级状态（1开放 2封班）—— 回退时靠它恢复。' +
        '源字段 t_job_class.prev_class_status，第 3 期建表时漏了',
    );
  });
};

const down = async function (knex) {
  const exists = await knex.schema.hasColumn('t_uni_class', 'prev_class_status');
  if (!exists) return;
  await knex.schema.alterTable('t_uni_class', (t) => {
    t.dropColumn('prev_class_status');
  });
};

module.exports = { up, down };
