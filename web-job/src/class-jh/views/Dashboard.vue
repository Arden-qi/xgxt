<script setup lang="ts">
/**
 * 工作台（KPI 卡 + 待办清单）
 */

import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Refresh } from '@element-plus/icons-vue';
import type { DashboardStat } from 'shared-types/class-jh';
import { fetchDashboardStat } from '@/class-jh/api/stats';
import { formatRate } from '@/class-jh/utils/format';

const router = useRouter();
const loading = ref(false);
const stat = ref<DashboardStat | null>(null);

async function loadData() {
  loading.value = true;
  try {
    stat.value = await fetchDashboardStat();
  } catch {
    /* 错误已统一处理 */
  } finally {
    loading.value = false;
  }
}

function goTodo(path?: string) {
  if (!path) {
    ElMessage.info('该待办暂未配置跳转');
    return;
  }
  router.push(path);
}

onMounted(loadData);
</script>

<template>
  <div class="page-container">
    <div class="toolbar">
      <span class="page-title">教学管理工作台</span>
      <el-button :icon="Refresh" @click="loadData">刷新</el-button>
    </div>

    <div v-loading="loading">
      <div class="kpi-row">
        <el-card shadow="hover" class="kpi-card">
          <div class="kpi-label">在读学生数</div>
          <div class="kpi-value">{{ stat?.readingStudentCount ?? 0 }}</div>
          <div class="kpi-sub">试学 / 预在读 / 正式在读</div>
        </el-card>

        <el-card shadow="hover" class="kpi-card">
          <div class="kpi-label">今日出勤率</div>
          <div class="kpi-value">
            {{ stat ? formatRate(stat.todayAttendanceRate) : '—' }}
          </div>
          <div class="kpi-sub">
            目标 {{ stat ? formatRate(stat.attendanceTargetRate) : '—' }}
          </div>
        </el-card>

        <el-card shadow="hover" class="kpi-card">
          <div class="kpi-label">紧急催费</div>
          <div class="kpi-value danger">{{ stat?.urgentFeeCount ?? 0 }}</div>
          <div class="kpi-sub">临近应缴日期</div>
        </el-card>

        <el-card shadow="hover" class="kpi-card">
          <div class="kpi-label">待办总数</div>
          <div class="kpi-value warning">{{ stat?.pendingTodoCount ?? 0 }}</div>
          <div class="kpi-sub">待审批流程 / 退费 / 调宿</div>
        </el-card>
      </div>

      <el-card shadow="never" class="todo-card">
        <template #header>
          <span>待办清单</span>
        </template>
        <div v-if="stat?.todos?.length" class="todo-list">
          <div v-for="todo in stat.todos" :key="todo.type" class="todo-item" @click="goTodo(todo.path)">
            <span class="todo-title">{{ todo.title }}</span>
            <el-tag :type="todo.count > 0 ? 'danger' : 'info'" size="small">{{ todo.count }}</el-tag>
          </div>
        </div>
        <el-empty v-else description="暂无待办" :image-size="80" />
      </el-card>
    </div>
  </div>
</template>

<style scoped>
.page-container {
  padding: 16px;
}
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.page-title {
  font-size: 18px;
  font-weight: 600;
  color: #303133;
}
.kpi-row {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}
.kpi-card {
  flex: 1;
  min-width: 180px;
  text-align: center;
}
.kpi-label {
  color: #909399;
  font-size: 14px;
  margin-bottom: 10px;
}
.kpi-value {
  font-size: 30px;
  font-weight: 600;
  color: #409eff;
}
.kpi-value.danger {
  color: #f56c6c;
}
.kpi-value.warning {
  color: #e6a23c;
}
.kpi-sub {
  margin-top: 8px;
  color: #c0c4cc;
  font-size: 12px;
}
.todo-card {
  min-height: 200px;
}
.todo-list {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.todo-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 18px;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}
.todo-item:hover {
  border-color: #409eff;
  background: #ecf5ff;
}
.todo-title {
  font-size: 14px;
  color: #303133;
}
</style>
