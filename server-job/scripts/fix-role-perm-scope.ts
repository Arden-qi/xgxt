/**
 * 清理「页面已关闭、动作还在」的越权权限行（可重复执行，幂等）
 *
 * 用法：
 *   npm run fix:perm-scope            # 只体检，打印每个职位会被清掉哪些页面
 *   npm run fix:perm-scope -- --apply # 真正写入（走 replaceRolePerms，会更新 perm_count）
 *
 * ============================================================
 * 【它解决的问题】
 *   「页面管理 → 职位」把某页关掉后，`t_perm_role_perm` 里那一页的动作行可能还留着
 *   （历史保存、早期种子数据、从别的职位复制……）。后果：
 *     · 职位列表的「已授权动作」数字虚高（R08 教务老师 26，实际只有 16）；
 *     · 三个页面显示不一致 —— 页面管理 2/13，但分配页概览把已关闭的页也列出来。
 *
 * 【判定口径】
 *   某个职位的合法页面 = `assignScopeOfRole()`（= 页面管理台账：默认 ∪ 打勾 − 去勾），
 *   与登录后菜单/守卫用的是同一份算法，所以"清掉"和"进不去"永远一致。
 *   不在合法页面里的动作行 → 清掉。
 *
 * 【为什么不是改页面台账】
 *   这里只做减法（删越权动作），绝不动 t_perm_page 台账，
 *   所以不会出现「清完某个页面被打开/关掉」的副作用。
 * ============================================================
 */

import 'dotenv/config';
import { db } from '../src/perm/utils/db';
import { assignScopeOfRole, filterPermsByScope } from '../src/perm/services/assignScope';
import { getRolePermMap, replaceRolePerms } from '../src/perm/services/perm.service';

const APPLY = process.argv.includes('--apply');

async function main(): Promise<void> {
  const roles = await db('t_perm_role')
    .where({ is_deleted: false })
    .orderBy('sort_no')
    .select('id', 'role_name', 'role_code', 'perm_count');

  console.log(`模式：${APPLY ? '写入（--apply）' : '体检（只打印，不写库）'}`);
  console.log(`职位数：${roles.length}\n`);

  let touched = 0;

  for (const role of roles) {
    const perms = await getRolePermMap(role.id);
    const before = Object.values(perms).reduce((n, l) => n + (l?.length || 0), 0);
    if (before === 0) continue;

    const scope = await assignScopeOfRole(role.id);
    if (!scope.restricted) {
      // 不设限 = 该职位还没配过页面（新建/清空），没有上限可对照，跳过
      continue;
    }

    const { perms: kept, dropped, droppedItems } = filterPermsByScope(perms, scope);
    if (dropped === 0) continue;

    touched += 1;
    const after = Object.values(kept).reduce((n, l) => n + (l?.length || 0), 0);
    console.log(
      `[${role.id}] ${role.role_name}（${role.role_code}） 动作 ${before} → ${after}` +
        `　清掉 ${dropped} 个越权页面：${droppedItems.map((k) => k.split('||')[1]).join('、')}`,
    );

    if (APPLY) {
      const n = await replaceRolePerms(role.id, kept, 'system:fix-perm-scope');
      console.log(`　　✔ 已写入，perm_count = ${n}`);
    }
  }

  if (touched === 0) console.log('没有发现越权动作行，无需处理。');
  else if (!APPLY) console.log(`\n共 ${touched} 个职位需要清理。加 --apply 写入。`);

  await db.destroy();
}

main().catch(async (e) => {
  console.error(e);
  await db.destroy();
  process.exit(1);
});
