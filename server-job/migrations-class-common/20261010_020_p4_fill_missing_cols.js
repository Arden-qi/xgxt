/**
 * 第 4 期 · 步骤 0：全量补齐 8 张统一表的缺列
 * ============================================================
 *
 * 【★ 为什么必须有这一步 —— 推翻第 4 期方案的一个核心假设】
 *   第 4 期方案原文写「11 张已归一，**切读就行、只改表名 + 加 where stage**」。
 *   写方案时我只对比了「哪些老表映射到哪张统一表」，**没对比列**。
 *
 *   实测（`scripts/_p4-missing-cols.cjs`）结论：**统一表不是老表的列超集**。
 *   8 张统一表共缺 **54 列**，其中一部分是**仓储代码每天都在读写的**：
 *
 *     · `id_card_no`  初高学生列表页的身份证（统一表只有 `id_card`）
 *       → ★ 这是**列名冲突**，不是漏建：初高叫 id_card_no、大学/实训叫 id_card
 *     · `origin`      大学学生列表页的籍贯（统一表只有 `native_place`）
 *       → ★ 同上：命名冲突
 *     · `class_ids` / `class_names` / `exam_time` / `content_types`
 *       → 实训考试**支持多班**，`FIND_IN_SET(?, class_ids)` 靠它
 *     · `apply_status` / `apply_category` / `from_dorm_id` / `to_dorm_id`
 *       → 大学宿舍调宿/退宿审批的读路径
 *     · `status` / `class_name` / `remark`  → 实训花名册列表
 *
 *   如果不补就切读，现象是「接口 200 但列表少一半字段」——
 *   列不存在时 knex 不会报错，只会返回 undefined。**极难排查**。
 *
 * 【★ 这次为什么选「全量补齐」而不是「只补用到的」】
 *   斌哥拍板全量补齐。理由站得住：
 *   表里只有 12 行自检数据，加列零成本；
 *   而「只补用到的」会在下一个域用到未归一的列时，再开一轮补列 —— 那时
 *   真实业务数据已经灌进来，就得重写迁移 + 处理存量，代价高一个数量级。
 *
 * 【★ 命名冲突怎么处理 —— 两列并存，不做合并】
 *   `id_card` 与 `id_card_no`、`native_place` 与 `origin` 语义完全相同。
 *   这里**两列都建**、不合并，因为：
 *     ① 合并要改仓储（每个域 3 个 repo 文件），属于步骤 2 的活
 *     ② 两列并存时，迁移脚本可以「老表叫什么就写什么」，
 *        切读时再由仓储层显式指定读哪一列 —— **反正是显式的，不会读错**
 *   ⚠️ 但这违反了「消灭重复」的原则。归一后的收口动作放在步骤 2：
 *      仓储确认切读稳定后，再写一个迁移把老列的数据搬到新列、
 *      把老列标记废弃。**不要在切读前删老列**（切读还没验证，删了无法回退）。
 *
 * 【铁律遵守】① 带 stage 的表唯一索引按 stage 组合（本次只加列，不动索引）
 *            ③ NOT NULL 一律给默认值（下面 5 个原本 NOT NULL 无默认的，
 *               若照抄会在插入时报 ER_BAD_NULL_ERROR）
 *            ⑤ src_db/src_table/src_id 已在前一个迁移补齐
 *
 * 【幂等】每个列都先 hasColumn 检查，已存在就跳过。
 * 【代价】表里 0~12 行自检数据，加列不搬数据、不回填。
 */

const up = async function (knex) {
  /**
   * 缺列清单（全量）
   * 字段：[列名, 列定义回调]
   * ⚠️ 类型对齐源表；NOT NULL 的都给默认值。
   */
  const PATCH = {
    /* ---------------------------------------------------------
     * t_uni_class（缺 2 列）
     * · student_count：三个学段都有（冗余人数列）。
     *   ⚠️ 仓储已改成「人数实时统计」，不信这个冗余列；
     *     保留只为迁移时不丢原值。
     * · room：★ 大学教室列名是 `room`，初高/实训是 `classroom`。
     *   语义相同、列名冲突，并存。
     * --------------------------------------------------------- */
    t_uni_class: [
      ['student_count', (t) => t.integer('student_count').defaultTo(0).comment('冗余人数（三学段老表列）。⚠️仓储不信任此列，人数实时统计')],
      ['room', (t) => t.string('room', 64).comment('★大学教室列名（老表叫 room）；初高/实训叫 classroom。两列并存')],
    ],

    /* ---------------------------------------------------------
     * t_uni_student（缺 30 列 —— 本次最大的一块）
     *
     * ★ 三组命名冲突（并存，不合并）：
     *   id_card_no(初高)   ↔ id_card(大学/实训)
     *   origin(大学)       ↔ native_place(初高/实训)
     *   bed_no             ↔ dorm_no + dorm_id（是「床」不是「房间」）
     * ★ 一组同义不同名：recruit_phone(大学) ↔ recruit_teacher_phone(初高/大学)
     * ★ 大学独有的「同步标记 + 质量评估」8 列
     * ★ 初高独有的「进行中流程 + 协议 + 网络账号 + 识字情况」
     * --------------------------------------------------------- */
    t_uni_student: [
      // —— 初高独有 ——
      ['pending_flow_type', (t) => t.integer('pending_flow_type').comment('★初高：进行中的异动流程类型（0无）')],
      ['agreement_status', (t) => t.integer('agreement_status').defaultTo(1).comment('★初高：协议状态（1已签）')],
      ['net_account', (t) => t.string('net_account', 64).comment('★初高：网络账号')],
      ['net_init_password', (t) => t.string('net_init_password', 64).comment('★初高：网络初始密码')],
      ['literacy_desc', (t) => t.string('literacy_desc', 2000).comment('★初高：识字情况说明')],
      // —— 命名冲突：身份证 ——
      ['id_card_no', (t) => t.string('id_card_no', 32).comment('★初高身份证列名；统一表另有 id_card（大学/实训口径）。两列并存')],
      // —— 命名冲突：籍贯 ——
      ['origin', (t) => t.string('origin', 100).comment('★大学籍贯列名；统一表另有 native_place（初高/实训口径）。两列并存')],
      // —— 照片（两学段都有）——
      ['id_photo_url', (t) => t.string('id_photo_url', 255).comment('身份证照片 URL')],
      ['household_photo_url', (t) => t.string('household_photo_url', 255).comment('户口本照片 URL')],
      // —— 招生老师：名字列（两学段都有，但统一表只有 consult_teacher）——
      ['recruit_teacher_name', (t) => t.string('recruit_teacher_name', 50).comment('招生老师姓名')],
      ['recruit_teacher_phone', (t) => t.string('recruit_teacher_phone', 20).comment('★初高口径招生老师电话；大学叫 recruit_phone')],
      ['recruit_teacher_id', (t) => t.string('recruit_teacher_id', 36).comment('★大学：招生老师ID')],
      ['recruit_phone', (t) => t.string('recruit_phone', 32).comment('★大学口径招生老师电话；初高叫 recruit_teacher_phone')],
      ['consult_teacher_name', (t) => t.string('consult_teacher_name', 50).comment('咨询老师姓名（统一表另有 consult_teacher）')],
      ['consult_teacher_id', (t) => t.string('consult_teacher_id', 36).comment('★大学：咨询老师ID')],
      ['consult_phone', (t) => t.string('consult_phone', 32).comment('★大学口径咨询老师电话')],
      // —— 床位（★ 是「床号」，与 dorm_no「房间号」不是一回事）——
      ['bed_no', (t) => t.string('bed_no', 20).comment('★床号（初高/大学在学生表直接存；与 dorm_no 房间号不同')],
      ['dorm_building', (t) => t.string('dorm_building', 64).comment('★楼栋（大学从房间号里拆出来的独立列）')],
      // —— 大学独有：外部同步标记 ——
      ['source_system', (t) => t.string('source_system', 32).defaultTo('manual').comment('来源系统（manual手工 / 教务同步）')],
      ['source_id', (t) => t.string('source_id', 64).comment('来源系统的主键（回查用）')],
      ['source_update_time', (t) => t.dateTime('source_update_time').comment('来源系统最后更新时间')],
      ['sync_status', (t) => t.integer('sync_status').defaultTo(2).notNullable().comment('同步状态（0待同步 1成功 2未同步）')],
      ['source_batch_no', (t) => t.string('source_batch_no', 40).comment('同步批次号')],
      // —— 大学独有：质量评估 7 列 ——
      ['quality_study', (t) => t.string('quality_study', 32).comment('质量评估-学习')],
      ['quality_discipline', (t) => t.string('quality_discipline', 32).comment('质量评估-纪律')],
      ['quality_ability', (t) => t.string('quality_ability', 32).comment('质量评估-能力')],
      ['quality_comprehension', (t) => t.string('quality_comprehension', 32).comment('质量评估-理解')],
      ['quality_expression', (t) => t.string('quality_expression', 32).comment('质量评估-表达')],
      ['quality_social', (t) => t.string('quality_social', 32).comment('质量评估-社会适应')],
      ['quality_note', (t) => t.string('quality_note', 500).comment('质量评估备注')],
    ],

    /* ---------------------------------------------------------
     * t_uni_class_student（缺 5 列）
     * 实训有独立花名册表，比另两学段多这些字段。
     * ⚠️ `status` NOT NULL → 必须给默认，否则插入报错。
     * --------------------------------------------------------- */
    t_uni_class_student: [
      ['class_name', (t) => t.string('class_name', 50).comment('班级名称（实训花名册冗余存一份；初高/大学在学生表存）')],
      ['leave_type', (t) => t.integer('leave_type').comment('离班类型（1休学 2退学 3复学…）')],
      ['leave_reason', (t) => t.string('leave_reason', 200).comment('离班原因')],
      ['status', (t) => t.integer('status').defaultTo(1).notNullable().comment('花名册状态（1在班 0已离班）')],
      ['remark', (t) => t.string('remark', 200).comment('备注')],
    ],

    /* ---------------------------------------------------------
     * t_uni_attendance（缺 1 列）
     * --------------------------------------------------------- */
    t_uni_attendance: [
      ['actual_count', (t) => t.integer('actual_count').defaultTo(0).comment('★初高：实到人数（统一表另有 present_count）')],
    ],

    /* ---------------------------------------------------------
     * t_uni_exam（缺 5 列）★★ 本次最关键的一块
     *
     * ★★ 实训考试**支持多班**，另外两学段是单班：
     *    `class_ids`  = 逗号分隔的班级ID（查询靠 `FIND_IN_SET(?, class_ids)`）
     *    `class_names`= 逗号分隔的班级名
     *   统一表原来只有单班的 `class_id` / `class_name`，
     *   → 切读后实训的**多班考试会全部查不出来**（FIND_IN_SET 找不到 = 静默漏数据）。
     *
     * ★ `exam_time` datetime NOT NULL：初高/大学只有 `exam_date`（日期），
     *   实训精确到 datetime。两者并存，切读时按学段选列。
     * ⚠️ 这 4 个原本 NOT NULL 无默认 → 照抄会插入报错，统一给默认。
     * --------------------------------------------------------- */
    t_uni_exam: [
      ['exam_time', (t) => t.dateTime('exam_time').defaultTo(null).notNullable().comment('★实训：考试精确时间；初高/大学只有 exam_date 日期。两者并存')],
      ['class_ids', (t) => t.string('class_ids', 500).defaultTo('').notNullable().comment('★★实训：逗号分隔的多班ID，查询用 FIND_IN_SET；单班学段用 class_id')],
      ['class_names', (t) => t.string('class_names', 500).defaultTo('').notNullable().comment('★实训：逗号分隔的多班名；单班学段用 class_name')],
      ['content_types', (t) => t.string('content_types', 100).defaultTo('').notNullable().comment('★实训：逗号分隔的内容项类型码；初高用 exam_content_types JSON')],
      ['create_by_name', (t) => t.string('create_by_name', 50).comment('创建人姓名（初高口径；统一表另有 creator_name）')],
    ],

    /* t_uni_exam_field / t_uni_repeat：实测无缺列（脚本确认 0 列）*/

    /* ---------------------------------------------------------
     * t_uni_dorm_apply（缺 11 列）
     *
     * ★★ 命名冲突 + 语义差异同时存在：
     *    统一表原来只有 `approval_status`（审批状态，**审批引擎**那套）
     *    大学/初高的申请单用的是 `apply_status`（**单据自身**状态）
     *    → 这两个不是一回事！第 2 期审批链统一后申请单状态由审批引擎回写，
     *      所以两者都要留。切读时仓储显式指明读哪一列。
     *
     * ★ `apply_category` NOT NULL 无默认 → 给默认 1（调宿）
     * ★ `from_dorm_*` / `to_dorm_*`：大学的宿舍叫 dorm、初高叫 room，
     *    统一表已有 from_room_no / to_room_no 等另一套命名，这里并存。
     * --------------------------------------------------------- */
    t_uni_dorm_apply: [
      ['apply_status', (t) => t.integer('apply_status').defaultTo(1).notNullable().comment('★单据自身状态（1待审 2通过 3驳回）。与 approval_status 审批引擎状态并存')],
      ['apply_category', (t) => t.integer('apply_category').defaultTo(1).notNullable().comment('申请类别（1调宿 2退宿）')],
      ['has_goods_checked', (t) => t.boolean('has_goods_checked').defaultTo(false).notNullable().comment('★退宿是否已查清行李物品')],
      ['from_dorm_id', (t) => t.string('from_dorm_id', 36).comment('★原宿舍ID（大学 dorm 口径；统一表另有 from_room_id）')],
      ['from_dorm_no', (t) => t.string('from_dorm_no', 64).comment('★原宿舍号（大学 dorm 口径）')],
      ['to_dorm_id', (t) => t.string('to_dorm_id', 36).comment('★目标宿舍ID（退宿时为空）')],
      ['to_dorm_no', (t) => t.string('to_dorm_no', 64).comment('★目标宿舍号（退宿时为空）')],
      ['applicant_id', (t) => t.string('applicant_id', 36).comment('申请人ID')],
      ['applicant_name', (t) => t.string('applicant_name', 50).comment('申请人姓名')],
      ['approver_id', (t) => t.string('approver_id', 36).comment('审批人ID')],
      ['approver_name', (t) => t.string('approver_name', 50).comment('审批人姓名')],
    ],
  };

  /* ---- 幂等执行：逐表逐列 hasColumn 检查 ---- */
  for (const [table, cols] of Object.entries(PATCH)) {
    for (const [col, def] of cols) {
      const exists = await knex.schema.hasColumn(table, col);
      if (exists) continue;
      await knex.schema.alterTable(table, (t) => def(t));
    }
  }
};

const down = async function (knex) {
  const PATCH = {
    t_uni_class: ['student_count', 'room'],
    t_uni_student: [
      'pending_flow_type', 'agreement_status', 'net_account', 'net_init_password',
      'literacy_desc', 'id_card_no', 'origin', 'id_photo_url', 'household_photo_url',
      'recruit_teacher_name', 'recruit_teacher_phone', 'recruit_teacher_id',
      'recruit_phone', 'consult_teacher_name', 'consult_teacher_id', 'consult_phone',
      'bed_no', 'dorm_building', 'source_system', 'source_id', 'source_update_time',
      'sync_status', 'source_batch_no', 'quality_study', 'quality_discipline',
      'quality_ability', 'quality_comprehension', 'quality_expression',
      'quality_social', 'quality_note',
    ],
    t_uni_class_student: ['class_name', 'leave_type', 'leave_reason', 'status', 'remark'],
    t_uni_attendance: ['actual_count'],
    t_uni_exam: ['exam_time', 'class_ids', 'class_names', 'content_types', 'create_by_name'],
    t_uni_dorm_apply: [
      'apply_status', 'apply_category', 'has_goods_checked', 'from_dorm_id', 'from_dorm_no',
      'to_dorm_id', 'to_dorm_no', 'applicant_id', 'applicant_name', 'approver_id', 'approver_name',
    ],
  };

  for (const [table, cols] of Object.entries(PATCH)) {
    for (const col of cols) {
      const exists = await knex.schema.hasColumn(table, col);
      if (!exists) continue;
      await knex.schema.alterTable(table, (t) => t.dropColumn(col));
    }
  }
};

module.exports = { up, down };