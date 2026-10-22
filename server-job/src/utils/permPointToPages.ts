/**
 * 权限库「功能点」→ 页面权限码 的映射（页面级打通层）
 *
 * ============================================================
 * 【★ 2026-10-22 重写：功能点已经**就是**页面，映射变成直读】
 *
 * 旧版权限树的功能点是业务概念（「预到校名单」「试算…」），
 * 和页面（`/consult/student`）不是一一对应，所以这里要手抄一张
 * 「功能点 → 页面码」对照表，还专门写了「只对自建角色启用」的闸门
 * （因为那张表的粒度比页面级口径粗，会给内置角色凭空加页）。
 *
 * 现在权限树的功能点就是一个页面（`permTree.ts` 里 item = 页面），
 * 每个页面的 pageCodes 直接写在定义里（与 pageRegistry 同源）：
 *   `consult||学生管理` → ['consult:student:view', …]
 * 于是这张「对照表」不需要再维护，由权限树派生即可。
 *
 * 【为什么还要留 baseCodes 参数（前缀挑选）】
 *   合并后的教学管理页面一页挂多个学段码，例如「学生档案」同时挂
 *   `classjh:student:view` / `class:student:view` /
 *   `job:empArchive:view` / `edu:student:view`。
 *   给一个「只有 edu 印记」的角色新增这一页时，**不能**把四个码全给它
 *   （那会让它凭空多出初高 / 大学 / 就业三个学段的页签）。
 *   所以：优先保留它本来就有的码；否则只补与它现有前缀相同的码；
 *   都不匹配（如管理员/校长这类本来就没有学段印记的角色）才全给。
 * ============================================================
 */

import { RoleCode } from 'shared-types';
import { PERM_TREE_PAGES } from '../perm/config/permTree';

/** `module_key||item_name` → 该页面挂的页面权限码 */
export const PERM_POINT_TO_PAGE_CODES: Record<string, readonly string[]> = Object.fromEntries(
  PERM_TREE_PAGES.map((p) => [`${p.moduleKey}||${p.name}`, p.pageCodes]),
);

/** 权限码前缀（`class:student:view` → `class:`） */
function prefixOf(code: string): string {
  const i = code.indexOf(':');
  return i < 0 ? code : code.slice(0, i + 1);
}

/**
 * 由「角色的功能点清单」算出它可见页面所对应的页面权限码。
 *
 * @param moduleItems 该角色的功能点：`{ module_key: [功能点名, ...] }`
 * @param baseCodes   该角色原本已有的页面码（用于学段前缀挑选，可省略）
 * @returns 页面权限码数组（可能含重复，调用方自行 Set 去重）
 */
export function pageCodesFromModuleItems(
  moduleItems: Record<string, string[]> | undefined | null,
  baseCodes: string[] = [],
): string[] {
  if (!moduleItems) return [];
  const base = new Set(baseCodes ? [...baseCodes] : []);
  const basePrefixes = new Set([...base].map(prefixOf));
  const out: string[] = [];

  for (const [mod, items] of Object.entries(moduleItems)) {
    for (const item of items || []) {
      const codes = PERM_POINT_TO_PAGE_CODES[`${mod}||${item}`];
      if (!codes?.length) continue;

      // ① 本来就有的码 → 原样保留（不扩权）
      const keep = codes.filter((c) => base.has(c));
      if (keep.length) {
        keep.forEach((c) => out.push(c));
        continue;
      }
      // ② 只补与现有学段前缀相同的码（避免跨学段凭空开页签）
      const sameStage = codes.filter((c) => basePrefixes.has(prefixOf(c)));
      if (sameStage.length) {
        sameStage.forEach((c) => out.push(c));
        continue;
      }
      // ③ 没有任何学段印记（管理员 / 校长 / 新建角色）→ 全给
      codes.forEach((c) => out.push(c));
    }
  }
  return out;
}

/** 页面码 → 声明它的页面（一个码可能被同页多学段共用） */
const CODE_TO_PAGES = new Map<string, Array<{ mod: string; name: string }>>();
for (const page of PERM_TREE_PAGES) {
  for (const code of page.pageCodes) {
    const list = CODE_TO_PAGES.get(code) || [];
    list.push({ mod: page.moduleKey, name: page.name });
    CODE_TO_PAGES.set(code, list);
  }
}

/**
 * 把「角色已经被收回的页面」对应的页面权限码从数组里剔掉
 *
 * 页面级真闸（requirePage / my-pages）读的是页面码，而「收回页面」这件事
 * 只体现在权限树里（该页面下一个动作都没勾）。不做这一层的话，
 * 管理员取消勾选后页面确实从菜单消失了，但直接敲接口仍然 200。
 *
 * ⚠️ 只处理「权限树里登记过的页面」——像 /class/:id/students（花名册）
 *    这类子页不在台账里，它的码不受影响（跟着父页面走）。
 */
export function removeCodesOfRevokedPages(
  codes: string[],
  moduleItems: Record<string, string[]> | undefined | null,
): string[] {
  const granted = new Set<string>();
  for (const [mod, items] of Object.entries(moduleItems || {})) {
    for (const name of items || []) granted.add(`${mod}||${name}`);
  }
  return codes.filter((code) => {
    const owners = CODE_TO_PAGES.get(code);
    if (!owners?.length) return true;
    return owners.some((o) => granted.has(`${o.mod}||${o.name}`));
  });
}

/** 兼容旧名字（等价于不带 baseCodes 的版本） */
export function extraPageCodesFromModuleItems(
  moduleItems: Record<string, string[]> | undefined | null,
): string[] {
  return pageCodesFromModuleItems(moduleItems);
}

/** 主包内置角色码集合（= RoleCode 枚举的全部取值） */
const BUILTIN_ROLE_CODES: ReadonlySet<string> = new Set(Object.values(RoleCode));

/** 该角色码是不是「主包内置角色」 */
export function isBuiltinRoleCode(roleCode: string): boolean {
  return BUILTIN_ROLE_CODES.has(roleCode);
}
