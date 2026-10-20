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
  border: 1px solid #EFE9E4;
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
  color: #7A6C67;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.kpi-filter-tip {
  font-size: 11px;
  color: #C4B8B2;
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
  color: #A2938E;
  margin-top: 2px;
}

/* 色板：一套主色 + 浅底 + 光圈，避免每个卡片各写一遍 */
.tone-blue {
  --tone: #CD3A33;
  --tone-bg: #FBF7F4;
  --tone-ring: rgba(58, 122, 254, 0.16);
}
.tone-green {
  --tone: #4E9A6C;
  --tone-bg: #EBF5EF;
  --tone-ring: rgba(26, 156, 104, 0.16);
}
.tone-orange {
  --tone: #C9852E;
  --tone-bg: #FBF6EE;
  --tone-ring: rgba(224, 139, 26, 0.16);
}
.tone-purple {
  --tone: #8A6AC0;
  --tone-bg: #F3EFF8;
  --tone-ring: rgba(122, 90, 245, 0.16);
}
.tone-red {
  --tone: #CD3A33;
  --tone-bg: #FDF4F2;
  --tone-ring: rgba(217, 74, 74, 0.16);
}
.tone-gray {
  --tone: #7A6C67;
  --tone-bg: #FAF7F4;
  --tone-ring: rgba(122, 108, 103, 0.14);
}
</style>
