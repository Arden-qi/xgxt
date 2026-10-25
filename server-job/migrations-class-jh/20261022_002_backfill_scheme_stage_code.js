/**
 * 迁移：回填「阶段方案明细」的阶段编码
 *
 * ★ 2026-10-22，配合 20261022_001 加列之后执行。
 *
 * 【三条规则，按顺序】
 *   ① 同名沿用：方案里的阶段名在该部门旧阶段字典（t_class_stage）里能查到同名
 *      → 直接用它原来的编码。
 *      （初高「预科 / 初中部1期…」、大学「一阶段 / 二阶段…」走这条，
 *        编码保持 101~107 / 201~203 不变，历史数据零影响。）
 *   ② 就业部单阶段：用户 2026-10-22 明确口径 ——
 *      「就业部就一个『实训』阶段，复用阶段码 301」。
 *      所以就业部方案里的阶段统一绑到 301，并把字典里 301 的名字从
 *      「一阶段」改成方案里的名字（现有班级 / 学生存的都是 301，
 *      改完它们的「阶段」列会直接显示成「实训」，不需要洗数据）。
 *      302 / 303 原样保留（以后要拆二/三阶段时还能用）。
 *   ③ 兜底分配：既查不到同名、也不属于上面特例的（例如临时方案「1111」里的「1」），
 *      在该部门号段（1xx / 2xx / 3xx）里取第一个空号，
 *      并把新号写进 t_class_stage，保证列表里能显示中文名。
 *
 * 【为什么号段按部门硬编码】
 *   与既有约定一致：101~ 初高、201~ 大学、301~ 就业（见 setting.route 的
 *   nextStageCode 注释，本次改造后该函数随旧接口一起删除）。
 */

const SCHEME_T = 't_class_stage_scheme';
const SCHEME_STAGE_T = 't_class_stage_scheme_stage';
const STAGE_T = 't_class_stage';

/** 部门号段起点 */
const BASE_OF_DEPT = { 1: 100, 2: 200, 3: 300 };

/** 就业部复用码（用户口径：只有一个「实训」阶段） */
const EMP_DEPT = 3;
const EMP_CODE = 301;

exports.up = async function up(knex) {
  const hasCol = await knex.schema.hasColumn(SCHEME_STAGE_T, 'stage_code');
  if (!hasCol) return;
  /* ★ 2026-10-23 补守卫：本迁移要回查旧阶段字典 t_class_stage，
     该老表在 P8 归一后已 DROP（统一表模式用 t_uni_stage_def）。
     表不存在 → 跳过，migrate 不再因此失败。 */
  if (!(await knex.schema.hasTable(STAGE_T))) return;

  const schemes = await knex(SCHEME_T).where('is_deleted', 0).select('id', 'dept_code');
  if (!schemes.length) return;
  const deptOf = new Map(schemes.map((s) => [String(s.id), Number(s.dept_code)]));

  const stages = await knex(SCHEME_STAGE_T)
    .where('is_deleted', 0)
    .whereNull('stage_code')
    .orderBy('scheme_id')
    .orderBy('sort_no')
    .select('id', 'scheme_id', 'stage_name', 'study_months');

  const dict = await knex(STAGE_T).where('is_deleted', 0).select('stage_code', 'stage_name', 'dept_code');
  const nameToCode = new Map(); // `${dept}|${name}` -> code
  const usedByDept = new Map(); // dept -> Set(code)
  for (const d of dict) {
    const dept = Number(d.dept_code);
    nameToCode.set(`${dept}|${String(d.stage_name ?? '').trim()}`, Number(d.stage_code));
    if (!usedByDept.has(dept)) usedByDept.set(dept, new Set());
    usedByDept.get(dept).add(Number(d.stage_code));
  }

  const now = new Date();

  /** 往旧阶段字典里补一行，保证编码有中文名可显示 */
  async function ensureDict(deptCode, code, stageName, studyMonths) {
    const existed = await knex(STAGE_T)
      .where({ dept_code: deptCode, stage_code: code })
      .first();
    if (existed) {
      if (String(existed.stage_name) !== stageName) {
        await knex(STAGE_T).where({ id: existed.id }).update({ stage_name: stageName, update_time: now });
      }
      return;
    }
    await knex(STAGE_T).insert({
      id: randomId(),
      stage_code: code,
      stage_name: stageName,
      dept_code: deptCode,
      study_months: studyMonths === null || studyMonths === undefined ? null : Number(studyMonths),
      sort_no: 0,
      plan_id: null,
      is_deleted: 0,
      create_time: now,
      create_by: 'system',
    });
  }

  for (const s of stages) {
    const dept = deptOf.get(String(s.scheme_id));
    if (!dept) continue;
    const name = String(s.stage_name ?? '').trim();
    if (!name) continue;

    // ① 同名沿用
    let code = nameToCode.get(`${dept}|${name}`) ?? null;

    // ② 就业部：只有一个阶段时复用 301（用户口径）
    if (code === null && dept === EMP_DEPT) code = EMP_CODE;

    // ③ 兜底：号段内第一个空号
    if (code === null) {
      const base = BASE_OF_DEPT[dept] ?? 100;
      if (!usedByDept.has(dept)) usedByDept.set(dept, new Set());
      const used = usedByDept.get(dept);
      let n = base + 1;
      while (used.has(n) && n < base + 100) n += 1;
      code = n;
    }

    if (!usedByDept.has(dept)) usedByDept.set(dept, new Set());
    usedByDept.get(dept).add(code);

    await knex(SCHEME_STAGE_T).where({ id: s.id }).update({ stage_code: code, update_time: now });
    // 让编码在字典里有名字（301 那种同名不同名的，这里会把名字对齐成方案里的名字）
    await ensureDict(dept, code, name, s.study_months);
  }
};

exports.down = async function down(knex) {
  const hasCol = await knex.schema.hasColumn(SCHEME_STAGE_T, 'stage_code');
  if (!hasCol) return;
  await knex(SCHEME_STAGE_T).update({ stage_code: null });
};

function randomId() {
  // 迁移里不想引 node:crypto 的细节，够用即可
  return 'mig-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36);
}
