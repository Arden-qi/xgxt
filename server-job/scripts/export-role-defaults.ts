/**
 * 从当前权限库重新导出「职位默认页面」兜底表
 *
 * 用途：`src/perm/config/roleDefaultPages.ts` 里那张 ROLE_DEFAULT_PAGES
 *   是「老库升级 / 新建职位」时补齐初始授权用的。当前库里的职位授权
 *   一旦调整（比如你在「职位权限分配」里改过），想让它变成新的默认值，
 *   就跑这个脚本重新生成。
 *
 * 用法：
 *   cd server-job && npx tsx scripts/export-role-defaults.ts           # 预览
 *   cd server-job && npx tsx scripts/export-role-defaults.ts --write   # 真正写文件
 *
 * ⚠️ 写文件会保留文件头部的说明注释，只替换下面的数据段。
 */
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../src/perm/utils/db';
import { PERM_TREE } from '../src/perm/config/permTree';

const WRITE = process.argv.includes('--write');
const TARGET = path.resolve(__dirname, '../src/perm/config/roleDefaultPages.ts');

/** 板块顺序：让生成的数组按 workbench → consult → finance → perm → teach 排 */
const BOARD_ORDER = PERM_TREE.map((b) => b.moduleKey);

function sortKey(p: string): [number, string] {
  const mk = p.split('||')[0];
  const i = BOARD_ORDER.indexOf(mk);
  return [i < 0 ? 99 : i, p];
}

async function main(): Promise<void> {
  const rows = (await db('t_perm_role as r')
    .join('t_perm_role_perm as rp', 'rp.role_id', 'r.id')
    .where('r.is_deleted', false)
    .andWhere('rp.is_deleted', false)
    .select('r.role_code as code', 'r.role_name as name', 'rp.module_key as mk', 'rp.item_name as item')
    .orderBy('r.sort_no')
    .orderBy('rp.module_key')
    .orderBy('rp.item_name')
    .groupBy('r.role_code', 'r.role_name', 'r.sort_no', 'rp.module_key', 'rp.item_name')) as {
    code: string;
    name: string;
    mk: string;
    item: string;
  }[];

  const map = new Map<string, { name: string; pages: string[] }>();
  for (const r of rows) {
    const v = map.get(r.code) || { name: r.name, pages: [] };
    v.pages.push(`${r.mk}||${r.item}`);
    map.set(r.code, v);
  }

  const body: string[] = ['/** roleCode → [\'moduleKey||页面名\', ...] */', 'export const ROLE_DEFAULT_PAGES: Record<string, string[]> = {'];
  for (const [code, v] of map) {
    const pages = v.pages.sort((a, b) => {
      const [ia, sa] = sortKey(a);
      const [ib, sb] = sortKey(b);
      return ia - ib || sa.localeCompare(sb, 'zh');
    });
    body.push(`  /** ${v.name}（${pages.length} 页） */`);
    body.push(`  ${code}: [`);
    for (const p of pages) body.push(`    '${p}',`);
    body.push('  ],');
  }
  body.push('};', '');

  console.log(`统计：${map.size} 个职位 / ${[...map.values()].reduce((n, v) => n + v.pages.length, 0)} 条页面授权`);
  for (const [code, v] of map) console.log(`  ${v.name.padEnd(8, '　')} ${String(v.pages.length).padStart(2)} 页  ${code}`);

  if (!WRITE) {
    console.log('\n（预览模式，未写文件。加 --write 真正写入）');
    return;
  }

  // 保留原文件头部注释（到 `export const ROLE_DEFAULT_PAGES` 之前）
  const old = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, 'utf8') : '';
  const idx = old.indexOf('export const ROLE_DEFAULT_PAGES');
  const head = idx > 0 ? old.slice(0, idx) : '';
  const out = (head || '') + body.join('\n');

  fs.writeFileSync(TARGET, out, 'utf8');
  console.log('\n✓ 已写入', TARGET);
}

main()
  .catch((e) => {
    console.error('✗ 导出失败：', e.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.destroy().catch(() => {});
  });
