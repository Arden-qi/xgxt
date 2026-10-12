/**
 * 页面台账建表 + 与注册表对齐（可重复执行，幂等）
 *
 * 用法：
 *   npm run seed:perm-pages
 *
 * ============================================================
 * 【它做什么】
 *   ① 建 `sms_perm.t_perm_page`（存在则跳过）
 *   ② 按 `src/perm/config/pageRegistry.ts` 把页面补齐进库
 *      —— 新增的行 enabled=1；已存在的行**只更新标题/路径等展示信息，不动 enabled**
 *
 * 【为什么用 .ts 而不是 .mjs】
 *   注册表（页面清单）是 TS 源码里的单一事实来源，用 tsx 直接 import 它，
 *   就不会出现「脚本里抄一份清单，改代码忘了改脚本」的经典分叉。
 *   （同类脚本 seed-all-demo.mjs / fix-perm-accounts.mjs 是 .mjs，因为它们是纯 SQL 操作。）
 *
 * ⚠️ 服务启动后首次访问 /api/perm/page/list 也会自动建表 + 补齐，
 *    所以本脚本不是必需步骤，只是「不启动服务也能把库准备好」的便利入口。
 * ============================================================
 */

import { db } from '../src/perm/utils/db';
import { ensurePageTable, loadPageBoards } from '../src/perm/services/page.service';
import { PAGE_REGISTRY_TOTAL } from '../src/perm/config/pageRegistry';

async function main(): Promise<void> {
  console.log('▶ 建表 + 与注册表对齐：sms_perm.t_perm_page');

  await ensurePageTable();

  const boards = await loadPageBoards();
  const total = boards.reduce((n, b) => n + b.total, 0);
  const enabled = boards.reduce((n, b) => n + b.enabledCount, 0);

  console.log('');
  console.log('板块'.padEnd(20) + '启用/总数');
  console.log('─'.repeat(40));
  for (const b of boards) {
    console.log(
      `${b.moduleIcon} ${b.moduleName}`.padEnd(20) + `${b.enabledCount}/${b.total}`,
    );
  }
  console.log('─'.repeat(40));
  console.log(`合计：${enabled}/${total} 个页面已启用（注册表共 ${PAGE_REGISTRY_TOTAL} 页）`);

  await db.destroy();
}

main().catch(async (e) => {
  console.error('✖ 失败：', (e as Error).message);
  try {
    await db.destroy();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
