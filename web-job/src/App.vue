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
 *
 * ★ 2026-10-16 工作台 = 系统首页（用户指令：每个角色进来第一个页面就是工作台）：
 *   侧栏顶部固定一个「工作台」单层菜单项（所有登录角色可见）；
 *   菜单分组计算整体抽到 config/sideMenu.ts，与首页快捷入口共用同一份口径。
 */
import { RouterView, useRoute, useRouter } from 'vue-router';
import { computed, onMounted, ref, watch } from 'vue';
/* ★ 第 1 期「入口合并」：matchTeachingPath —— 直连老路由时，左侧菜单要亮在合并后的菜单项上 */
import { matchTeachingPath } from '@/teaching/domainConfig';
import { ROLE_CODE_NAME } from 'shared-types';
import * as ElementPlusIconsVue from '@element-plus/icons-vue';
import {
  myRoles,
  permissionLoaded,
  loadMyPermissions,
} from '@/store/permission';
import { useAuthStore as usePortalStore } from '@/portal/stores/auth';
import { portalLogout } from '@/store/modules';
/* 面包屑导航（内容区顶部的位置指示） */
import BreadcrumbBar from '@/components/BreadcrumbBar.vue';
/* ★ 2026-10-16 侧栏菜单计算抽到 config/sideMenu.ts：
 *   工作台首页（views/Workbench.vue）的「快捷入口」要和侧栏用同一套显隐口径，
 *   两处共用一份，避免口径漂移。
 *   注：原先在本文件 import 的 moduleAllowed / moduleOfPageCode / pageEnabled
 *   已随菜单计算一并搬去 sideMenu.ts，本文件不再直接使用，故不再重复引入。 */
import { useSideMenu, type ViewChild } from '@/config/sideMenu';
/* ★ 催费/缴费菜单红点：有待催办事项（初高待缴/大学逾期/就业待催缴）时菜单项亮红点 */
import { useFeeUrgeBadge } from '@/store/feeUrgeBadge';

const route = useRoute();
const router = useRouter();
const portal = usePortalStore();

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

/* ★ 2026-10-16 菜单计算（门户模块分组 / 教学管理分组 / 工作台置顶项 / 默认展开）
 *   原先写在本文件的 portalGroups / jobGroups / mergedDomainMenuAllowed /
 *   legacyMenuAllowed 整体抽到 config/sideMenu.ts，逻辑一行未改；
 *   唯一新增：visibleMenu 顶部固定「工作台」单层菜单项（系统首页）。 */
const { visibleMenu, defaultOpeneds } = useSideMenu();

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

/* 催费/缴费红点 */
const feeUrgeBadge = useFeeUrgeBadge();

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
  // 催费/缴费红点：登录后拉一次
  feeUrgeBadge.refresh();
});

// 进入催费/缴费页时强刷（处理完回来红点随之更新）
watch(() => route.fullPath, (p) => {
  if (p.startsWith('/teaching/fee')) feeUrgeBadge.refresh(true);
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
                  <span
                    v-if="child.title === '催费 / 缴费' && feeUrgeBadge.count > 0"
                    class="menu-red-dot"
                    :title="feeUrgeBadge.tooltip"
                  />
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

              <!-- 无子菜单 → 单层菜单项（★ 2026-10-16：index 支持 path，工作台 '/' 可正常高亮） -->
              <el-menu-item
                v-else
                :index="mod.index || mod.title"
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
/* ★ 催费/缴费菜单红点（右上角） */
:deep(.el-menu-item) {
  position: relative;
}
.menu-red-dot {
  position: absolute;
  top: 8px;
  right: 14px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--el-color-danger);
  cursor: help;
  z-index: 2;
}
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
