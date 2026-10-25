/**
 * 页面管理 ↔ 职位权限分配 动作行联动 · 存量修复脚本
 *
 * 【背景】★ 2026-10-24 用户口径：「页面管理给了权限，职位权限分配就应该显示出授权来」。
 *   在此之前页面管理勾上页面只写 t_perm_role_page，不产生动作行 ——
 *   于是出现「页面管理 2/6 已配置，职位权限分配 0/6 未授权，登录后却能看到页面」的三面矛盾。
 *   联动逻辑已进正常保存链路（rolePage.service / assign.route），
 *   本脚本负责把**存量数据**一次性补齐：
 *     · 可见页面（默认 ∪ 台账打勾 − 台账去勾）没有动作行 → 补「查看」；
 *     · 有动作行但页面不可见 → 删光；
 *     · perm_count 重算。
 *
 * 【用法】
 *   cd server-job
 *   npx tsx scripts/sync-role-page-actions.ts          # 只打印，不动库
 *   npx tsx scripts/sync-role-page-actions.ts --apply  # 真正写入
 */
import 'dotenv/config';
import { db } from '../src/perm/utils/db';
import { syncAllRolesPageActions } from '../src/perm/services/pageActionSync';

const APPLY = process.argv.includes('--apply');

async function main() {
  const roles = (await db('t_perm_role').where('is_deleted', false).select(
    'id',
    'role_name',
    'perm_count',
  )) as any[];
  console.log(`共 ${roles.length} 个职位，模式：${APPLY ? '★ 写入(--apply)' : '预览（加 --apply 才写库）'}\n`);

  if (!APPLY) {
    // 预览模式：逐职位算一遍但落库前回滚太重，这里直接用只读探针的口径：
    // 把每个职位「可见页面缺动作」的清单打出来（与 pageActionSync 同一套判定）。
    const { PERM_TREE_PAGES } = await import('../src/perm/config/permTree');
    const { effectiveKeysOfRole } = await import('../src/utils/rolePageEffective');
    const { loadModules } = await import('../src/perm/services/perm.service');
    const mods = await loadModules();
    const menuOf = new Map<string, boolean>();
    mods.forEach((m) =>
      m.items.forEach((it) => {
        if (it.actions.some((a) => Number(a.baseAction) === 1)) {
          menuOf.set(`${m.moduleKey}||${it.itemName}`, true);
        }
      }),
    );
    const actions = (await db('t_perm_role_perm').where('is_deleted', false)) as any[];
    const byRole = new Map<string, Set<string>>();
    actions.forEach((a) => {
      const set = byRole.get(String(a.role_id)) || new Set<string>();
      set.add(`${a.module_key}||${a.item_name}`);
      byRole.set(String(a.role_id), set);
    });

    let totalMissing = 0;
    for (const r of roles) {
      const roleCode = String(
        (await db('t_perm_role').where({ id: r.id }).first())?.role_code || '',
      );
      const keys = await effectiveKeysOfRole(roleCode);
      const visibleItems = new Set<string>();
      PERM_TREE_PAGES.forEach((p) => {
        if (keys.has(`${p.moduleKey}||${p.path}`)) visibleItems.add(`${p.moduleKey}||${p.name}`);
      });
      const own = byRole.get(String(r.id)) || new Set<string>();
      const missing = [...visibleItems].filter((k) => !own.has(k) && menuOf.get(k));
      const stale = [...own].filter((k) => !visibleItems.has(k));
      if (missing.length || stale.length) {
        totalMissing += missing.length;
        console.log(`${r.id} ${r.role_name}：缺查看动作 ${missing.length} 页${missing.length ? ' → ' + missing.join('、') : ''}${stale.length ? `；动作行悬空 ${stale.length} 页 → ${stale.join('、')}` : ''}`);
      }
    }
    console.log(`\n预览完成：待补动作页 ${totalMissing} 个。加 --apply 执行写入。`);
    await db.destroy();
    return;
  }

  const results = await syncAllRolesPageActions('fix-script');
  let changed = 0;
  results.forEach((res, roleId) => {
    if (res.added.length || res.removed) {
      changed += 1;
      const name = roles.find((r) => String(r.id) === roleId)?.role_name || roleId;
      console.log(
        `${roleId} ${name}：补「查看」 ${res.added.length} 页（${res.added.join('、') || '—'}），删悬空动作 ${res.removed} 条，perm_count=${res.permCount}`,
      );
    }
  });
  console.log(`\n完成：${changed} 个职位发生了修正。`);
  await db.destroy();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
