/**
 * 把 _schema-raw.json 转成 Markdown 表结构文档
 * 用法：node scripts/_schema-to-md.cjs
 */
const fs = require('fs');
const path = require('path');

const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '_schema-raw.json'), 'utf8'));

// 过滤掉 knex 的元数据表（knex_migrations / knex_migrations_lock），只留业务表
for (const d of raw.dbs) {
  if (d.tables) d.tables = d.tables.filter((t) => !String(t.TABLE_NAME).startsWith('knex_'));
  if (d.columns) d.columns = d.columns.filter((c) => !String(c.TABLE_NAME).startsWith('knex_'));
  if (d.indexes) d.indexes = d.indexes.filter((x) => !String(x.TABLE_NAME).startsWith('knex_'));
}

const lines = [];
lines.push('# 良志学管（统一门户版）· 数据库表结构总览');
lines.push('');
lines.push(`> 数据来源：本机 MariaDB \`information_schema\` 实时导出 ｜ 生成时间：${raw.generatedAt}`);
lines.push('> 共 **9 个库**，表 / 字段数量见各章标题。');
lines.push('');
lines.push('---');
lines.push('');

// ---- 目录 ----
lines.push('## 目录');
lines.push('');
raw.dbs.forEach((d, i) => {
  lines.push(`${i + 1}. [\`${d.db}\` — ${d.cn}](#${i + 1}-${d.db})`);
});
lines.push('');
lines.push('---');
lines.push('');

const totalTables = raw.dbs.reduce((s, d) => s + (d.tables || []).length, 0);
const totalCols = raw.dbs.reduce((s, d) => s + (d.columns || []).length, 0);

raw.dbs.forEach((d, i) => {
  lines.push(`## ${i + 1}. \`${d.db}\` — ${d.cn}`);
  lines.push('');
  if (d.error) {
    lines.push(`> ⚠️ 读取失败：${d.error}`);
    lines.push('');
    return;
  }
  lines.push(`**共 ${d.tables.length} 张表 / ${d.columns.length} 个字段**`);
  lines.push('');

  // 表清单速览
  lines.push('| # | 表名 | 说明 | 字段数 | 索引数 |');
  lines.push('|---|---|---|---|---|');
  d.tables.forEach((t, ti) => {
    const cols = d.columns.filter((c) => c.TABLE_NAME === t.TABLE_NAME).length;
    const idxs = new Set(
      d.indexes.filter((x) => x.TABLE_NAME === t.TABLE_NAME).map((x) => x.INDEX_NAME),
    ).size;
    lines.push(`| ${ti + 1} | \`${t.TABLE_NAME}\` | ${t.TABLE_COMMENT || '-'} | ${cols} | ${idxs} |`);
  });
  lines.push('');

  // 每张表的详细字段
  d.tables.forEach((t) => {
    const cols = d.columns
      .filter((c) => c.TABLE_NAME === t.TABLE_NAME)
      .sort((a, b) => a.ORDINAL_POSITION - b.ORDINAL_POSITION);
    lines.push(`### \`${t.TABLE_NAME}\` — ${t.TABLE_COMMENT || '（无注释）'}`);
    lines.push('');
    lines.push('| # | 字段名 | 类型 | 可空 | 默认值 | 键 | 说明 |');
    lines.push('|---|---|---|---|---|---|---|');
    cols.forEach((c) => {
      const nullable = c.IS_NULLABLE === 'YES' ? '是' : '否';
      let def = c.COLUMN_DEFAULT;
      if (def === null || def === undefined) def = '';
      def = String(def).replace(/\|/g, '\\|');
      const key = c.COLUMN_KEY === 'PRI' ? 'PK' : c.COLUMN_KEY === 'UNI' ? 'UQ' : c.COLUMN_KEY === 'MUL' ? 'IDX' : '';
      const extra = c.EXTRA ? ` (${c.EXTRA})` : '';
      const comment = String(c.COLUMN_COMMENT || '').replace(/\|/g, '\\|');
      lines.push(`| ${c.ORDINAL_POSITION} | \`${c.COLUMN_NAME}\` | ${c.COLUMN_TYPE}${extra} | ${nullable} | ${def} | ${key} | ${comment} |`);
    });
    lines.push('');

    // 索引
    const idxs = d.indexes.filter((x) => x.TABLE_NAME === t.TABLE_NAME);
    if (idxs.length) {
      lines.push('**索引**：');
      lines.push('');
      idxs.forEach((x) => {
        const type = x.INDEX_NAME === 'PRIMARY' ? '主键' : x.NON_UNIQUE === 0 ? '唯一' : '普通';
        lines.push(`- ${type} \`${x.INDEX_NAME}\` (${x.cols})`);
      });
      lines.push('');
    }
  });

  lines.push('---');
  lines.push('');
});

lines.unshift('');
const md = lines.join('\n').replace(/^\n+/, '');

const outPath = path.join(__dirname, '..', '..', 'docs', '学管系统-表结构明细.md');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, md, 'utf8');

// 打印汇总清单供快速查看
console.log('=== 表清单 ===');
for (const d of raw.dbs) {
  console.log(`\n## ${d.db} (${d.cn}) — ${(d.tables || []).length} 表`);
  (d.tables || []).forEach((t) => console.log(`  - ${t.TABLE_NAME} : ${t.TABLE_COMMENT || ''}`));
}
console.log(`\nTOTAL: ${totalTables} tables, ${totalCols} columns`);
console.log('written:', outPath);
