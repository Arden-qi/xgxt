/**
 * 操作日志表扩容（全系统留痕用）
 *
 * 背景：`t_perm_log` 原来只服务「权限管理」板块内部的增删改，
 *       字段也只够存 before/after 两个短值。现在要求记录**整个系统**里
 *       每个登录账号的操作，需要补上「哪个接口、什么方法、什么结果、多快、什么设备」。
 *
 * 用法：
 *   npx tsx scripts/migrate-log-audit.ts           # 只看要改什么（dry run）
 *   npx tsx scripts/migrate-log-audit.ts --apply   # 真正执行
 *
 * ⚠️ 幂等：已存在的列会跳过，可以反复执行。
 */

import { db } from '../src/perm/utils/db';

const DB = 'sms_perm';
const TABLE = 't_perm_log';

/** 要补的列（顺序即 ALTER 顺序） */
const ADD_COLUMNS: { name: string; ddl: string }[] = [
  { name: 'api_path', ddl: "varchar(255) DEFAULT NULL COMMENT '访问的接口路径'" },
  { name: 'http_method', ddl: "varchar(10) DEFAULT NULL COMMENT 'HTTP 方法'" },
  { name: 'status_code', ddl: "int DEFAULT NULL COMMENT 'HTTP 状态码'" },
  { name: 'duration_ms', ddl: "int DEFAULT NULL COMMENT '处理耗时（毫秒）'" },
  { name: 'user_agent', ddl: "varchar(255) DEFAULT NULL COMMENT '设备 / 浏览器'" },
];

async function existingColumns(): Promise<Set<string>> {
  const [rows] = (await db.raw(
    `select column_name as name from information_schema.columns
      where table_schema = ? and table_name = ?`,
    [DB, TABLE],
  )) as any[];
  return new Set((rows as { name: string }[]).map((r) => r.name));
}

async function main() {
  const apply = process.argv.includes('--apply');
  const cols = await existingColumns();

  const missing = ADD_COLUMNS.filter((c) => !cols.has(c.name));

  console.log(`库：${DB}  表：${TABLE}`);
  console.log(`现有列：${cols.size} 个`);
  console.log('');

  if (missing.length) {
    console.log('待新增列：');
    missing.forEach((c) => console.log(`  + ${c.name}  ${c.ddl}`));
  } else {
    console.log('待新增列：无（已全部存在）');
  }

  // before/after 两列原来是 varchar(255)，全系统请求摘要放不下 → 扩到 1000
  const widen = ['before_value', 'after_value'];
  console.log('');
  console.log(`待扩容列：${widen.join(', ')} → varchar(1000)`);

  if (!apply) {
    console.log('');
    console.log('（dry run，未改动。加 --apply 执行）');
    await db.destroy();
    return;
  }

  if (missing.length) {
    const clause = missing
      .map((c) => `add column \`${c.name}\` ${c.ddl}`)
      .join(',\n  ');
    const sql = `alter table \`${TABLE}\`\n  ${clause}`;
    console.log('');
    console.log('执行：ALTER TABLE（新增列）');
    await db.raw(sql);
  }

  for (const col of widen) {
    await db.raw(`alter table \`${TABLE}\` modify column \`${col}\` varchar(1000) DEFAULT NULL`);
  }

  const after = await existingColumns();
  console.log('');
  console.log(`✅ 完成。现在共 ${after.size} 列：`);
  console.log('   ' + Array.from(after).join(', '));

  await db.destroy();
}

main().catch(async (e) => {
  console.error('❌ 迁移失败：', e);
  await db.destroy();
  process.exit(1);
});
