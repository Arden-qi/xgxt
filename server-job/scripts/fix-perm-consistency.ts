/**
 * 权限一致性体检 / 修复（可重复执行，幂等）
 *
 * 用法（在 server-job 目录下）：
 *   npx tsx scripts/fix-perm-consistency.ts            # 体检，只打印
 *   npx tsx scripts/fix-perm-consistency.ts --apply    # 写入
 *
 * ============================================================
 * 【它解决的是一类 bug，不是一处】
 *   用户报障（2026-10-23）：「咨询经理在页面管理里财务是 0/6、职位权限分配里
 *   也没有财务，但账号详情里财务还是 2/6；登录后左侧还冒出权限管理；
 *   而且工作台把他显示成『模块负责人』。」
 *
 *   一句话：**同一条权限规则，被四个地方各算了一遍**。
 *     · t_perm_role_perm   动作行（历史残留：页面关了、动作还在）
 *     · t_perm_role_page   页面台账（页面管理里勾/去勾的结果）
 *     · t_sys_account.modules  账号级板块（登录时写死的快照，早已过期）
 *     · t_sys_account.title    账号头衔（空的 → 前端拿账号类型冒充职位）
 *
 *   本脚本把这些**数据层**的漂移一次性抹平；代码层已经改成
 *   单一事实来源（services/assignScope.ts 的 assignScopeOfRole），
 *   所以脚本跑完之后，四个界面天然一致。
 *
 * 【三件事】
 *   ① 每个职位：动作行 ∩ 已授权页面 → 删掉越权动作行，回填 perm_count
 *   ② 每个门户账号：modules 按「职位 → 页面」重算（板块 + legacy 页面码）
 *   ③ 每个门户账号：title 为空时用职位名补上
 *
 * 【安全】
 *   · 只做**减法**（删动作行、收窄 modules）与**补空值**（title），
 *     不会给任何账号 / 职位新增权限；
 *   · 系统管理员（SYS_ADMIN）的账号 modules 原样保留；
 *   · 所属职位在权限库里一个功能点都没有的（新建职位）不受影响；
 *   · 默认只打印，加 --apply 才写库。
 * ============================================================
 */

import 'dotenv/config';
import { db as permDb } from '../src/perm/utils/db';
import { db as portalDb } from '../src/portal/utils/db';
import { assignScopeOfRole, filterPermsByScope } from '../src/perm/services/assignScope';
import { getRolePermMap, replaceRolePerms } from '../src/perm/services/perm.service';
import { effectiveModuleScopeOfAccount } from '../src/utils/rolePageEffective';
import { getUserPagePermissions } from '../src/utils/pagePermissionSource';
import { moduleOfPageCode, SHARED_PAGE_MODULES } from '../src/config/pagePermissions';
import { MODULES, ModuleKey } from 'shared-types/portal';

const APPLY = process.argv.includes('--apply');
const PORTAL_KEYS = new Set(
  MODULES.filter((m) => !m.legacy).map((m) => String(m.key)),
);

/** 门户账号行 */
interface AccRow {
  id: string;
  account: string;
  user_name: string;
  title: string | null;
  modules: any;
}

function parseModules(raw: any): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String);
  try {
    const arr = JSON.parse(String(raw));
    if (Array.isArray(arr)) return arr.map(String);
  } catch {
    /* 逗号分隔 */
  }
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function eqSet(a: string[], b: string[]): boolean {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size !== B.size) return false;
  for (const x of A) if (!B.has(x)) return false;
  return true;
}

/* ============================================================
 * ① 职位：清掉「页面未授权」的动作行
 * ============================================================ */
async function sweepRoles(): Promise<number> {
  const roles = await permDb('t_perm_role')
    .where({ is_deleted: false })
    .orderBy('sort_no');

  let touched = 0;
  for (const role of roles as any[]) {
    const raw = await getRolePermMap(role.id);
    const before = Object.values(raw).reduce((n, l) => n + (l?.length || 0), 0);
    if (!before) continue;

    const scope = await assignScopeOfRole(role.id);
    if (!scope.restricted) continue;

    const { perms, dropped, droppedItems } = filterPermsByScope(raw, scope);
    if (!dropped) continue;

    touched += 1;
    const after = Object.values(perms).reduce((n, l) => n + (l?.length || 0), 0);
    console.log(
      `\n[职位 ${role.id}] ${role.role_name}（${role.role_code}）动作 ${before} → ${after}` +
        `　越权页面：${droppedItems.map((k) => k.split('||')[1]).join('、')}` +
        `（perm_count ${role.perm_count} → ${after}）`,
    );

    if (APPLY) {
      const n = await replaceRolePerms(role.id, perms, 'system:fix-consistency');
      console.log(`    ✔ 已写入，perm_count = ${n}`);
    }
  }
  return touched;
}

/* ============================================================
 * ②③ 门户账号：modules 重算 + title 补全
 * ============================================================ */
async function sweepAccounts(): Promise<number> {
  const accounts = (await portalDb('t_sys_account')
    .where({ is_deleted: false })
    .orderBy('account')) as AccRow[];

  let touched = 0;
  for (const acc of accounts) {
    const scope = await effectiveModuleScopeOfAccount(acc.account);
    const current = parseModules(acc.modules);

    // 没有职位绑定 → 不参与（legacy 账号的 modules 由管理员手工维护）
    if (!scope) continue;

    const isSysAdmin = scope.roleCodes.includes('SYS_ADMIN');
    let expected = current;

    if (!isSysAdmin) {
      /* 门户板块：以「职位 → 页面」为准（这是本次 bug 的正面战场） */
      const portalKeys = Array.from(scope.modules).filter((k) => PORTAL_KEYS.has(k));

      /* legacy 板块（就业/教务/班级/初高）：只做**收窄**，绝不新增。
       *
       * 为什么只减不增：
       *   这四个老板块的菜单由 `config/menu.ts` + 页面权限码渲染，
       *   账号 modules 只是一道「模块门槛」。它的正确值取决于
       *   历史授权习惯（有人手工勾过、有人没勾），代码推不出唯一答案 ——
       *   贸然按页面码补齐（例如给只有 class 的教员补上 class-jh）
       *   等于给账号扩权，可能凭空放出初高菜单。
       *   所以：现有 legacy 板块里，**该账号一个页面码都没有的**才摘掉。
       */
      const currentLegacy = current.filter((k) => !PORTAL_KEYS.has(k) && k !== 'teach' && k !== 'workbench');
      let keptLegacy: string[] = [];
      if (currentLegacy.length) {
        const codes = await getUserPagePermissions(scope.roleCodes);
        const covered = new Set<string>();
        for (const code of codes) {
          (SHARED_PAGE_MODULES[code] || [moduleOfPageCode(code)]).forEach((m) => {
            if (m) covered.add(m);
          });
        }
        keptLegacy = currentLegacy.filter((k) => covered.has(k));
      }

      expected = Array.from(new Set([...portalKeys, ...keptLegacy])).sort();
      // 防锁死：推导结果为空（职位还没配页面）→ 保留原值
      if (!expected.length) expected = current;
    }

    const titleFix = !String(acc.title || '').trim() && scope.roleNames.length
      ? scope.roleNames.join('、')
      : '';

    if (eqSet(current, expected) && !titleFix) continue;

    touched += 1;
    console.log(`\n[账号 ${acc.account}] ${acc.user_name}`);
    if (!eqSet(current, expected)) {
      console.log(`   modules: [${current.join(', ')}] → [${expected.join(', ')}]`);
    }
    if (titleFix) console.log(`   title  : (空) → ${titleFix}`);

    if (APPLY) {
      const patch: any = {};
      if (!eqSet(current, expected)) patch.modules = JSON.stringify(expected);
      if (titleFix) patch.title = titleFix;
      await portalDb('t_sys_account').where({ id: acc.id }).update(patch);
      console.log('   ✔ 已写入');
    }
  }
  return touched;
}

async function main(): Promise<void> {
  console.log(`模式：${APPLY ? '写入（--apply）' : '体检（只打印，不写库）'}\n`);
  console.log('=== ① 职位动作 ↔ 页面授权 ===');
  const rolesTouched = await sweepRoles();
  if (!rolesTouched) console.log('全部一致，无需处理。');

  console.log('\n=== ②③ 账号板块 / 头衔 ===');
  const accTouched = await sweepAccounts();
  if (!accTouched) console.log('全部一致，无需处理。');

  console.log(
    `\n合计：职位 ${rolesTouched} 个、账号 ${accTouched} 个${APPLY ? ' 已修正' : ' 待修正'}`,
  );

  await permDb.destroy();
  await portalDb.destroy();
}

main().catch(async (e) => {
  console.error(e);
  await permDb.destroy().catch(() => undefined);
  await portalDb.destroy().catch(() => undefined);
  process.exit(1);
});
