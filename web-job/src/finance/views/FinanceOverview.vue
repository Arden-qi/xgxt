<template>
  <div class="page-container">
    <!-- ============ 待办提醒（财务的注意力应该在「待处理」上）============ -->
    <el-alert
      v-if="overview && (overview.pendingFeeCount > 0 || overview.pendingRefundCount > 0)"
      type="warning"
      :closable="false"
      show-icon
      class="todo-alert"
    >
      <template #title>
        当前有
        <b>{{ overview.pendingFeeCount }}</b> 笔缴费待核对、
        <b>{{ overview.pendingRefundCount }}</b> 笔退费待出款，请及时处理
      </template>
    </el-alert>

    <!-- ============ 关键指标卡片 ============ -->
    <el-row :gutter="12" v-loading="loading">
      <el-col :span="6">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-label">在册学生</div>
          <div class="stat-value">{{ overview?.studentCount ?? '—' }}</div>
          <div class="stat-sub">休学 {{ overview?.suspendedCount ?? 0 }} 人</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-label">待核对缴费</div>
          <div class="stat-value warn">{{ overview?.pendingFeeCount ?? 0 }}</div>
          <div class="stat-sub">已核对 {{ overview?.verifiedFeeCount ?? 0 }} 笔</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-label">待财务出款</div>
          <div class="stat-value warn">{{ overview?.pendingRefundCount ?? 0 }}</div>
          <div class="stat-sub">冻结中 {{ overview?.frozenCount ?? 0 }} 人</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-label">缴费账单总额</div>
          <div class="stat-value money">{{ formatAmount(overview?.billPayAmount) }}</div>
          <div class="stat-sub">退费 {{ formatAmount(overview?.billRefundAmount) }}</div>
        </el-card>
      </el-col>
    </el-row>

    <!-- ============ 账目净额 ============ -->
    <el-row :gutter="12" class="mt12">
      <el-col :span="24">
        <el-card shadow="never">
          <template #header>
            <div class="card-header">
              <span>本账期资金概览</span>
              <el-button link type="primary" :icon="Refresh" @click="loadData">刷新</el-button>
            </div>
          </template>
          <el-row :gutter="0" class="money-row">
            <el-col :span="8" class="money-cell">
              <div class="money-label">收款合计</div>
              <div class="money-num income">+ {{ formatAmount(overview?.billPayAmount) }}</div>
            </el-col>
            <el-col :span="8" class="money-cell">
              <div class="money-label">退款合计</div>
              <div class="money-num expense">− {{ formatAmount(overview?.billRefundAmount) }}</div>
            </el-col>
            <el-col :span="8" class="money-cell">
              <div class="money-label">资金净额</div>
              <div class="money-num" :class="netAmount >= 0 ? 'income' : 'expense'">
                {{ netAmount >= 0 ? '+' : '−' }} {{ formatAmount(Math.abs(netAmount)) }}
              </div>
            </el-col>
          </el-row>
        </el-card>
      </el-col>
    </el-row>

    <!-- ============ 快捷入口 ============ -->
    <el-row :gutter="12" class="mt12">
      <el-col :span="24">
        <el-card shadow="never">
          <template #header><span>快捷入口</span></template>
          <div class="shortcuts">
          <!-- ★ 第 3 期 D2 修 bug：原来这四个快捷按钮全都漏了 `/finance/` 前缀
               （写成 /fee /refund /freeze /bill）→ 点进去必然 404。
               路由真值见 router/index.ts 的 `/finance/*` 段。 -->
            <el-button :icon="DocumentChecked" @click="$router.push('/finance/fee')">
              缴费管理（{{ overview?.pendingFeeCount ?? 0 }} 待核对）
            </el-button>
            <el-button :icon="Money" @click="$router.push('/finance/refund')">
              退费管理（{{ overview?.pendingRefundCount ?? 0 }} 待出款）
            </el-button>
            <el-button :icon="Lock" @click="$router.push('/finance/freeze')">
              冻结名单（{{ overview?.frozenCount ?? 0 }} 人）
            </el-button>
            <el-button :icon="Tickets" @click="$router.push('/finance/bill')">账单明细</el-button>
          </div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
/**
 * 财务概览（首页）
 *
 * ⚠️ 设计取向：
 *    财务看首页，第一眼要知道的是「我还有什么没做」，
 *    而不是一堆漂亮的图表。所以待办数字放最上面、用橙色强调。
 */

import { ref, computed, onMounted } from 'vue';
import { Refresh, DocumentChecked, Money, Lock, Tickets } from '@element-plus/icons-vue';
import type { FinanceOverview } from 'shared-types/finance';
import { fetchOverview } from '@/finance/api/finance';
import { formatAmount } from '@/finance/utils/finance';

const loading = ref(false);
const overview = ref<FinanceOverview | null>(null);

/** 资金净额 = 收款 - 退款（单位仍是分，展示时再换算） */
const netAmount = computed(() => {
  if (!overview.value) return 0;
  return (overview.value.billPayAmount || 0) - (overview.value.billRefundAmount || 0);
});

async function loadData() {
  loading.value = true;
  try {
    overview.value = await fetchOverview();
  } catch (e) {
    console.error('加载财务概览失败', e);
  } finally {
    loading.value = false;
  }
}

onMounted(loadData);
</script>

<style scoped>
.page-container {
  padding: 16px;
}

.todo-alert {
  margin-bottom: 12px;
}

.stat-card {
  text-align: center;
}

.stat-label {
  font-size: 13px;
  color: #909399;
}

.stat-value {
  font-size: 28px;
  font-weight: 600;
  margin: 8px 0 4px;
  color: #303133;
}

.stat-value.warn {
  color: #e6a23c;
}

.stat-value.money {
  font-size: 22px;
  color: #409eff;
}

.stat-sub {
  font-size: 12px;
  color: #c0c4cc;
}

.mt12 {
  margin-top: 12px;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.money-row {
  text-align: center;
}

.money-cell {
  padding: 12px 0;
}

.money-label {
  font-size: 13px;
  color: #909399;
  margin-bottom: 8px;
}

.money-num {
  font-size: 22px;
  font-weight: 600;
}

.money-num.income {
  color: #f56c6c; /* 中国习惯：收入用红 */
}

.money-num.expense {
  color: #67c23a; /* 支出用绿 */
}

.shortcuts {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
</style>
