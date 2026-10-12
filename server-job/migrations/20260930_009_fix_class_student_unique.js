/**
 * 迁移脚本：修掉 t_job_class_student 那个「设计有问题」的唯一索引
 *
 * ============================================================
 * 【问题现象】（斌哥 2026-09-30 报）
 *   休学/退学审批通过时报「数据已存在，请勿重复添加」，
 *   底层是 ER_DUP_ENTRY：
 *     Duplicate entry '...-stu0-2' for key 'uk_cs_class_student_status'
 *
 * 【根因】
 *   原来的唯一索引是 `(class_id, student_id, status)` —— 这条约束太死了。
 *   一个学生在**同一个班**是可以"离班 → 再入班"的（典型：末班转出又转回），
 *   于是会产生**两条 status=2（已离班）的历史记录，这是合理的**。
 *   可是审批通过时要把"在班"那条 UPDATE 成"已离班"，一改就撞上了旧的那条。
 *
 * 【正确设计】
 *   唯一约束应该是：**同一个学生在同一个班，最多只有一条「在班」记录**。
 *   离班记录（status=2）不限制条数。
 *
 *   MySQL 没有「部分索引」，标准做法是加一个**生成列**：
 *     在班时   → `class_id + '_' + student_id`（参与唯一性）
 *     离班/已删 → NULL（MySQL 里 NULL 不参与唯一性判断 → 可以有多条）
 *
 * ⚠️ 铁律：不许直接连数据库改表结构，一切变更走脚本！
 */

/**
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  // ---- ① 先确认现有数据没有冲突（同班同学生有多条"在班"记录）----
  const [dupRows] = await knex.raw(`
    SELECT class_id, student_id, COUNT(*) AS n
    FROM t_job_class_student
    WHERE status = 1 AND is_deleted = 0
    GROUP BY class_id, student_id
    HAVING n > 1
  `);
  if (dupRows.length) {
    throw new Error(
      `❌ 迁移中止：发现 ${dupRows.length} 组「同一学生在同一班有多条在班记录」，` +
        `加新唯一索引会失败。请先人工清理后再跑本迁移。`,
    );
  }

  // ---- ② 删掉旧的三元组唯一索引 ----
  await knex.schema.alterTable('t_job_class_student', (t) => {
    t.dropUnique(['class_id', 'student_id', 'status'], 'uk_cs_class_student_status');
  });

  // ---- ③ 加生成列：只有「在班」时才有值，离班/已删 = NULL ----
  await knex.raw(`
    ALTER TABLE t_job_class_student
      ADD COLUMN uk_in_class VARCHAR(80)
        GENERATED ALWAYS AS (
          IF(status = 1 AND is_deleted = 0, CONCAT(class_id, '_', student_id), NULL)
        ) STORED
        COMMENT '仅用于唯一约束：在班时=班级_学生ID；离班/已删为 NULL'
  `);

  // ---- ④ 对生成列建唯一索引（NULL 不参与唯一性 → 离班历史可以多条）----
  await knex.raw(`
    ALTER TABLE t_job_class_student
      ADD UNIQUE KEY uk_cs_in_class (uk_in_class)
  `);

  // ---- ⑤ 原来的三元组保留成普通索引（查"某人在某班的历史"仍然常用）----
  await knex.raw(`
    ALTER TABLE t_job_class_student
      ADD INDEX idx_cs_class_student_status (class_id, student_id, status)
  `);
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function (knex) {
  await knex.raw('ALTER TABLE t_job_class_student DROP INDEX idx_cs_class_student_status');
  await knex.raw('ALTER TABLE t_job_class_student DROP INDEX uk_cs_in_class');
  await knex.raw('ALTER TABLE t_job_class_student DROP COLUMN uk_in_class');

  // 恢复旧索引（⚠️ 如果有"离班又入班"的数据，这一步会失败 —— 那说明本来就不该回滚）
  await knex.schema.alterTable('t_job_class_student', (t) => {
    t.unique(['class_id', 'student_id', 'status'], {
      indexName: 'uk_cs_class_student_status',
    });
  });
};
