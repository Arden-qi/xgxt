<script setup lang="ts">
/**
 * KPI 指标卡（7 个页面通用）
 *
 * ⚠️ 为什么抽出来：每个页面顶部都有 4~5 个指标卡，
 *    如果各写一遍，改一次样式要改 7 个地方，早晚长歪。
 *    这里统一：点击可筛选（active 高亮）+ 数值 + 副标题。
 */

withDefaults(
  defineProps<{
    label: string;
    value: number | string;
    hint?: string;
    tone?: 'blue' | 'green' | 'orange' | 'purple' | 'red' | 'gray';
    /** 是否可点击筛选 */
    clickable?: boolean;
    /** 当前是否处于筛选态 */
    active?: boolean;
  }>(),
  { tone: 'blue', clickable: false, active: false, hint: '' },
);

defineEmits<{ (e: 'click'): void }>();
</script>

<template>
  <div
    class="kpi"
    :class="[`tone-${tone}`, { clickable, active }]"
    @click="clickable && $emit('click')"
  >
    <div class="kpi-label">
      {{ label }}
      <span v-if="clickable" class="kpi-filter-tip">{{ active ? '筛选中' : '点击筛选' }}</span>
    </div>
    <div class="kpi-value">{{ value }}</div>
    <div v-if="hint" class="kpi-hint">{{ hint }}</div>
  </div>
</template>

<style scoped>
.kpi {
  position: relative;
  background: #fff;
  border: 1px solid #e7ebf0;
  border-radius: 10px;
  padding: 14px 16px;
  min-width: 0;
  transition: all 0.16s;
}

.kpi.clickable {
  cursor: pointer;
}

.kpi.clickable:hover {
  border-color: var(--tone);
  box-shadow: 0 2px 10px rgba(58, 122, 254, 0.08);
  transform: translateY(-1px);
}

.kpi.active {
  border-color: var(--tone);
  background: var(--tone-bg);
  box-shadow: 0 0 0 2px var(--tone-ring);
}

.kpi-label {
  font-size: 13px;
  color: #606266;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.kpi-filter-tip {
  font-size: 11px;
  color: #b0b6be;
}

.kpi.active .kpi-filter-tip {
  color: var(--tone);
}

.kpi-value {
  font-size: 26px;
  font-weight: 700;
  line-height: 1.25;
  margin-top: 6px;
  color: var(--tone);
  font-variant-numeric: tabular-nums;
}

.kpi-hint {
  font-size: 12px;
  color: #909399;
  margin-top: 2px;
}

/* 色板：一套主色 + 浅底 + 光圈，避免每个卡片各写一遍 */
.tone-blue {
  --tone: #3a7afe;
  --tone-bg: #f4f8ff;
  --tone-ring: rgba(58, 122, 254, 0.16);
}
.tone-green {
  --tone: #1a9c68;
  --tone-bg: #f2fbf7;
  --tone-ring: rgba(26, 156, 104, 0.16);
}
.tone-orange {
  --tone: #e08b1a;
  --tone-bg: #fff9f0;
  --tone-ring: rgba(224, 139, 26, 0.16);
}
.tone-purple {
  --tone: #7a5af5;
  --tone-bg: #f7f5ff;
  --tone-ring: rgba(122, 90, 245, 0.16);
}
.tone-red {
  --tone: #d94a4a;
  --tone-bg: #fef4f4;
  --tone-ring: rgba(217, 74, 74, 0.16);
}
.tone-gray {
  --tone: #606266;
  --tone-bg: #f7f8fa;
  --tone-ring: rgba(96, 98, 102, 0.14);
}
</style>
