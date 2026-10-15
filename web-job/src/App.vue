<script setup lang="ts">
/**
 * 布局页 —— 顶部栏 + 左侧菜单 + 内容区（统一门户版）
 *
 * ★ 2026-10-05 深度单体合并：
 *   左侧菜单现在是【一个统一菜单】，按模块分组：
 *     市场咨询 / 财务管理 / 权限管理   ← 来自门户登录下发的 visibleModules（动态）
 *     就业管理 / 教务管理 / 班级管理   ← 来自 /src/config/menu.ts（静态，沿用原逻辑）
 *
 *   判定规则：
 *     · 门户模块分组：账号 visibleModules 里有该模块 → 显示（模块内的页面也按 menus 过滤）
 *     · 就业/教务/班级：沿用「菜单项有 pageCode → hasPage(path) 通过才显示」
 *
 * ⚠️ 再次强调：这里过滤菜单只是"不碍眼"，真正的拦截在后端接口。
 */
import { RouterView, useRoute, useRouter } from 'vue-router';
import { computed, onMounted, ref } from 'vue';
import { MENU, type MenuNode } from '@/config/menu';
/* ★ 第 1 期「入口合并」：把「初高 / 大学 / 实训」的重复菜单收成一个入口。
 *   · matchTeachingPath —— 直连老路由时，左侧菜单要亮在合并后的菜单项上
 *   · anyStageAccessible —— 聚合菜单的显隐：任一学段可访问即显示 */
import { matchTeachingPath } from '@/teaching/domainConfig';
import {
  anyStageAccessible,
  stageVisible,
  STAGE_ACCESS,
  type StageDomain,
} from '@/teaching/access';
import { ROLE_CODE_NAME } from 'shared-types';
import type { ModuleDef } from 'shared-types/portal';
import * as ElementPlusIconsVue from '@element-plus/icons-vue';
import {
  myRoles,
  permissionLoaded,
  loadMyPermissions,
  hasPage,
} from '@/store/permission';
import { useAuthStore as usePortalStore } from '@/portal/stores/auth';
import { portalLogout, moduleAllowed, moduleOfPageCode } from '@/store/modules';
/* ★ 2026-10-06 新增：板块 → 页面 台账（权限管理 → 页面管理）
 *   左侧菜单要按它过滤 —— 被取消勾选的页面 = 该板块没有这个页面。 */
import { pageEnabled } from '@/store/pageConfig';
/* 面包屑导航（内容区顶部的位置指示） */
import BreadcrumbBar from '@/components/BreadcrumbBar.vue';

const route = useRoute();
const router = useRouter();
const portal = usePortalStore();

/** 门户模块图标（按模块 key） */
const MODULE_ICON: Record<string, string> = {
  consult: 'ChatLineRound',
  finance: 'Money',
  perm: 'Lock',
  // ★ 2026-10-05：legacy 模块（就业/教务/班级）由 config/menu.ts 渲染，
  //    这里一并登记图标，将来若改成统一由门户注册表渲染也不用再改。
  job: 'Briefcase',
  edu: 'School',
  class: 'UserFilled',
};

interface ViewChild {
  title: string;
  path?: string;
  key?: string;
  phase?: string;
  stage?: string;
  pageCode?: string;
}
interface ViewGroup {
  title: string;
  icon?: string;
  stage?: string;
  module?: string;
  path?: string;
  children?: ViewChild[];
}

/** 当前激活的菜单项（hash 路由下 route.path 就是 /xxx） */
const activeMenu = computed(() => {
  // 老路径 /transfer 已重定向到 /class-transfer
  if (route.path === '/transfer') return '/class-transfer';
  /* ★ 第 1 期「入口合并」：
   *   左侧菜单现在只有一个「教学管理」分组，重复业务域指向 /teaching/<域>。
   *   用户直连老路由（/exam、/class/exam、/class-jh/exam …）时，
   *   要把高亮归到合并后的菜单项上，否则菜单不亮、用户会以为"点丢了"。
   *   匹配不上（如 /edu/student 之外的杂项页）→ 原样返回，不影响任何逻辑。 */
  const merged = matchTeachingPath(route.path);
  if (merged) return merged;
  return route.path;
});

/**
 * 门户模块分组（动态）—— 直接来自登录下发的 visibleModules
 * ⚠️ 不在这里硬编码标题/路径，避免与门户 MODULES 注册表两处维护、改一处漏一处。
 */
const portalGroups = computed<ViewGroup[]>(() => {
  const mods: ModuleDef[] = portal.visibleModules || [];
  return (
    mods
      /* ============================================================
       * ★ 2026-10-06 修：「未开放的导航」—— 滤掉 legacy 空模块
       *
       * 【现象】左侧菜单顶部多出 4 个点不动的菜单项：
       *         就业管理 / 教务管理 / 班级管理 / 教学管理（初高）
       *         点进去是 /coming「功能开发中」占位页。
       * 【真因】就业/教务/班级/初高 在门户注册表 MODULES 里是 `legacy: true`
       *         且 `menus: []`（页面清单在 config/menu.ts，由 jobGroups 按
       *         pageCode 渲染）。但这里没过滤 legacy ——
       *         `m.menus` 为空 → children 为空 → 模板走「无子菜单」分支，
       *         渲染成一个单层菜单项，跳 /coming。
       *         （portal.ts 的注释早就写了「App.vue 会按 legacy 标记把它们从
       *           门户分组里滤掉」，但这段过滤一直没写，是漏实现。）
       * 【口径】门户分组只渲染「有页面清单的新模块」；
       *         legacy 模块一律交给 jobGroups（受 hasPage / 模块门槛双重过滤）。
       * ============================================================ */
      .filter((m) => !m.legacy && (m.menus?.length ?? 0) > 0)
      .map((m) => ({
        title: m.title,
        icon: MODULE_ICON[String(m.key)] || 'Grid',
        module: String(m.key),
        children: (m.menus || [])
          .map((mi) => ({
            title: mi.title,
            key: mi.key,
            path: `/${m.key}${mi.path}`,
          }))
          /* ★ 2026-10-06 页面台账（权限管理 → 页面管理）：
           *   该板块被取消勾选的页面 = 这个板块没有这个页面 → 不渲染。 */
          .filter((c) => pageEnabled(c.path)),
      }))
  );
});

/**
 * 合并域菜单项的显隐（2026-10-12 新增）
 * ---------------------------------------------------------------
 * 【★ 这条分支修的是「合并后菜单集体消失」】
 *
 * 【症状】校长登录后左侧只剩 8 项（工作台 / 班级交接 / 待接收学员 / 催费·缴费 /
 *        就业日志 / 复盘填写 / 数据统计 / 系统设置），
 *        学生档案、班级管理、出勤管理、考试管理、成绩管理、宿舍管理、
 *        退费、休学/退学审批这 8 个合并域全不见了。
 *
 * 【根因】菜单显隐原本是二选一：
 *        if (stages?.length) → anyStageAccessible(stages)  ← 合并域该走这条
 *        else                 → hasPage(path)             ← 实际走了这条（错）
 *        第 2 期做「真正统一页面」时把 8 个域的 `stages` 清空了（改用 `unified`），
 *        但判定没跟着改 → 落到 hasPage('/teaching/exam')
 *        而后端 `/api/job/auth/my-pages` 下发的 40 个页面里 **`/teaching/*` 一条都没有**
 *        （实测）→ 8 个菜单被**静默过滤**，不报错、日志无痕。
 *
 * 【为什么按权限码判、而不是补回 stages】
 *   `STAGE_ACCESS` 里 19 条旧路由已按第 3 期 D2 **物理删除**（path 全是 null），
 *   那里本来就只能靠权限码判。而权限码来自权限库 `t_perm_page.page_code`，
 *   与后端各域 `requireAnyPage()` 同源 → 前后端口径天然一致。
 *
 * 【显隐口径 = 与合并前完全一致】
 *   「该域下任一学段有权限就显示」，与原 `anyStageAccessible` 语义相同，
 *   所以不会让任何人多看到或少看到页面。
 */
function mergedDomainMenuAllowed(domainKey?: string): boolean | null {
  // 没配 stageDomain（如催费·缴费，它保留了 stages）→ 交回原逻辑
  if (!domainKey) return null;
  const stages = Object.keys(
    (STAGE_ACCESS as Record<string, unknown>)[domainKey] ?? {},
  );
  if (!stages.length) return null; // 对照表里没有这个域 → 交回原逻辑
  return stages.some((s) => stageVisible(domainKey as StageDomain, s));
}

/** 就业/教务/班级分组（静态，沿用原权限逻辑） */
const jobGroups = computed<ViewGroup[]>(() => {
  return MENU.map((mod) => {
    if (!mod.children?.length) return mod as ViewGroup;
    const kids = mod.children.filter((c: MenuNode) => {
      /* ★ 第 1 期「入口合并」：聚合菜单项（带 stages）——
       *   显隐口径 = 「任一学段可访问就显示」。
       *   每个学段仍按它**原来的路径 + 原来的权限码**判（见 teaching/access.ts），
       *   所以用户能看到什么，与合并前**完全一致**。 */
      if (c.stages?.length) return anyStageAccessible(c.stages);
      // ★★ 2026-10-12：合并域（第 2 期清空了 stages）改按 STAGE_ACCESS 权限码判，
      //   详见 mergedDomainMenuAllowed 的注释。返回 null = 本项不适用，走下面的老逻辑。
      const merged = mergedDomainMenuAllowed(c.stageDomain);
      if (merged !== null) return merged;
      if (!c.path) return true;
      if (!hasPage(c.path)) return false;
      // ★ 2026-10-06 页面台账：被「页面管理」取消勾选的页面 = 该板块没有这个页面
      if (!pageEnabled(c.path)) return false;
      // ★ 2026-10-05 两套班级模块隔离（大学部 class / 初高 class-jh）
      return legacyMenuAllowed(c.pageCode);
    });
    return { ...mod, children: kids as ViewChild[] } as ViewGroup;
  }).filter((mod) => {
    if (mod.children) return mod.children.length > 0;
    return true;
  });
});

/**
 * legacy 分组（就业 / 教务 / 大学部班级 / 初高教学）的【模块门槛】
 *
 * 【为什么单靠 hasPage 不够】
 *   ① 大学部班级 / 初高教学：这两个模块用的是**同一批角色码**
 *      （都是 TEACH_HEAD / TEACH_DEAN …），一个大学部班主任的 myPages 里
 *      同时含 class:* 与 classjh:* 的页面码。只看 hasPage 的话，
 *      他会在左侧看到「教学管理（初高）」整组菜单 —— 两套模块就串了。
 *   ② 就业 / 教务：账号在【权限管理】里挂的角色决定页面码。
 *      典型反例：权限管理员（账号 linx）在 sms_perm 里挂的是「系统管理员」角色
 *      → my-pages 下发全部 40 个页面 → 左侧多出「就业管理 / 教务管理 /
 *      班级管理 / 教学管理（初高）」四组菜单，与它门户上只授权 perm 相矛盾。
 *
 * 【做法】按权限码前缀再要求「账号有没有被授权这个模块」
 *   （门户 t_sys_account.modules 是模块级的权威口径）：
 *     job:*      → 必须有 job 模块
 *     edu:*      → 必须有 edu 模块
 *     class:*    → 必须有 class 模块
 *     classjh:*  → 必须有 class-jh 模块
 *
 * ⚠️ 门户身份未加载（portal.account 为空）时不拦 ——
 *    否则非门户来源（或门户接口临时失败）会把这几组菜单整片打没。
 */
function legacyMenuAllowed(pageCode?: string): boolean {
  if (!pageCode) return true;
  if (!portal.account) return true;
  const m = moduleOfPageCode(pageCode);
  return !m || moduleAllowed(m);
}

/** 统一菜单：门户模块在前，就业/教务/班级在后 */
const visibleMenu = computed<ViewGroup[]>(() => [...portalGroups.value, ...jobGroups.value]);

/** 默认展开所有分组 */
const defaultOpeneds = computed(() =>
  visibleMenu.value.filter((m) => m.children?.length).map((m) => m.title),
);

/** 菜单数据到位后再创建 el-menu，default-openeds 才生效 */
const menuReady = computed(() => visibleMenu.value.length > 0);

function getIcon(name?: string) {
  if (!name) return undefined;
  return (ElementPlusIconsVue as Record<string, any>)[name];
}

function goChild(child: ViewChild) {
  return { path: child.path || '/coming', query: { title: child.title } };
}

/** 顶栏显示的身份：门户账号姓名 */
const userNameText = computed(
  () => portal.account?.userName || '未登录',
);

/** 顶栏显示的头衔：门户账号 kind / title */
const roleText = computed(() => {
  const a = portal.account;
  if (a) {
    if (a.title) return a.title;
    if (a.kind === 'sys_admin') return '系统管理员';
    return '模块负责人';
  }
  // 兜底：老口径的角色码（就业/教务/班级账号）
  return myRoles.value.map((r) => ROLE_CODE_NAME[r] || r).join('、') || '未登录';
});

/** 登录页全屏显示，不套左侧菜单的壳 */
const isLoginPage = computed(() => route.path === '/login');

/** 退出登录 → 回统一登录页 */
function doLogout(): void {
  portalLogout();
  router.replace('/login');
}

onMounted(() => {
  // 登录页 / 未登录时不拉（否则会打出一个无 token 的 401）
  if (isLoginPage.value) return;
  if (!localStorage.getItem('sms_token')) return;
  if (!permissionLoaded.value) loadMyPermissions();
});
</script>

<template>
  <RouterView v-if="isLoginPage" />
  <el-container v-else class="layout">
    <!-- ============ 顶部栏（2026-10-15 改版：良志红暖色主题，LOGO 左上角） ============ -->
    <el-header class="header">
      <div class="header-left">
        <img class="header-logo" src="/logo.png" alt="良志教育" />
        <span class="header-div"></span>
        <span class="header-title">学管系统</span>
        <el-tag size="small" effect="light" round class="header-tag">统一门户</el-tag>
      </div>
      <el-input
        class="header-search"
        placeholder="搜索学员、班级、功能…"
        :prefix-icon="getIcon('Search')"
      />
      <div class="header-user">
        <el-badge is-dot class="header-badge">
          <el-button circle class="header-icbtn" title="消息通知">
            <el-icon><component :is="getIcon('Bell')" /></el-icon>
          </el-button>
        </el-badge>
        <el-button circle class="header-icbtn" title="刷新权限" @click="loadMyPermissions">
          <el-icon><component :is="getIcon('Refresh')" /></el-icon>
        </el-button>
        <div class="header-me">
          <div class="header-avatar">{{ (userNameText || 'U').slice(0, 1) }}</div>
          <div class="header-me-txt">
            <span class="header-uname">{{ userNameText }}</span>
            <span class="header-urole">{{ roleText }}</span>
          </div>
        </div>
        <el-button size="small" text class="switch-role" @click="doLogout">退出登录</el-button>
      </div>
    </el-header>

    <el-container class="body-wrap">
      <!-- ============ 左侧菜单（统一） ============ -->
      <el-aside width="228px" class="aside">
        <el-scrollbar>
          <el-menu
            v-if="menuReady"
            :default-active="activeMenu"
            :default-openeds="defaultOpeneds"
            router
            class="side-menu"
          >
            <template v-for="mod in visibleMenu" :key="mod.title">
              <!-- 有子菜单 → 分组 -->
              <el-sub-menu v-if="mod.children?.length" :index="mod.title">
                <template #title>
                  <el-icon v-if="getIcon(mod.icon)">
                    <component :is="getIcon(mod.icon)" />
                  </el-icon>
                  <span class="menu-title">{{ mod.title }}</span>
                  <el-tag
                    v-if="mod.stage"
                    size="small"
                    :type="mod.stage === '已完成' ? 'success' : mod.stage === '开发中' ? 'warning' : mod.stage === '暂缓' ? 'info' : 'danger'"
                    effect="plain"
                    class="menu-stage"
                  >
                    {{ mod.stage }}
                  </el-tag>
                </template>

                <el-menu-item
                  v-for="child in mod.children"
                  :key="child.key || child.title"
                  :index="child.path || child.title"
                  @click="router.push(goChild(child))"
                >
                  <span class="child-title">{{ child.title }}</span>
                  <el-tag
                    v-if="child.phase"
                    size="small"
                    :type="child.phase === '就业' ? 'success' : 'info'"
                    effect="plain"
                    class="menu-stage"
                  >
                    {{ child.phase }}
                  </el-tag>
                  <el-tag
                    v-else-if="child.stage === '已完成'"
                    size="small"
                    type="success"
                    effect="plain"
                    class="menu-stage"
                  >
                    已开发
                  </el-tag>
                </el-menu-item>
              </el-sub-menu>

              <!-- 无子菜单 → 单层菜单项 -->
              <el-menu-item
                v-else
                :index="mod.title"
                @click="router.push(mod.path || '/coming')"
              >
                <el-icon v-if="getIcon(mod.icon)">
                  <component :is="getIcon(mod.icon)" />
                </el-icon>
                <span class="menu-title">{{ mod.title }}</span>
              </el-menu-item>
            </template>
          </el-menu>
        </el-scrollbar>
      </el-aside>

      <!-- ============ 内容区 ============ -->
      <el-main class="main">
        <!-- 面包屑：让用户随时知道自己在哪里（首页 / 分组 / 页面 / 学段） -->
        <BreadcrumbBar />
        <RouterView />
      </el-main>
    </el-container>
  </el-container>
</template>

<style scoped>
/* ============================================================
 * 2026-10-05 修：让「左侧导航」与「右侧内容」各自独立滚动
 *
 * 原来只有 .layout{height:100vh}，缺两样东西：
 *   ① overflow:hidden —— 外层容器没有把高度「锁死」；
 *   ② 内层 .el-container 的 min-height:0 —— flex 列方向子项默认
 *      min-height:auto，不会被压缩到小于内容高度。
 * 结果：内层容器长到内容那么高（实测 1736px），aside/main 也跟着
 *      变成内容高度、自己都不需要滚动 → 变成【整份文档】一根滚动条，
 *      左导航和右内容就一起滚了。
 *
 * 修完：高度锁在 100vh，内层容器被压到「视口 - 顶栏」，
 *      aside 内部 el-scrollbar 滚、main 自己滚，互不影响。
 * ============================================================ */
.layout {
  height: 100vh;
  overflow: hidden;
}

/* 顶栏下面那层（左导航 + 右内容）：必须允许被压缩，否则撑破 100vh */
.body-wrap {
  min-height: 0;
}

/* ============================================================
 * 2026-10-15 顶栏改版（良志红暖色主题）
 *   LOGO 左上角 + 白底 + 暖灰边框 + 搜索框 + 头像身份区
 *   配色与 ui-preview 设计稿一致：红 #CD3A33 只做点缀
 * ============================================================ */
.header {
  display: flex;
  align-items: center;
  gap: 18px;
  background: #fff;
  border-bottom: 1px solid #efe7e2;
  color: #443432;
  flex: none;
  height: 62px;
  padding: 0 18px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 13px;
  flex: none;
}

.header-logo {
  height: 34px;
  width: auto;
}

.header-div {
  width: 1px;
  height: 22px;
  background: #e2d7d1;
}

.header-title {
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 0.5px;
}

.header-tag {
  background: #fdf4f2;
  border-color: #f9e4e1;
  color: #cd3a33;
}

.header-search {
  width: 280px;
  margin-left: 8px;
}

/* 搜索框：胶囊形 + 暖底，聚焦变白 + 红边柔光 */
.header-search :deep(.el-input__wrapper) {
  border-radius: 18px;
  background: #f6f3ef;
  box-shadow: 0 0 0 1px #efe7e2 inset;
}

.header-search :deep(.el-input__wrapper:hover) {
  box-shadow: 0 0 0 1px #f2c8c3 inset;
}

.header-search :deep(.el-input__wrapper.is-focus) {
  background: #fff;
  box-shadow: 0 0 0 1px #cd3a33 inset, 0 0 0 3px rgba(205, 58, 51, 0.12);
}

.header-user {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 14px;
}

.header-icbtn {
  border: 1px solid #efe7e2;
  color: #6b5c58;
  background: #fff;
}

.header-icbtn:hover {
  border-color: #f2c8c3;
  color: #cd3a33;
  background: #fdf4f2;
}

.header-me {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-left: 12px;
  border-left: 1px solid #efe7e2;
}

.header-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: linear-gradient(135deg, #dc7568, #b22a23);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 600;
  flex: none;
  box-shadow: 0 2px 8px rgba(205, 58, 51, 0.3);
}

.header-me-txt {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}

.header-uname {
  font-size: 13px;
  font-weight: 600;
}

.header-urole {
  font-size: 11px;
  color: #9c8d88;
}

/* 顶栏白底，「退出登录」用暖灰描边按钮，悬停转红 */
.switch-role {
  color: #6b5c58;
  border: 1px solid #efe7e2;
  padding: 6px 10px;
  height: auto;
  border-radius: 8px;
}

.switch-role:hover {
  color: #cd3a33;
  background: #fdf4f2;
  border-color: #f2c8c3;
}

.aside {
  background: #fff;
  border-right: 1px solid #E2D7D1;
  /* 高度由 flex 撑满 body-wrap；自己不再溢出，交给内部 el-scrollbar 滚 */
  overflow: hidden;
}

.side-menu {
  border-right: none;
  height: 100%;
}

.menu-title {
  font-weight: 500;
}

.child-title {
  font-size: 13px;
}

/* 菜单里的状态小标签：靠右、缩小、降低存在感 */
.menu-stage {
  margin-left: auto;
  transform: scale(0.85);
  transform-origin: right center;
}

.main {
  background: #F6F3EF;
  padding: 0;
  overflow: auto;
  /* 右侧内容区独立滚动（与左侧导航互不影响） */
  min-height: 0;
}

:deep(.el-menu-item),
:deep(.el-sub-menu__title) {
  height: 44px;
  line-height: 44px;
}
</style>
