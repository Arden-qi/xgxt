/**
 * 板块 → 页面 台账（页面管理）前端缓存
 *
 * ============================================================
 * 【它在系统里的位置】
 *   「权限管理 → 页面管理」把两件事落成数据：
 *     ① 每个板块「有哪些页面」      → 后端 `sms_perm.t_perm_page`
 *     ② 每个角色「能看哪些页面」    → 后端 `sms_perm.t_perm_role_page`
 *   本模块把这两层合成后拉到前端，回答唯一一个问题：
 *   **这个路由 path 现在还有效吗？**
 *
 *   两处消费：
 *     · `App.vue` 左侧菜单 —— 被关掉的页面不渲染（门户分组 + 就业/教务/班级分组）
 *     · `router/index.ts` 守卫 —— 直连 URL 也进不去（弹回可用的落地页）
 *
 * 【★ 2026-10-07 换了接口，修了一个真问题】
 *   原来调的是 `/api/perm/page/enabled-paths`，它挂在 permAuth 下，
 *   **要求账号 modules 含 perm**。实测：班主任 zhanght / 财务 liukj 调它一律 403
 *   → 本模块走约定 ② 的降级「拉不到就不过滤」→ 结果**页面台账对非权限账号
 *   的前端菜单完全没生效**（后端 requirePage 才是真闸，两边口径不一致）。
 *   现在改调 `/api/perm/page/my-paths`：宽松鉴权（只验 JWT），
 *   所有账号都能拿到自己的清单，而且**服务端已经把「角色 → 页面」算进去了**。
 *
 * 【四条硬约定】
 *   ① 台账里**没登记过**的 path（登录页、无权限页、详情页…）→ 一律放行。
 *      台账只管它自己登记过的那些页面。
 *   ② **拉不到台账 = 不做任何过滤**。台账接口挂了（后端没起、网络抖、
 *      账号实在拿不到令牌）绝不能让整个系统「少页面」—— 那是灾难性降级。
 *   ③ 用原生 fetch 而不是 `@/perm/api/request`：那个客户端失败会自动弹
 *      「服务异常」提示，而大多数账号（班主任/教务/财务…）本来就不常访问
 *      权限模块，登录后每次都会看到一个无意义的报错弹窗。
 *   ④ 换账号（localStorage 里 token 变了）自动重取，避免沿用上一个账号拉到的台账。
 * ============================================================
 */

import { ref } from 'vue';
import { useAuthStore as usePortalStore } from '@/portal/stores/auth';

/** 接口路径（走 Vite 代理 → 8004）
 *  ⚠️ 必须是 /my-paths 而不是 /enabled-paths —— 后者要 perm 模块权限，见文件头。 */
const API = '/api/perm/page/my-paths';

/** 台账里登记过的全部 page path（= 受台账管的范围） */
const allPaths = ref<Set<string>>(new Set());

/** 台账里【已启用】的 page path */
const enabledPaths = ref<Set<string>>(new Set());

/** 是否已成功加载过（失败时不置位，换账号/换页面还能再试） */
export const pageConfigReady = ref(false);

/** 上次加载是否成功（失败时 pageEnabled 恒 true → 不过滤） */
export const pageConfigOk = ref(false);

/** 上次加载用的 token（用于识别「换账号了」） */
let lastToken = '';

/** 正在飞行的请求（并发去重） */
let flying: Promise<void> | null = null;

/* ============================================================
 * 加载
 * ============================================================ */

/**
 * 拉台账
 *
 * 幂等：已加载过且 token 没变 → 直接返回；并发调用共享同一个 Promise。
 *
 * @param force 强制刷新（页面管理保存后调用，让菜单立刻跟着变）
 */
export function ensurePageConfig(force = false): Promise<void> {
  const token = localStorage.getItem('sms_token') || '';
  if (!force && pageConfigReady.value && token === lastToken) return Promise.resolve();
  if (!force && flying) return flying;

  flying = (async () => {
    try {
      const res = await fetch(API, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      if (body?.code !== 200 || !body?.data) throw new Error(body?.message || '响应格式异常');

      const data = body.data as { paths?: string[]; allPaths?: string[] };
      // ⚠️ 必须换新 Set 实例：只 clear/add 的话 ref 引用没变，
      //    依赖它的 computed 不会重算，菜单不会更新。
      enabledPaths.value = new Set(data.paths || []);
      allPaths.value = new Set(data.allPaths || data.paths || []);
      pageConfigOk.value = true;
      pageConfigReady.value = true;
      lastToken = token;
    } catch {
      // 降级：不做任何过滤（见文件头约定 ②）。不置 ready，下次进页面还会再试。
      enabledPaths.value = new Set();
      allPaths.value = new Set();
      pageConfigOk.value = false;
    } finally {
      flying = null;
    }
  })();

  return flying;
}

/** 保存后刷新（页面管理页调用） */
export function refreshPageConfig(): Promise<void> {
  return ensurePageConfig(true);
}

/* ============================================================
 * 判定
 * ============================================================ */

/**
 * ★ 这个页面现在可用吗？（菜单显隐 + 路由守卫共用同一个判据）
 *
 *   台账里没这个 path → true（不受台账管，放行）
 *   台账里有         → 看有没有打勾
 *   台账没拉到       → true（整体降级，见文件头约定 ②）
 */
export function pageEnabled(path?: string): boolean {
  if (!path) return true;
  if (!pageConfigOk.value) return true;
  if (!allPaths.value.has(path)) return true;
  return enabledPaths.value.has(path);
}

/** 是否被台账明确关掉了（用于提示文案，比 pageEnabled 更精确） */
export function pageDisabled(path?: string): boolean {
  if (!path) return false;
  if (!pageConfigOk.value) return false;
  return allPaths.value.has(path) && !enabledPaths.value.has(path);
}

/** 台账里已启用的页面数 / 总页面数 */
export function pageConfigStat(): { enabled: number; total: number } {
  return { enabled: enabledPaths.value.size, total: allPaths.value.size };
}

/* ============================================================
 * 菜单过滤 / 兜底落地
 * ============================================================ */

/** 按台账过滤菜单子项（path 不在台账或已启用的保留） */
export function filterMenuByPage<T extends { path?: string }>(items: T[]): T[] {
  return items.filter((it) => pageEnabled(it.path));
}

/**
 * 第一个「有权限且台账里启用了」的门户页面路径；找不到返回空串
 *
 * ⚠️ 与 store/modules.ts 的 portalLandingPath() 的区别：
 *   portalLandingPath 只看「有没有权限」（第一个模块的第一页），
 *   本函数还要过一遍页面台账 —— 否则把落地页关了之后，
 *   守卫会一直把用户往那个已关闭的页面上送（多跳一次才落到 /no-permission）。
 */
export function firstEnabledPortalPath(): string {
  try {
    const portal = usePortalStore();
    for (const m of portal.visibleModules || []) {
      // legacy 模块的路径不带模块前缀、清单在 config/menu.ts，这里拼不出来 → 跳过
      if (m.legacy) continue;
      for (const mi of m.menus || []) {
        const path = `/${m.key}${mi.path}`;
        if (pageEnabled(path)) return path;
      }
    }
  } catch {
    /* 门户身份还没加载：交给调用方的下一级兜底 */
  }
  return '';
}
