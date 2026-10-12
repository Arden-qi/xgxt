/**
 * 第 4 期 · 第 1 批（宿舍域）· 迁移 025
 * ============================================================
 * 新建 t_uni_dorm_change —— 宿舍换宿/退宿单的**完整版**统一表
 *
 * 【为什么必须新建，不能直接用 t_uni_dorm_change_log】
 *   上一轮列覆盖实测（29 条映射）查出：
 *     sms_job.t_job_dorm_change    31 列 → t_uni_dorm_change_log 只有 17 列，**缺 21 列**
 *     sms_class.t_class_dorm_change_log 15 列 → 全覆盖
 *   缺的全是换宿单的核心字段：old_dorm_id / new_dorm_id / old_bed_id / new_bed_id
 *   （从哪个宿舍哪个床 → 换到哪个宿舍哪个床）、head_teacher_opinion（班主任意见）、
 *   approval_id / approval_status（审批状态）、biz_type、class_id、phone…
 *   → 「换宿」这件事的核心就是「从哪换到哪」，缺了这些等于表没建。
 *
 * 【方案 B：同步字段不带过来，只重建换宿单】
 *   斌哥 2026-10-10 拍板方案 B。三处取舍：
 *   ① 大学同步表的 source_system / source_id / source_batch_no /
 *      source_update_time / sync_status 五列 —— **不搬**。
 *      理由：这五列是「数据是从教务系统哪次同步来的」的**投递标签**，
 *      业务页面一个都不用，读新表的 171 处代码也没有一处读它们。
 *      去掉后「这行是同步来的还是本地建的」这个信息会丢，
 *      但既然三个学段的数据将来都在同一张表里，靠 edu_stage 就够了。
 *   ② t_job_dorm_change 的 31 列 —— **全搬**（换宿单是真实业务，不能省）。
 *   ③ 大学表的 from_dorm_id/to_dorm_id/change_time 与实训的
 *      old_dorm_id/new_dorm_id/change_date **是同一个东西的两种叫法** →
 *      **不建重复列**，统一用实训命名（语义更准：old/new 明确区分前后），
 *      读大学老表时由仓储层显式翻译（`from_` → `old_`）。
 *
 * 【为什么 t_uni_dorm_change_log 保留不删】
 *   它是「换宿流水日志」语义（谁在什么时候换了宿舍，只有 before/after 房号），
 *   和 t_uni_dorm_change（换宿**申请单**，带审批链）是两回事，
 *   字段集合不同 —— 老表确实有这两张表，归一后也保留两张，不强行合并。
 */

const T = 't_uni_dorm_change';

exports.up = async function up(knex) {
  const exists = await knex.schema.hasTable(T);
  if (!exists) {
    await knex.schema.createTable(T, (t) => {
      /* ---------- 统一表七件套约定 ---------- */
      // ⚠️ knex 的 `.primary()` 会中断链式调用（返回的对象没有 commentTo），
      //   所以注释必须写在 `.primary()` **之前**。
      t.string('id', 36).comment('主键（randomUUID）').primary();
      t.string('edu_stage', 16).notNullable()
        .comment('学段 jh初高/class大学/job实训（★不是阶段码，阶段码在 stage_code）');
      t.integer('stage_code').nullable()
        .comment('学段内阶段码（初高101/大学201~206）');
      t.tinyint('is_deleted').notNullable().defaultTo(0).comment('软删');
      t.string('create_by', 36).notNullable().defaultTo('');
      t.dateTime('create_time').nullable();
      t.string('update_by', 36).notNullable().defaultTo('');
      t.dateTime('update_time').nullable();

      /* ---------- 学生信息（来自 t_job_dorm_change） ---------- */
      // ⚠️ 这里**故意不用 .index()**：本 knex 版本的 `.index()` 会生成
      //   `t_uni_dorm_change_<col>_index` 这种自动名索引，与下面显式建的
      //   `idx_dc_xxx` 重复（同一列两套索引，白白拖慢写入）。
      //   统一由 up() 末尾的索引循环显式创建，名字可控。
      t.integer('biz_type').notNullable().defaultTo(0)
        .comment('★业务类型（老表 idx_change_biz_type）：沿用各学段原码，不做跨学段统一');
      t.string('student_id', 36).notNullable().defaultTo('').comment('学生主档 id');
      t.string('student_no', 32).defaultTo(null).comment('学号');
      t.string('student_name', 50).defaultTo(null).comment('姓名');
      t.integer('gender').nullable().comment('性别');
      t.string('phone', 20).nullable().comment('联系电话');
      t.string('class_id', 36).nullable().comment('班级 id');
      t.string('class_name', 50).nullable().comment('班级名称');
      t.integer('dept_code').nullable().comment('★数据权限部门码（★不要默认 0，见下方说明）');
      t.string('head_teacher_id', 36).nullable().comment('班主任 id');
      t.string('head_teacher_name', 50).nullable().comment('班主任姓名');

      /* ---------- 换宿前（old_*） ---------- */
      t.string('old_dorm_id', 36).nullable().comment('原宿舍（房间）id');
      t.string('old_dorm_no', 20).nullable().comment('原宿舍号');
      t.string('old_bed_id', 36).nullable().comment('原床位 id');
      t.string('old_bed_no', 10).nullable().comment('原床位号');

      /* ---------- 换宿后（new_*） ---------- */
      t.string('new_dorm_id', 36).nullable().comment('目标宿舍（房间）id');
      t.string('new_dorm_no', 20).nullable().comment('目标宿舍号');
      t.string('new_bed_id', 36).nullable().comment('目标床位 id');
      t.string('new_bed_no', 10).nullable().comment('目标床位号');

      /* ---------- 换宿主信息 ---------- */
      t.date('change_date').notNullable().comment('换宿日期');
      t.string('change_reason', 500).notNullable().defaultTo('').comment('换宿原因');
      t.string('head_teacher_opinion', 500).nullable().comment('班主任意见');
      t.string('approval_id', 36).nullable().comment('★关联审批单 id（approval_status 表示本单自身状态）');
      t.integer('approval_status').notNullable().defaultTo(1)
        .comment('审批状态（沿用各学段原码：★审批四纪律 · 映射必须双向显式）');
      t.string('remark', 500).nullable().comment('备注');
    });
  }

  // 索引（MariaDB 无 CREATE INDEX IF NOT EXISTS → 先查 information_schema 再建）
  const want = [
    ['idx_dc_student', ['student_id']],
    ['idx_dc_class', ['class_id']],
    ['idx_dc_head_teacher', ['head_teacher_id']],
    ['idx_dc_date', ['change_date']],
    ['idx_dc_biz_type', ['biz_type']],
    ['idx_dc_approval', ['approval_id']],
    ['idx_dc_approval_status', ['approval_status']],
  ];
  // ★ knex.raw(SELECT) 在 MariaDB 驱动下返回「协议字段数组」而非行对象，
  //   所以这里用 knex.select().from(information_schema) 而不是 knex.raw。
  const existing = await knex
    .select('INDEX_NAME')
    .from('information_schema.STATISTICS')
    .where({ TABLE_SCHEMA: 'sms_common', TABLE_NAME: T })
    .distinct();
  const have = new Set(existing.map((r) => r.INDEX_NAME));
  for (const [name, cols] of want) {
    if (have.has(name)) continue;
    await knex.raw('ALTER TABLE ?? ADD INDEX ?? (??)', [T, name, cols]);
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists(T);
};
