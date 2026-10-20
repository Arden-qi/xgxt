<script setup lang="ts">
/**
 * 面包屑导航 —— 让用户看到自己在系统中的位置
 * ============================================================
 *
 * 【显示几级】
 *   首页 / 分组名 / 页面名 / 学段
 *   · 首页     —— 固定，可点击，跳工作台（/class-jh/dashboard）
 *   · 分组名   —— 教学类页面 = 「教学管理」（MENU 顶级分组）；
 *                 门户模块（/consult/* 等）= 该模块中文名（来自登录下发的 visibleModules）
 *   · 页面名   —— 优先用菜单里的 title（用户点进来的名字）；
 *                 菜单里没有的（详情页等）用路由 meta.title
 *   · 学段     —— 各页面自己上报（见 @/store/breadcrumb），空则不显示
 *
 * 【数据源优先级】
 *   分组/页面：先在 MENU 树里按路径找（老路由先经 matchTeachingPath
 *   归到合并菜单项 —— 与左侧菜单高亮 activeMenu 同一套口径），
 *   找不到再退回路由 meta。
 *
 * 【什么情况不显示分组】
 *   当前就在首页（工作台）→ 只显示「首页」一级，避免「首页 / 教学管理 / 工作台」
 *   三个名字挤在一起（工作台就是首页）。
 * ============================================================
 */

import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { matchTeachingPath } from '@/teaching/domainConfig';
import { MENU } from '@/config/menu';
import { breadcrumbStage } from '@/store/breadcrumb';
import { useAuthStore as usePortalStore } from '@/portal/stores/auth';

const route = useRoute();
const portal = usePortalStore();

/** 首页 = 工作台 */
const HOME_PATH = '/class-jh/dashboard';
const HOME_TITLE = '首页';

const isHome = computed(() => route.path === HOME_PATH);

/**
 * 归位后的菜单路径：老路由（/exam、/class/exam…）先映射到合并菜单项
 * （与 App.vue 的 activeMenu 完全同一套口径，保证面包屑和菜单高亮永远一致）
 */
const menuPath = computed(() => matchTeachingPath(route.path) || route.path);

/** 在 MENU 树里找当前页所在的一级分组 */
function findMenuHit(): { group: string; page: string } | null {
  for (const mod of MENU) {
    const hit = mod.children?.find((c) => c.path === menuPath.value);
    if (hit) return { group: mod.title, page: hit.title };
  }
  return null;
}

/** 第二级：分组名 */
const groupTitle = computed(() => {
  if (isHome.value) return '';
  const hit = findMenuHit();
  if (hit) return hit.group;
  // 教学类老页面（MENU 里没有的详情页等）也归「教学管理」
  if (menuPath.value.startsWith('/teaching/')) return '教学管理';
  // 门户模块：中文名取登录下发的 visibleModules（用户菜单上看到的就叫这个）
  const moduleKey = route.meta?.module as string | undefined;
  if (moduleKey) {
    const def = (portal.visibleModules || []).find((m) => m.key === moduleKey);
    if (def?.title) return def.title;
  }
  return '';
});

/** 第三级：页面名 */
const pageTitle = computed(() => {
  if (isHome.value) return '';
  const hit = findMenuHit();
  if (hit) return hit.page;
  return (route.meta?.title as string) || '';
});

/** 第四级：学段（页面内部筛选器上报上来的） */
const stageText = computed(() => breadcrumbStage.stage || '');
</script>

<template>
  <div v-if="!isHome" class="crumb-bar">
    <el-breadcrumb separator="/">
      <el-breadcrumb-item :to="{ path: HOME_PATH }">{{ HOME_TITLE }}</el-breadcrumb-item>
      <el-breadcrumb-item v-if="groupTitle">{{ groupTitle }}</el-breadcrumb-item>
      <el-breadcrumb-item v-if="pageTitle">
        <span class="crumb-current">{{ pageTitle }}</span>
      </el-breadcrumb-item>
      <el-breadcrumb-item v-if="stageText">
        <span class="crumb-current">{{ stageText }}</span>
      </el-breadcrumb-item>
    </el-breadcrumb>
  </div>
</template>

<style scoped>
/* 白底通栏：.main 本身是灰底（#f5f7fa）且 padding 为 0，
   面包屑垫一层白底，与下面的页面卡片视觉分开 */
.crumb-bar {
  background: #fff;
  padding: 10px 16px;
  border-bottom: 1px solid #e4e7ed;
}

/* 末级（当前位置）用深灰加粗，与可点击的前级拉开层次 */
.crumb-current {
  color: #303133;
  font-weight: 600;
}
</style>
