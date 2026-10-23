/**
 * 迁移：修复「统一班级表」绑定的阶段指向已删除行（配合 20261022_003）
 *
 * ★ 2026-10-22。
 *
 * 【为什么 003 不够】
 *   教学域默认走统一表（`TEACHING_UNI_TABLE !== '0'`，见 teaching/shared/uniTable.ts），
 *   班级列表读的是 `sms_common.t_uni_class`，不是 `sms_class.t_class_info`。
 *   003 只修了三张业务表，页面上看到的仍是旧绑定：
 *   编辑班级时「阶段」下拉显示一串 uuid，改方案阶段名也不跟着变。
 *
 * 【修法】与 003 同规则：
 *   ① scheme_stage_id 还活着 → 同步名字
 *   ② 否则按阶段名找
 *   ③ 再否则按 stage_code（统一表里阶段列叫 stage_code）找
 *   找到后改写 scheme_stage_id / scheme_stage_name；stage_code 若不在该方案
 *   的有效编码里，一并纠正（Q17 那个班现在是 13，应为 201）。
 */

const SCHEME_STAGE_T = 't_class_stage_scheme_stage';
const UNI_DB = process.env.DB_NAME_COMMON || 'sms_common';
const UNI_CLASS_T = 't_uni_class';

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(SCHEME_STAGE_T))) return;

  let rows;
  try {
    [rows] = await knex.raw(
      `SELECT id, class_name, stage_code, scheme_id, scheme_stage_id, scheme_stage_name
         FROM \`${UNI_DB}\`.\`${UNI_CLASS_T}\`
        WHERE is_deleted = 0 AND scheme_id IS NOT NULL`,
    );
  } catch {
    return; // 统一表还没建
  }
  if (!rows?.length) return;

  for (const c of rows) {
    const schemeId = String(c.scheme_id ?? '').trim();
    if (!schemeId) continue;

    let live;
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
    const byCode = live.find((s) => s.stage_code !== null && Number(s.stage_code) === Number(c.stage_code));

    const hit = byId || byName || byCode;
    if (!hit) continue;

    const patch = {};
    if (String(hit.id) !== String(c.scheme_stage_id ?? '')) patch.scheme_stage_id = String(hit.id);
    if (String(hit.stage_name ?? '') !== String(c.scheme_stage_name ?? '')) patch.scheme_stage_name = String(hit.stage_name ?? '');

    if (hit.stage_code !== null && hit.stage_code !== undefined && Number(hit.stage_code) !== Number(c.stage_code)) {
      const codeValid = live.some((s) => s.stage_code !== null && Number(s.stage_code) === Number(c.stage_code));
      if (!codeValid) patch.stage_code = Number(hit.stage_code);
    }

    if (Object.keys(patch).length) {
      const cols = Object.keys(patch);
      const sets = cols.map((k) => `\`${k}\` = ?`).join(', ');
      await knex.raw(
        `UPDATE \`${UNI_DB}\`.\`${UNI_CLASS_T}\` SET ${sets} WHERE id = ?`,
        [...cols.map((k) => patch[k]), c.id],
      );
    }
  }
};

exports.down = async function down() {
  /* 数据修复不可逆 */
};
