<script setup lang="ts">
/**
 * 流失记录 / 未报名待跟进
 *
 * 流程图里「没成交」其实分三种，统计口径各不相同：
 *   ① 未报名·待跟进 → 本次没报，还会跟进，**不计入流失率**，支持二次来访
 *   ② 流失         → 明确不来了，**计入流失率**
 *   ③ 未通过       → 面试就没收，**不计统计、不计流失**
 *
 * 本页用两个 Tab 分开呈现 ① 与 ②，避免把「还能捞回来的人」算成流失。
 * ③ 在「学生管理」里以 REJECTED 状态存在，不进本页。
 */

import { ref, onMounted } from 'vue';
import type { LossRecordItem, LossStats, NotEnrolledItem } from 'shared-types/consult';
import { fetchLossList, fetchLossStats, fetchNotEnrolledList } from '@/consult/api/consult';

/** 当前 Tab：loss = 流失 / notEnrolled = 未报名·待跟进 */
const tab = ref<'loss' | 'notEnrolled'>('loss');

const loading = ref(false);
const keyword = ref('');

/* ---------- 流失 ---------- */
const list = ref<LossRecordItem[]>([]);
const total = ref(0);
const page = ref(1);
const size = ref(10);
const stats = ref<LossStats | null>(null);

/* ---------- 未报名·待跟进 ---------- */
const neList = ref<NotEnrolledItem[]>([]);
const neTotal = ref(0);
const nePage = ref(1);
const neSize = ref(10);

async function load() {
  if (tab.value === 'notEnrolled') {
    await loadNotEnrolled();
    return;
  }

  loading.value = true;
  try {
    const [res, st] = await Promise.all([
      fetchLossList({ page: page.value, size: size.value, keyword: keyword.value || undefined }),
      fetchLossStats(),
    ]);
    list.value = res.list;
    total.value = res.total;
    stats.value = st;
  } finally {
    loading.value = false;
  }
}

async function loadNotEnrolled() {
  loading.value = true;
  try {
    const res = await fetchNotEnrolledList({
      page: nePage.value,
      size: neSize.value,
      keyword: keyword.value || undefined,
    });
    neList.value = res.list;
    neTotal.value = res.total;
  } finally {
    loading.value = false;
  }
}

function search() {
  page.value = 1;
  nePage.value = 1;
  load();
}

/** 切 Tab 时清掉搜索词并重新拉数（两个列表口径不同，不要互相污染） */
function switchTab(name: string | number) {
  tab.value = name as 'loss' | 'notEnrolled';
  keyword.value = '';
  search();
}

onMounted(load);
</script>

<template>
  <div class="page">
    <!-- 统计 -->
    <el-card shadow="never">
      <div class="head">
        <div>
          <div class="head-title">流失统计</div>
          <div class="head-sub">
            流失率 = 流失人数 ÷（建档总数 − 未通过人数）；「未报名·待跟进」不计入流失率
          </div>
        </div>
        <div class="rate" v-if="stats">
          <span class="rate-label">流失率</span>
          <span class="rate-value">{{ stats.lossRate }}%</span>
        </div>
      </div>

      <div v-if="stats" class="stats">
        <div class="stat">
          <div class="stat-label">建档总数（不含未通过）</div>
          <div class="stat-value">{{ stats.totalCount }}</div>
        </div>
        <div class="stat">
          <div class="stat-label">流失人数</div>
          <div class="stat-value danger">{{ stats.lossCount }}</div>
        </div>
        <div class="stat">
          <div class="stat-label">流失率</div>
          <div class="stat-value warn">{{ stats.lossRate }}%</div>
        </div>
      </div>
    </el-card>

    <!-- Tab + 搜索 -->
    <el-card shadow="never">
      <el-tabs :model-value="tab" @tab-change="switchTab">
        <el-tab-pane label="流失记录" name="loss" />
        <el-tab-pane label="未报名·待跟进" name="notEnrolled" />
      </el-tabs>

      <div class="toolbar-row">
        <el-input
          v-model="keyword"
          :placeholder="
            tab === 'loss'
              ? '搜索学生 / 跟进人 / 流失原因'
              : '搜索学生 / 跟进人 / 未报名原因'
          "
          clearable
          style="max-width: 320px"
          @keyup.enter="search"
          @clear="search"
        />
        <el-button type="primary" @click="search">查询</el-button>
      </div>
    </el-card>

    <!-- 列表：流失 -->
    <el-card v-if="tab === 'loss'" shadow="never" class="table-card">
      <el-table v-loading="loading" :data="list" stripe>
        <el-table-column label="学生" min-width="140">
          <template #default="{ row }">
            <div class="stu-name">{{ row.studentName }}</div>
          </template>
        </el-table-column>

        <el-table-column label="跟进人" min-width="120">
          <template #default="{ row }">{{ row.ownerName || '—' }}</template>
        </el-table-column>

        <el-table-column label="流失原因" min-width="220">
          <template #default="{ row }">
            <el-tag size="small" type="danger" effect="plain">{{ row.lossReason || '未填写' }}</el-tag>
          </template>
        </el-table-column>

        <el-table-column label="记录时间" min-width="160">
          <template #default="{ row }">{{ row.createTime }}</template>
        </el-table-column>
      </el-table>

      <el-pagination
        v-model:current-page="page"
        v-model:page-size="size"
        :total="total"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next"
        class="pager"
        @current-change="load"
        @size-change="search"
      />
    </el-card>

    <!-- 列表：未报名·待跟进 -->
    <el-card v-else shadow="never" class="table-card">
      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="这些学生本次没有报名，但仍可跟进；可在「学生管理」里用「二次来访」重新拉回咨询流程"
        class="mb"
      />

      <el-table v-loading="loading" :data="neList" stripe>
        <el-table-column label="学生" min-width="130">
          <template #default="{ row }">
            <div class="stu-name">{{ row.studentName }}</div>
          </template>
        </el-table-column>

        <el-table-column label="跟进人" min-width="110">
          <template #default="{ row }">{{ row.ownerName || '—' }}</template>
        </el-table-column>

        <el-table-column label="未报名原因" min-width="200">
          <template #default="{ row }">
            <el-tag size="small" type="info" effect="plain">{{ row.reason || '未填写' }}</el-tag>
          </template>
        </el-table-column>

        <el-table-column label="后续跟进计划" min-width="200">
          <template #default="{ row }">{{ row.followUpPlan || '—' }}</template>
        </el-table-column>

        <el-table-column label="记录时间" min-width="150">
          <template #default="{ row }">{{ row.createTime }}</template>
        </el-table-column>
      </el-table>

      <el-pagination
        v-model:current-page="nePage"
        v-model:page-size="neSize"
        :total="neTotal"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next"
        class="pager"
        @current-change="loadNotEnrolled"
        @size-change="search"
      />
    </el-card>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.head-title {
  font-weight: 700;
  color: #303133;
}

.head-sub {
  font-size: 12px;
  color: #909399;
  margin-top: 2px;
}

.rate {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.rate-label {
  font-size: 12px;
  color: #909399;
}

.rate-value {
  font-size: 26px;
  font-weight: 700;
  color: #f56c6c;
}

.stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-top: 14px;
}

.stat {
  text-align: center;
  background: #f5f7fa;
  border-radius: 8px;
  padding: 10px;
}

.stat-label {
  font-size: 12px;
  color: #909399;
}

.stat-value {
  font-size: 18px;
  font-weight: 700;
  margin-top: 4px;
  color: #303133;
}

.stat-value.danger {
  color: #f56c6c;
}

.stat-value.warn {
  color: #e6a23c;
}

.toolbar-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.table-card {
  flex: 1;
}

.pager {
  margin-top: 12px;
  justify-content: flex-end;
}

.stu-name {
  font-weight: 600;
  color: #303133;
}

.stu-sub {
  font-size: 12px;
  color: #909399;
  margin-top: 2px;
}

.mb {
  margin-bottom: 12px;
}
</style>
