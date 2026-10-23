/**
 * 迁移：修复「班级绑定的阶段」指向已删除阶段行的问题
 *
 * ★ 2026-10-22，配合 20261022_001/002。
 *
 * 【问题怎么来的】
 *   老版本的「保存方案」是「先把方案下所有阶段软删，再用新 uuid 重插」。
 *   而班级表里的 `scheme_stage_id` 指向的是旧 id —— 每保存一次方案，
 *   所有引用它的班级就变成「指着一行已删除的阶段」：
 *     · 编辑班级时「阶段」下拉找不到这个 id，直接把 uuid 显示出来
 *     · 方案里改阶段名，这些班级也不会跟着变（同步按 id 找不到人）
 *
 * 【怎么修】
 *   逐个班级，在它所属方案里找回真正的阶段行：
 *     ① scheme_stage_id 还活着 → 直接同步名字
 *     ② 否则按「阶段名」找（大多数情况能对上）
 *     ③ 再否则按「阶段码 = 班级的 stage」找
 *   找到后把 scheme_stage_id / scheme_stage_name 改写为现行值；
 *   若班级的 stage 码不在该方案的有效阶段里，一并纠正成阶段的真实编码
 *   （例如大学部那个 stage=13 的班，阶段名是「一阶段」，应回到 201）。
 *
 *   找不到对应阶段的（方案被删过 / 阶段被删过）一律**不动**，
 *   留给前端兜底与人工处理，避免迁移猜错数据。
 */

const SCHEME_STAGE_T = 't_class_stage_scheme_stage';

/** 三张班级表所在的库（可用环境变量覆盖） */
const CLASS_TABLES = [
  { db: process.env.DB_NAME_CLASS_JH || 'sms_class_jh', table: 't_class_info' },
  { db: process.env.DB_NAME_CLASS || 'sms_class', table: 't_class_info' },
  { db: process.env.DB_NAME || 'sms_job', table: 't_job_class' },
];

exports.up = async function up(knex) {
  const hasStageCode = await knex.schema.hasColumn(SCHEME_STAGE_T, 'stage_code');
  if (!hasStageCode) return;

  for (const t of CLASS_TABLES) {
    let rows;
    try {
      [rows] = await knex.raw(
        `SELECT id, class_name, stage, scheme_id, scheme_stage_id, scheme_stage_name
           FROM \`${t.db}\`.\`${t.table}\`
          WHERE is_deleted = 0 AND scheme_id IS NOT NULL`,
      );
    } catch {
      continue; // 该学段的表不存在
    }
    if (!rows?.length) continue;

    for (const c of rows) {
      const schemeId = String(c.scheme_id ?? '').trim();
      if (!schemeId) continue;

      let live = [];
      try {
        [live] = await knex.raw(
          `SELECT id, stage_code, stage_name
             FROM \`${SCHEME_STAGE_T}\`
            WHERE scheme_id = ? AND is_deleted = 0
            ORDER BY sort_no`,
          [schemeId],
        );
      } catch {
        continue;
      }
      if (!live?.length) continue;

      const byId = c.scheme_stage_id ? live.find((s) => String(s.id) === String(c.scheme_stage_id)) : null;
      const byName = live.find((s) => String(s.stage_name ?? '').trim() === String(c.scheme_stage_name ?? '').trim());
      const byCode = live.find((s) => s.stage_code !== null && Number(s.stage_code) === Number(c.stage));

      const hit = byId || byName || byCode;
      if (!hit) continue;

      const patch = {};
      if (String(hit.id) !== String(c.scheme_stage_id ?? '')) patch.scheme_stage_id = String(hit.id);
      if (String(hit.stage_name ?? '') !== String(c.scheme_stage_name ?? '')) patch.scheme_stage_name = String(hit.stage_name ?? '');

      // 班级的阶段码不在该方案的有效编码里 → 纠正（如 13 → 201）
      if (hit.stage_code !== null && hit.stage_code !== undefined && Number(hit.stage_code) !== Number(c.stage)) {
        const codeValid = live.some((s) => s.stage_code !== null && Number(s.stage_code) === Number(c.stage));
        if (!codeValid) patch.stage = Number(hit.stage_code);
      }

      if (Object.keys(patch).length) {
        const cols = Object.keys(patch);
        const sets = cols.map((k) => `\`${k}\` = ?`).join(', ');
        await knex.raw(
          `UPDATE \`${t.db}\`.\`${t.table}\` SET ${sets} WHERE id = ?`,
          [...cols.map((k) => patch[k]), c.id],
        );
      }
    }
  }
};

exports.down = async function down() {
  /* 数据修复不可逆（也不该回滚成脏引用） */
};
