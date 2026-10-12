<template>
  <div class="page-container">
    <!-- ============ 顶部：考试信息 + 返回 ============ -->
    <el-card shadow="never" class="head-card">
      <div class="head-row">
        <div class="head-left">
          <el-button :icon="ArrowLeft" @click="goBack">返回</el-button>
          <span class="exam-title">{{ summary?.examName || '成绩汇总' }}</span>
          <el-tag v-if="summary" size="small" effect="plain">{{ summary.examTime }}</el-tag>
          <el-tag v-if="summary" size="small" type="info" effect="plain">
            {{ summary.classNames }}
          </el-tag>
        </div>
        <div class="head-right">
          <el-tag type="warning" effect="plain">只读页面</el-tag>
        </div>
      </div>
    </el-card>

    <!-- ============ 合计卡片 ============ -->
    <el-row v-if="summary" :gutter="12" class="stat-row">
      <el-col :span="6">
        <el-card shadow="never" class="stat-card">
          <div class="stat-label">学生总数</div>
          <div class="stat-value">{{ summary.total.studentCount }}</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="never" class="stat-card">
          <div class="stat-label">已录入成绩</div>
          <div class="stat-value blue">{{ summary.total.scoredCount }}</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="never" class="stat-card">
          <div class="stat-label">综合平均分</div>
          <div class="stat-value">{{ fmt(summary.total.avgScore) }}</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="never" class="stat-card">
          <div class="stat-label">末班人数</div>
          <div class="stat-value red">{{ summary.total.repeatCount }}</div>
        </el-card>
      </el-col>
    </el-row>

    <!-- ============ 分班明细 ============ -->
    <el-card shadow="never" class="table-card">
      <div class="toolbar">
        <span class="toolbar-title">分班明细</span>
        <span class="toolbar-tip">综合成绩 =（卷面×50% + 机试×50%）×50% + 面试×50%</span>
      </div>

      <el-table
        v-loading="loading"
        :data="summary?.rows || []"
        border
        stripe
        style="width: 100%"
        empty-text="该场考试暂无班级数据"
      >
        <el-table-column type="index" label="序号" width="60" align="center" />
        <el-table-column prop="className" label="班级" min-width="140" />
        <el-table-column prop="studentCount" label="学生总数" width="100" align="center" />
        <el-table-column label="已录入" width="100" align="center">
          <template #default="{ row }">
            <el-tag
              size="small"
              :type="row.scoredCount >= row.studentCount && row.studentCount > 0 ? 'success' : 'warning'"
            >
              {{ row.scoredCount }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="平均分" width="100" align="center">
          <template #default="{ row }">
            <span class="num strong">{{ fmt(row.avgScore) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="最高分" width="100" align="center">
          <template #default="{ row }">
            <span class="num green">{{ fmt(row.maxScore) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="最低分" width="100" align="center">
          <template #default="{ row }">
            <span class="num red">{{ fmt(row.minScore) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="末班人数" width="110" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.repeatCount > 0" type="danger" size="small">{{ row.repeatCount }}</el-tag>
            <span v-else>0</span>
          </template>
        </el-table-column>
      </el-table>

      <!-- 合计行 -->
      <div v-if="summary" class="total-row">
        <span class="total-label">全部班合计</span>
        <span class="total-item">学生总数：<b>{{ summary.total.studentCount }}</b></span>
        <span class="total-item">已录入：<b class="blue">{{ summary.total.scoredCount }}</b></span>
        <span class="total-item">平均分：<b>{{ fmt(summary.total.avgScore) }}</b></span>
        <span class="total-item">末班人数：<b class="red">{{ summary.total.repeatCount }}</b></span>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
/**
 * 成绩汇总页（领导用，只读）
 *
 * 功能：看该场考试各班平均分/最高分/最低分/末班人数
 * 接口：/api/job/exam/summary?id=xxx
 * 字段依据：docs/考试成绩-字段定稿.md
 */

import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowLeft } from '@element-plus/icons-vue';
import type { ExamSummary } from 'shared-types';
import { fetchExamSummary } from '@/api/exam';

const route = useRoute();
const router = useRouter();

const loading = ref(false);
const summary = ref<ExamSummary | null>(null);

function fmt(v: number | null | undefined): string {
  if (v === undefined || v === null) return '—';
  const n = Number(v);
  if (Number.isNaN(n)) return '—';
  return String(Math.round(n * 100) / 100);
}

/**
 * 返回
 *
 * ★ 第 3 期 D2（2026-10-09）：旧考试列表页 `/exam` 已下线，
 *   改成回「教学管理 → 考试管理」统一页。
 */
function goBack() {
  router.push({ path: '/teaching/exam', query: { stage: 'job' } });
}

async function loadData() {
  const id = String(route.params.id || '');
  if (!id) return;

  loading.value = true;
  try {
    summary.value = await fetchExamSummary(id);
  } catch (e) {
    console.error('加载成绩汇总失败', e);
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

.head-card {
  margin-bottom: 12px;
}

.head-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.head-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.exam-title {
  font-size: 17px;
  font-weight: 600;
}

.stat-row {
  margin-bottom: 12px;
}

.stat-card {
  text-align: center;
}

.stat-card :deep(.el-card__body) {
  padding: 16px 12px;
}

.stat-label {
  font-size: 13px;
  color: #909399;
  margin-bottom: 8px;
}

.stat-value {
  font-size: 24px;
  font-weight: 700;
  color: #303133;
}

.stat-value.blue {
  color: #409eff;
}

.stat-value.red {
  color: #f56c6c;
}

.table-card :deep(.el-card__body) {
  padding: 16px;
}

.toolbar {
  margin-bottom: 12px;
}

.toolbar-title {
  font-weight: 600;
  margin-right: 12px;
}

.toolbar-tip {
  font-size: 12px;
  color: #909399;
}

.num {
  font-weight: 600;
}

.num.strong {
  color: #409eff;
}

.num.green {
  color: #67c23a;
}

.num.red {
  color: #f56c6c;
}

.total-row {
  margin-top: 14px;
  padding: 12px 16px;
  background: #f5f7fa;
  border-radius: 4px;
  display: flex;
  gap: 28px;
  flex-wrap: wrap;
  align-items: center;
  font-size: 13px;
  color: #606266;
}

.total-label {
  font-weight: 700;
  color: #303133;
}

.total-item b {
  color: #303133;
}

.total-item b.blue {
  color: #409eff;
}

.total-item b.red {
  color: #f56c6c;
}
</style>
