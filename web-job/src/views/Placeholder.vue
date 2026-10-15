<script setup lang="ts">
/**
 * 占位页 —— 给「框架已定、功能未开发」的菜单项用
 *
 * 为什么要做这个页？
 *   左侧菜单要按完整框架铺开（让所有人看到全貌），
 *   但大部分模块是别人负责的，还没开发。
 *   点进来不能白屏 —— 白屏会让人以为「系统坏了」，
 *   所以统一跳到这里，明确告诉用户：这个菜单是什么、谁在做、什么状态。
 *
 * 数据来源：/src/config/menu.ts —— 菜单配置的唯一来源
 */
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { findMenuNode } from '@/config/menu';
import { InfoFilled } from '@element-plus/icons-vue';

const route = useRoute();

/**
 * 当前路由对应的菜单配置
 * 难点：部分未开发菜单共用 /coming，光靠路径分不出来，
 * 所以跳转时带了 ?title=xxx，用标题反查最准。
 * （2026-09-29 起：未开发模块也用自己的真实 path，此时按路径就能查到）
 */
const node = computed(() => findMenuNode(route.path, route.query.title as string | undefined));

const ownerText = computed(() => node.value?.owner || '待分配');
const stageText = computed(() => node.value?.stage || '未启动');
const descText = computed(() => node.value?.desc || '该功能尚未开发，请等待对应负责人交付。');
const stageTagType = computed(() => {
  const s = node.value?.stage;
  if (s === '已完成') return 'success';
  if (s === '开发中') return 'warning';
  if (s === '暂缓') return 'info';
  return 'danger';
});
</script>

<template>
  <div class="page-container">
    <el-card shadow="never" class="ph-card">
      <div class="ph-body">
        <el-icon class="ph-icon"><InfoFilled /></el-icon>

        <div class="ph-title">{{ node?.title || route.meta.title || '未命名页面' }}</div>

        <div class="ph-tags">
          <el-tag size="small" effect="plain">负责人：{{ ownerText }}</el-tag>
          <el-tag size="small" :type="stageTagType" effect="plain">状态：{{ stageText }}</el-tag>
        </div>

        <div class="ph-desc">{{ descText }}</div>

        <div class="ph-hint">
          <p>本包为<strong>就业管理 · 实训</strong>模块，左侧菜单只列出本模块的功能。</p>
          <p>功能未开发的菜单点进来会停在本页，属正常现象，不是系统故障。</p>
        </div>

        <!-- ★ 第 3 期 D2：旧 `/class` 路由已下线，改跳统一页并带实训学段 -->
        <el-button type="primary" @click="$router.push({ path: '/teaching/class', query: { stage: 'job' } })">
          去看已开发的「班级信息管理」
        </el-button>
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.ph-card {
  max-width: 720px;
  margin: 60px auto;
}

.ph-body {
  text-align: center;
  padding: 24px 16px;
}

.ph-icon {
  font-size: 48px;
  color: #CD3A33;
  margin-bottom: 12px;
}

.ph-title {
  font-size: 20px;
  font-weight: 600;
  color: #443432;
  margin-bottom: 14px;
}

.ph-tags {
  display: flex;
  gap: 8px;
  justify-content: center;
  margin-bottom: 18px;
  flex-wrap: wrap;
}

.ph-desc {
  font-size: 14px;
  color: #7A6C67;
  line-height: 1.7;
  margin-bottom: 20px;
}

.ph-hint {
  background: #F6F3EF;
  border-radius: 6px;
  padding: 14px 18px;
  margin-bottom: 24px;
  text-align: left;
}

.ph-hint p {
  margin: 0 0 6px;
  font-size: 13px;
  color: #A2938E;
  line-height: 1.6;
}

.ph-hint p:last-child {
  margin-bottom: 0;
}
</style>
