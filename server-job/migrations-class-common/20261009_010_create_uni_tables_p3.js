/**
 * 第 3 期 · 阶段 B：建 8 张统一主表（t_uni_*）
 * ============================================================
 *
 * 【目标】
 *   把散在 2~3 个库的重复表合并成「一张权威表 + stage 列区分学段」。
 *   合并前 8 张表加起来只有 8 行数据，所以**这一步纯建表，不搬数据**
 *   （搬数据是阶段 C）。
 *
 * 【放哪个库】
 *   `sms_common` —— 公共/中立位置，跨库读它不用跨库连接。
 *   （本项目已有先例：t_class_dorm_room_sync 等同步表就在这）
 *
 * 【★★★ 七条建表铁律（每条都对应调研发现的一个真实坑）】
 *
 * ① **必须带 `stage` 列**
 *    「初高 G104」和「大学 G104」是**两个不同的班**，
 *    没有 stage 就无法区分 —— 这是整个归一的必要条件。
 *
 * ② **唯一索引按 stage 组合，不能单列**
 *    合并前 `t_class_info` 的 `uk_class_name` **只在初高有**（大学不唯一）。
 *    归一后如果还用单列唯一索引 → 「初高 G104」和「大学 G104」只能存一个，
 *    **直接丢数据**。所以统一用 `uk(name, stage)`。
 *
 * ③ **NOT NULL 列一律给默认值或改可空**
 *    各学段同一列的可空性不一致（调研脚本标的 `⚠️ 类型/可空不一致` 共 17 处）。
 *    比如 `should_count`：大学 NOT NULL、初高可空 —— 硬搬到统一表会让初高数据插不进去。
 *    → **新表里所有业务列都给默认值 0 / ''**，不设 NOT NULL。
 *
 * ④ **★ 语义冲突的列必须分开保留，不能合并**
 *    最典型的两对：
 *      · `today_attendance_rate`（初高「今日」出勤率）
 *        vs `attendance_rate`（大学/实训「累计」出勤率）
 *      → **这是两个不同指标**，合并成一列会导致数据失真。**必须两列都留。**
 *      · `present_count`（大学实到）vs `actual_count`（初高已到）
 *      → 同义不同名，归一后统一叫 `present_count`（迁移时翻译）。
 *
 * ⑤ **保留 `src_db` + `src_id` 做溯源**
 *    迁移后要能回答「这条记录原来在哪个库哪张表」，否则出问题无法回查。
 *
 * ⑥ **不建物理外键**
 *    本项目全部表都是逻辑关联 + 应用层保证，且 MariaDB/MySQL 混用时外键行为不一致。
 *
 * ⑦ **软删 + 唯一索引的坑：唯一索引要把 is_deleted 算进去吗？**
 *    本项目其它表的做法是**软删行仍占唯一索引**（所以「删了再也建不回来」）。
 *    这里**故意保持一致**（唯一索引不带 is_deleted），
 *    理由：① 与其它 75 张表行为一致，避免"这张表能删了再建、别的表不行"的困惑；
 *    ② 阶段 D 切换后仓储会做友好提示（见 repo 的唯一性检查写法）。
 */

const up = async function (knex) {
  // ============================================================
  // 1) t_uni_student —— 学生主档（合并 t_student_base × 3 库 + t_class_student × 2 库）
  // ============================================================
  await knex.schema.createTable('t_uni_student', (t) => {
    t.string('id', 36).primary().comment('主键UUID（沿用原记录 id，迁移时保持一致）');
    t.string('stage', 16).notNullable().defaultTo('jh').comment('★学段 jh初高/class大学/job实训/edu教务');

    // —— 学号与身份（归一后各学段都是这几个字段） ——
    t.string('student_no', 32).notNullable().defaultTo('').comment('学号');
    t.string('student_name', 50).notNullable().defaultTo('').comment('姓名');
    t.integer('gender').notNullable().defaultTo(0).comment('性别 1男 2女（0未知）');
    t.integer('age').comment('年龄');
    t.string('student_status', 16).notNullable().defaultTo('1').comment('统一学生状态 1待咨询2咨询中3试学中4预在读5正式在读6休学7退学8实训中9待就业10已就业11流失');
    t.integer('dept_code').notNullable().defaultTo(1).comment('部门 1初高部 2大学部');
    t.integer('stage_code').comment('学习阶段码（各学段编码体系不同，见阶段码映射表）');

    // —— 班级归属 ——
    t.string('class_id', 36).comment('当前班级ID');
    t.string('class_name', 50).comment('当前班级名称');

    // —— 岗位人员（升实训交棒模型） ——
    t.string('head_teacher_id', 36).comment('班主任ID');
    t.string('head_teacher_name', 50).comment('班主任姓名');
    t.string('teacher_id', 36).comment('教员ID');
    t.string('teacher_name', 50).comment('教员姓名');
    t.string('assistant_id', 36).comment('助教ID');
    t.string('assistant_name', 50).comment('助教姓名');
    t.string('project_manager_id', 64).comment('项目经理ID（★只有大学/实训有交棒岗位）');
    t.string('project_manager_name', 64).comment('项目经理姓名');
    t.string('employment_teacher_id', 64).comment('就业老师ID');
    t.string('employment_teacher_name', 64).comment('就业老师姓名');

    // —— 住宿 ——
    t.string('dorm_id', 36).comment('宿舍/房间ID');
    t.string('dorm_no', 20).comment('宿舍号');

    // —— 联系方式与档案 ——
    t.string('phone', 32).comment('学生手机号');
    t.string('parent_phone', 32).comment('家长手机号');
    t.string('education', 50).comment('学历');
    t.date('enroll_date').comment('入学时间');
    t.string('id_card', 32).comment('身份证号');
    t.date('birth_date').comment('出生日期');
    t.string('native_place', 64).comment('籍贯（★源字段名在部分库是 origin，归一为 native_place）');
    t.string('graduate_school', 128).comment('毕业院校');
    t.string('home_address', 255).comment('家庭住址');

    // —— 咨询/招生（★只有实训那套有） ——
    t.string('admission_teacher', 64).comment('招生老师姓名');
    t.string('admission_teacher_phone', 32).comment('招生老师电话');
    t.string('consult_teacher', 64).comment('咨询老师姓名');
    t.string('consult_teacher_phone', 32).comment('咨询老师电话');

    // —— 简历（★只有实训有，base64 体积大故用 text） ——
    t.string('resume_name', 200).comment('简历文件名');
    t.text('resume_data').comment('简历内容');

    // —— 统计与末班 ——
    t.decimal('attendance_rate', 5, 2).comment('★累计出勤率（与 today_attendance_rate 不同指标，别混）');
    t.integer('repeat_count').defaultTo(0).comment('末班次数');
    t.string('quality', 500).comment('综合素养（★只有教务那套有）');

    t.string('remark', 500).comment('备注');

    // —— 溯源 ——
    t.string('src_db', 32).comment('★来源库 sms_job/sms_class/sms_class_jh/sms_edu');
    t.string('src_table', 64).comment('★来源表名');
    t.string('src_id', 36).comment('★来源记录 id');

    t.timestamp('create_time').notNullable().defaultTo(knex.fn.now()).comment('创建时间');
    t.string('create_by', 36).comment('创建人ID');
    t.timestamp('update_time').comment('修改时间');
    t.string('update_by', 36).comment('修改人ID');
    t.integer('is_deleted').notNullable().defaultTo(0).comment('逻辑删除');

    // ★ 铁律②：唯一索引按 stage 组合 —— 否则跨学段同名会互相挤掉
    t.unique(['student_no', 'stage'], { indexName: 'uk_uni_student_no_stage' });
    t.index(['stage', 'class_id'], 'idx_uni_student_stage_class');
    t.index(['stage', 'student_status'], 'idx_uni_student_stage_status');
    t.index(['src_db', 'src_id'], 'idx_uni_student_src');
  });

  // ============================================================
  // 2) t_uni_class —— 班级（合并 t_class_info × 2 库）
  // ============================================================
  await knex.schema.createTable('t_uni_class', (t) => {
    t.string('id', 36).primary().comment('主键UUID');
    t.string('stage', 16).notNullable().defaultTo('jh').comment('★学段');
    t.string('class_name', 50).notNullable().defaultTo('').comment('班级名称');
    t.string('class_code', 32).comment('班级编号（★只有实训有）');
    t.integer('dept_code').notNullable().defaultTo(1).comment('部门 1初高部 2大学部');
    t.integer('stage_code').notNullable().defaultTo(101).comment('学习阶段码');
    t.integer('class_status').notNullable().defaultTo(1).comment('统一班级状态 1开放 2封班 3待结业 4已结业');
    t.date('open_date').comment('开班日期');
    t.date('close_date').comment('结业日期（★只有实训有）');

    // —— 岗位人员 ——
    t.string('head_teacher_id', 36).comment('班主任ID（★初高 NOT NULL，其余可空 → 统一可空）');
    t.string('head_teacher_name', 50).comment('班主任姓名');
    t.string('teacher_id', 36).comment('教员ID');
    t.string('teacher_name', 50).comment('教员姓名');
    t.string('assistant_id', 36).comment('助教ID');
    t.string('assistant_name', 50).comment('助教姓名');
    t.string('project_manager_id', 64).comment('项目经理ID');
    t.string('project_manager_name', 64).comment('项目经理姓名');
    t.string('employment_teacher_id', 64).comment('就业老师ID');
    t.string('employment_teacher_name', 64).comment('就业老师姓名');
    t.string('university_no', 64).comment('大学学号（★只有大学有）');

    // —— ★ 铁律④：出勤率两个口径必须分列 ——
    t.decimal('attendance_rate', 5, 2).comment('★累计出勤率（大学/实训口径）');
    t.decimal('today_attendance_rate', 5, 2).comment('★今日出勤率（初高口径）—— 与上一列是**不同指标**');

    // —— 教室（★两段列名不同：大学 room / 初高 classroom → 归一为 classroom） ——
    t.string('classroom', 100).comment('教室（源列名 room 或 classroom）');
    t.string('university_classroom', 100).comment('★大学专用教室（保留源 room 值，防与初高口径混淆）');

    t.string('owner_name', 50).comment('负责人/宿舍长');
    t.string('remark', 500).comment('备注（★只有初高/实训有，大学没有）');
    t.integer('student_count_cached').notNullable().defaultTo(0).comment('冗余人数（★仅作缓存展示，真实人数一律实时统计）');

    t.string('src_db', 32).comment('★来源库');
    t.string('src_table', 64).comment('★来源表名');
    t.string('src_id', 36).comment('★来源记录 id');

    t.timestamp('create_time').notNullable().defaultTo(knex.fn.now()).comment('创建时间');
    t.string('create_by', 36).comment('创建人ID');
    t.timestamp('update_time').comment('修改时间');
    t.string('update_by', 36).comment('修改人ID');
    t.integer('is_deleted').notNullable().defaultTo(0).comment('逻辑删除');

    // ★ 铁律②：合并前只有初高有 uk_class_name（大学不唯一）→ 必须按 stage 组合
    t.unique(['class_name', 'stage'], { indexName: 'uk_uni_class_name_stage' });
    t.index(['stage', 'class_status'], 'idx_uni_class_stage_status');
    t.index(['stage', 'class_code'], 'idx_uni_class_stage_code');
    t.index(['stage', 'head_teacher_id'], 'idx_uni_class_stage_ht');
  });

  // ============================================================
  // 3) t_uni_class_student —— 班级花名册（合并 t_class_student 的班级关联语义）
  // ============================================================
  await knex.schema.createTable('t_uni_class_student', (t) => {
    t.string('id', 36).primary().comment('主键UUID');
    t.string('stage', 16).notNullable().defaultTo('jh').comment('★学段');
    t.string('class_id', 36).notNullable().defaultTo('').comment('班级ID');
    t.string('student_id', 36).notNullable().defaultTo('').comment('学生ID（→ t_uni_student.id）');
    t.string('student_no', 32).notNullable().defaultTo('').comment('学号（快照）');
    t.string('student_name', 50).notNullable().defaultTo('').comment('姓名（快照）');
    t.integer('join_date').comment('入班日期（★改用 date）');
    t.string('join_type', 16).comment('入班方式（★只有实训花名册有）');
    t.integer('in_class_status').comment('在班状态 1在班 2已离班（★只有实训有）');
    t.date('leave_date').comment('离班日期');

    t.string('src_db', 32).comment('★来源库');
    t.string('src_id', 36).comment('★来源记录 id');

    t.timestamp('create_time').notNullable().defaultTo(knex.fn.now()).comment('创建时间');
    t.string('create_by', 36).comment('创建人ID');
    t.timestamp('update_time').comment('修改时间');
    t.string('update_by', 36).comment('修改人ID');
    t.integer('is_deleted').notNullable().defaultTo(0).comment('逻辑删除');

    t.unique(['class_id', 'student_id'], { indexName: 'uk_uni_cs_class_student' });
    t.index(['stage', 'class_id'], 'idx_uni_cs_stage_class');
    t.index(['student_id'], 'idx_uni_cs_student');
  });

  // ============================================================
  // 4) t_uni_attendance —— 出勤（合并 t_class_attendance × 2 库）
  // ============================================================
  await knex.schema.createTable('t_uni_attendance', (t) => {
    t.string('id', 36).primary().comment('主键UUID');
    t.string('stage', 16).notNullable().defaultTo('jh').comment('★学段');
    t.string('class_id', 36).notNullable().defaultTo('').comment('班级ID');
    t.string('class_name', 50).notNullable().defaultTo('').comment('班级名称（快照）');
    // ⚠️ 铁律③：原来写成 notNullable 无默认 → 源表若有 date 为 null 的历史行会插不进来。
    //   统一表一律给默认 '1970-01-01'，宁可值是空的也别插失败。
    t.date('attendance_date').notNullable().defaultTo('1970-01-01').comment('考勤日期（★铁律③：给默认值，防历史空值插不进）');
    t.integer('should_count').notNullable().defaultTo(0).comment('应到人数（★铁律③：原两段可空性不一致，这里给默认 0）');
    t.integer('present_count').notNullable().defaultTo(0).comment('★实到人数（源列名：大学 present_count / 初高 actual_count）');
    t.integer('absent_count').notNullable().defaultTo(0).comment('缺勤人数（★只有大学有）');
    t.integer('month_unqualified_count').comment('当月未达标数（★只有初高有）');
    t.decimal('attendance_rate', 5, 2).notNullable().defaultTo(0).comment('出勤率（百分比）');
    t.string('teacher_id', 36).comment('教员ID（★只有初高有）');
    t.string('teacher_name', 50).comment('教员姓名');
    t.string('head_teacher_id', 36).comment('班主任ID（★只有初高有）');
    t.string('head_teacher_name', 50).comment('班主任姓名');
    t.string('file_url', 255).comment('出勤表文件地址（★只有初高有）');
    t.string('remark', 500).comment('备注（★只有初高有）');

    t.string('src_db', 32).comment('★来源库');
    t.string('src_id', 36).comment('★来源记录 id');

    t.timestamp('create_time').notNullable().defaultTo(knex.fn.now()).comment('创建时间');
    t.string('create_by', 36).comment('创建人ID');
    t.timestamp('update_time').comment('修改时间');
    t.string('update_by', 36).comment('修改人ID');
    t.integer('is_deleted').notNullable().defaultTo(0).comment('逻辑删除');

    // 合并前两库都是 uk(class_id, attendance_date) → 归一后加上 stage
    t.unique(['class_id', 'attendance_date', 'stage'], { indexName: 'uk_uni_att_class_date_stage' });
    t.index(['stage', 'attendance_date'], 'idx_uni_att_stage_date');
  });

  // ============================================================
  // 5) t_uni_exam —— 考试（合并 t_class_exam × 2 库）
  // ============================================================
  await knex.schema.createTable('t_uni_exam', (t) => {
    t.string('id', 36).primary().comment('主键UUID');
    t.string('stage', 16).notNullable().defaultTo('jh').comment('★学段');
    t.string('exam_name', 100).notNullable().defaultTo('').comment('考试名称');
    t.integer('exam_type').notNullable().defaultTo(1).comment('考试类型 1月考2质素考核3阶段考核4结业考试5其他');
    t.date('exam_date').notNullable().defaultTo('1970-01-01').comment('考试时间（★铁律③：给默认值，防历史空值插不进）');
    t.string('class_id', 36).comment('班级ID（★铁律③：原两段可空性不一致）');
    t.string('class_name', 50).comment('班级名称');
    t.integer('attendee_count').notNullable().defaultTo(0).comment('参考人数（★只有大学有）');
    t.integer('exam_status').notNullable().defaultTo(1).comment('考试状态 1草稿 2已提交（★只有初高有）');
    t.text('exam_content_types').comment('内容项数组 [1,2,3,4]（★只有初高有）');
    t.text('content_full_score').comment('各内容项默认满分（★只有初高有）');
    t.text('score_teacher_ids').comment('评分老师（★只有初高有）');
    t.text('judge_ids').comment('评委（★只有初高有）');
    t.string('creator_id', 36).comment('创建人ID');
    t.string('creator_name', 50).comment('创建人姓名（★源列名两段不同：大学 creator_name / 初高 create_by_name）');
    t.string('remark', 500).comment('备注（★只有初高有）');

    t.string('src_db', 32).comment('★来源库');
    t.string('src_id', 36).comment('★来源记录 id');

    t.timestamp('create_time').notNullable().defaultTo(knex.fn.now()).comment('创建时间');
    t.string('create_by', 36).comment('创建人ID');
    t.timestamp('update_time').comment('修改时间');
    t.string('update_by', 36).comment('修改人ID');
    t.integer('is_deleted').notNullable().defaultTo(0).comment('逻辑删除');

    t.index(['stage', 'exam_date'], 'idx_uni_exam_stage_date');
    t.index(['stage', 'class_id'], 'idx_uni_exam_stage_class');
  });

  // ============================================================
  // 6) t_uni_exam_field —— 考试字段（★ 本域语义冲突最严重，见下方注释）
  // ============================================================
  await knex.schema.createTable('t_uni_exam_field', (t) => {
    t.string('id', 36).primary().comment('主键UUID');
    t.string('stage', 16).notNullable().defaultTo('jh').comment('★学段');

    // ★★ 语义冲突：大学的「字段名」叫 field_key，初高叫 field_name
    //    → 归一后**都写进 field_name**，field_key 保留为源值便于回查
    t.string('exam_id', 36).notNullable().defaultTo('').comment('★考试ID（★只有初高有；大学没有「字段属于哪场考试」这层关系）');
    t.string('field_name', 100).notNullable().defaultTo('').comment('★字段名（源列名：大学 field_key / 初高 field_name）');
    t.string('field_key', 100).comment('源字段名（保留源值，回查用）');
    t.string('field_type', 20).notNullable().defaultTo('数值').comment('字段类型 数值/文本（★两段可空性不一致 → 给默认）');
    t.string('default_value', 255).comment('默认值（★只有大学有）');
    t.string('source', 50).notNullable().defaultTo('系统内置').comment('来源 系统内置/自定义（★只有大学有 NOT NULL → 归一给默认）');
    t.integer('sort_no').notNullable().defaultTo(0).comment('排序（★只有初高有）');

    t.string('src_db', 32).comment('★来源库');
    t.string('src_id', 36).comment('★来源记录 id');

    t.timestamp('create_time').notNullable().defaultTo(knex.fn.now()).comment('创建时间');
    t.string('create_by', 36).comment('创建人ID');
    t.timestamp('update_time').comment('修改时间');
    t.string('update_by', 36).comment('修改人ID');
    t.integer('is_deleted').notNullable().defaultTo(0).comment('逻辑删除');

    // ★ 合并前只有大学有 uk_field_key（全局唯一，不分考试）→ 归一后必须加 exam_id + stage，
    //   否则「同一字段名在两场考试里都出现」会冲突；而初高恰恰是按考试分的。
    t.unique(['field_name', 'exam_id', 'stage'], { indexName: 'uk_uni_examfield_name_exam_stage' });
    t.index(['stage', 'exam_id'], 'idx_uni_examfield_stage_exam');
  });

  // ============================================================
  // 7) t_uni_repeat —— 末班（合并 t_class_repeat × 2 库）
  // ============================================================
  await knex.schema.createTable('t_uni_repeat', (t) => {
    t.string('id', 36).primary().comment('主键UUID');
    t.string('stage', 16).notNullable().defaultTo('jh').comment('★学段');
    t.string('student_id', 36).notNullable().defaultTo('').comment('学生ID');
    t.string('student_no', 32).notNullable().defaultTo('').comment('学号（快照）');
    t.string('student_name', 50).notNullable().defaultTo('').comment('姓名（快照）');
    t.timestamp('repeat_time').notNullable().comment('末班时间');
    t.string('repeat_reason', 500).notNullable().defaultTo('').comment('末班原因');
    t.string('from_class_id', 36).comment('原班级ID');
    t.string('from_class_name', 50).comment('原班级名称');
    t.string('to_class_id', 36).comment('末班转入班级ID');
    t.string('to_class_name', 50).comment('末班转入班级名称');
    t.integer('repeat_count').notNullable().defaultTo(0).comment('累计末班次数');
    t.integer('from_stage').comment('原学习阶段（★只有初高有）');
    t.integer('to_stage').comment('转入学习阶段（★只有初高有）');
    t.string('exam_name', 100).comment('触发末班的那次考试名称（★只有大学有）');
    t.decimal('written_score', 6, 2).comment('末班时笔试成绩（★只有大学有）');
    t.decimal('interview_score', 6, 2).comment('末班时面试成绩（★只有大学有）');
    t.decimal('comp_score', 6, 2).comment('末班时综合成绩（★只有大学有）');
    t.string('notify_user_id', 36).comment('被通知班主任ID（★只有初高有）');
    t.integer('is_notified').comment('是否已通知（★只有初高有）');

    t.string('src_db', 32).comment('★来源库');
    t.string('src_id', 36).comment('★来源记录 id');

    t.timestamp('create_time').notNullable().defaultTo(knex.fn.now()).comment('创建时间');
    t.string('create_by', 36).comment('创建人ID');
    t.timestamp('update_time').comment('修改时间');
    t.string('update_by', 36).comment('修改人ID');
    t.integer('is_deleted').notNullable().defaultTo(0).comment('逻辑删除');

    t.index(['stage', 'student_id'], 'idx_uni_repeat_stage_student');
  });

  // ============================================================
  // 8) t_uni_dorm_apply —— 宿舍调宿/退宿申请（★ 本域列差异最大，差 22 列）
  // ============================================================
  await knex.schema.createTable('t_uni_dorm_apply', (t) => {
    t.string('id', 36).primary().comment('主键UUID');
    t.string('stage', 16).notNullable().defaultTo('jh').comment('★学段');
    t.string('apply_no', 40).comment('申请单号（★只有大学有）');
    t.integer('biz_type').notNullable().defaultTo(1).comment('★统一业务类型 1调换宿舍 2退宿（★大学原列名 apply_category，初_high 无此概念只有换宿）');

    t.string('student_id', 36).notNullable().defaultTo('').comment('学生ID');
    t.string('student_no', 32).notNullable().defaultTo('').comment('学号（快照）');
    t.string('student_name', 50).notNullable().defaultTo('').comment('姓名（快照）');
    t.string('class_id', 36).comment('班级ID');
    t.string('class_name', 50).comment('班级名称');

    // —— 统一用「房间」口径：源表里大学叫 dorm、初高叫 room → 统一 room_*
    t.string('from_room_id', 36).comment('原宿舍/房间ID');
    t.string('from_room_no', 64).comment('原宿舍/房间号');
    t.string('from_bed_id', 36).comment('原床位ID（★只有初高有）');
    t.string('from_bed_no', 20).comment('原床位号');
    t.string('to_room_id', 36).comment('目标宿舍/房间ID（退宿为空）');
    t.string('to_room_no', 64).comment('目标宿舍/房间号');
    t.string('to_bed_id', 36).comment('目标床位ID（★只有初高有）');
    t.string('to_bed_no', 20).comment('目标床位号');

    t.string('apply_reason', 500).notNullable().defaultTo('').comment('申请原因');
    t.integer('is_item_intact').comment('物品完好确认（★源列名两段不同：大学 has_goods_checked / 初高 is_item_intact）');
    t.timestamp('apply_time').comment('申请时间');
    t.string('apply_user_id', 36).comment('★发起人ID（源列名两段不同：大学 applicant_id / 初高 apply_user_id）');
    t.string('apply_user_name', 50).comment('★发起人姓名');

    t.integer('approval_status').notNullable().defaultTo(1).comment('★统一审批状态 1待提交2待审批3待校长4已通过5已驳回6已撤销（初高/大学历史单据的 apply_status 3态在读取时翻译）');
    t.string('approve_user_id', 36).comment('★审批人ID（源：大学 approver_id / 初高 approve_user_id）');
    t.string('approve_user_name', 50).comment('★审批人姓名');
    t.timestamp('approve_time').comment('审批时间');
    t.string('reject_reason', 255).comment('驳回原因');

    t.string('src_db', 32).comment('★来源库');
    t.string('src_id', 36).comment('★来源记录 id');

    t.timestamp('create_time').notNullable().defaultTo(knex.fn.now()).comment('创建时间');
    t.string('create_by', 36).comment('创建人ID');
    t.timestamp('update_time').comment('修改时间');
    t.string('update_by', 36).comment('修改人ID');
    t.integer('is_deleted').notNullable().defaultTo(0).comment('逻辑删除');

    t.index(['stage', 'approval_status'], 'idx_uni_dormapply_stage_status');
    t.index(['student_id'], 'idx_uni_dormapply_student');
  });
};

const down = async function (knex) {
  // ⚠️ 回退是**物理删表** —— 这是本项目唯一的例外：
  //   阶段 B 只建表不搬数据，所以删表不会丢业务数据。
  //   阶段 C 搬数据之后，就**禁止**用 down 回退了（要回退请走数据备份）。
  await knex.schema.dropTableIfExists('t_uni_dorm_apply');
  await knex.schema.dropTableIfExists('t_uni_repeat');
  await knex.schema.dropTableIfExists('t_uni_exam_field');
  await knex.schema.dropTableIfExists('t_uni_exam');
  await knex.schema.dropTableIfExists('t_uni_attendance');
  await knex.schema.dropTableIfExists('t_uni_class_student');
  await knex.schema.dropTableIfExists('t_uni_class');
  await knex.schema.dropTableIfExists('t_uni_student');
};

module.exports = { up, down };
