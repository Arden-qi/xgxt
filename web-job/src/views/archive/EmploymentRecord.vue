<script setup lang="ts">
/**
 * 信息档案 - 就业日志记录
 *
 * 脑图字段：有效投递简历数 / 面试邀约 / 岗位 / 薪资
 *
 * ⚠️ 同样属于档案查阅视图，数据来自「就业日志」模块，只读。
 */

import { ref, reactive, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { Search, Refresh, EditPen } from '@element-plus/icons-vue';
import { fetchLogList, fetchLogDetail } from '@/api/employmentLog';

const router = useRouter();

const loading = ref(false);
const tableData = ref<any[]>([]);
const total = ref(0);

const query = reactive<any>({
  page: 1,
  size: 20,
  studentName: '',
  company: '',
  startDate: '',
  endDate: '',
});

async function loadData() {
  loading.value = true;
  try {
    const data = await fetchLogList(query);
    tableData.value = data.list;
    total.value = data.total;
  } catch (e) {
    console.error(e);
  } finally {
    loading.value = false;
  }
}

function handleSearch() {
  query.page = 1;
  loadData();
}

function handleReset() {
  query.page = 1;
  query.studentName = '';
  query.company = '';
  query.startDate = '';
  query.endDate = '';
  loadData();
}

/* ============ 详情 ============ */

const detailVisible = ref(false);
const detailLoading = ref(false);
const detail = ref<any>({});

async function handleDetail(row: any) {
  detailVisible.value = true;
  detailLoading.value = true;
  detail.value = {};
  try {
    detail.value = await fetchLogDetail(row.id);
  } catch (e) {
    console.error(e);
  } finally {
    detailLoading.value = false;
  }
}

function money(v?: number) {
  return v ? `¥${Number(v).toLocaleString()}` : '—';
}

onMounted(loadData);
</script>

<template>
  <div class="page-container">
    <el-card shadow="never" class="search-card">
      <el-form :model="query" inline>
        <el-form-item label="姓名">
          <el-input v-model="query.studentName" placeholder="请输入姓名" clearable style="width: 150px" @keyup.enter="handleSearch" />
        </el-form-item>
        <el-form-item label="面试公司">
          <el-input v-model="query.company" placeholder="请输入公司名称" clearable style="width: 170px" @keyup.enter="handleSearch" />
        </el-form-item>
        <el-form-item label="日志日期">
          <el-date-picker
            v-model="query.startDate"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="开始"
            style="width: 150px"
          />
          <span class="range-split">~</span>
          <el-date-picker
            v-model="query.endDate"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="结束"
            style="width: 150px"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :icon="Search" @click="handleSearch">查询</el-button>
          <el-button :icon="Refresh" @click="handleReset">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never" class="table-card">
      <div class="toolbar">
        <span class="tip">本页为档案查阅视图，数据来自「就业日志」。如需新增或修改：</span>
        <el-button type="primary" :icon="EditPen" size="small" @click="router.push('/employment-log')">
          前往就业日志
        </el-button>
      </div>

      <el-table v-loading="loading" :data="tableData" border stripe style="width: 100%" empty-text="暂无就业日志记录">
        <el-table-column type="index" label="序号" width="60" align="center" />
        <el-table-column prop="studentName" label="姓名" width="100" />
        <el-table-column prop="studentNo" label="学号" width="130" />
        <el-table-column prop="logDate" label="日志日期" width="120" />
        <el-table-column prop="resumeCount" label="有效投递简历数" width="130" align="center">
          <template #default="{ row }">
            <span class="strong">{{ row.resumeCount }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="interviewInvite" label="面试邀约" width="100" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.interviewInvite > 0" size="small" type="warning" effect="plain">
              {{ row.interviewInvite }}
            </el-tag>
            <span v-else class="muted">0</span>
          </template>
        </el-table-column>
        <el-table-column prop="interviewCount" label="面试场次" width="100" align="center" />
        <el-table-column prop="position" label="岗位" min-width="130">
          <template #default="{ row }">{{ row.position || '—' }}</template>
        </el-table-column>
        <el-table-column label="薪资" width="120" align="right">
          <template #default="{ row }">{{ money(row.salary) }}</template>
        </el-table-column>
        <el-table-column prop="company" label="面试公司" min-width="150">
          <template #default="{ row }">{{ row.company || '—' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="90" fixed="right" align="center">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="handleDetail(row)">详情</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        v-model:current-page="query.page"
        v-model:page-size="query.size"
        :page-sizes="[10, 20, 50, 100]"
        :total="total"
        layout="total, sizes, prev, pager, next, jumper"
        style="margin-top: 16px; justify-content: flex-end"
        @size-change="loadData"
        @current-change="loadData"
      />
    </el-card>

    <!-- ============ 日志详情 ============ -->
    <el-drawer v-model="detailVisible" title="就业日志详情" size="560px">
      <div v-loading="detailLoading">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="姓名">{{ detail.studentName || '—' }}</el-descriptions-item>
          <el-descriptions-item label="学号">{{ detail.studentNo || '—' }}</el-descriptions-item>
          <el-descriptions-item label="班级">{{ detail.className || '—' }}</el-descriptions-item>
          <el-descriptions-item label="日志日期">{{ detail.logDate || '—' }}</el-descriptions-item>
          <el-descriptions-item label="有效投递简历数">{{ detail.resumeCount ?? '—' }}</el-descriptions-item>
          <el-descriptions-item label="面试邀约">{{ detail.interviewInvite ?? '—' }}</el-descriptions-item>
          <el-descriptions-item label="面试场次">{{ detail.interviewCount ?? '—' }}</el-descriptions-item>
          <el-descriptions-item label="面试时间">{{ detail.interviewTime || '—' }}</el-descriptions-item>
          <el-descriptions-item label="面试公司">{{ detail.company || '—' }}</el-descriptions-item>
          <el-descriptions-item label="岗位">{{ detail.position || '—' }}</el-descriptions-item>
          <el-descriptions-item label="薪资">{{ money(detail.salary) }}</el-descriptions-item>
          <el-descriptions-item label="面试情况" :span="2">
            <div class="detail-text">{{ detail.interviewSituation || '—' }}</div>
          </el-descriptions-item>
        </el-descriptions>
      </div>
    </el-drawer>
  </div>
</template>

<style scoped>
.page-container {
  padding: 16px;
}

.search-card {
  margin-bottom: 12px;
}

.search-card :deep(.el-form-item) {
  margin-bottom: 0;
}

.range-split {
  margin: 0 6px;
  color: #A2938E;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.tip {
  font-size: 12px;
  color: #A2938E;
}

.muted {
  color: #C4B8B2;
}

.strong {
  font-weight: 600;
  color: #CD3A33;
}

.detail-text {
  white-space: pre-wrap;
  line-height: 1.7;
  color: #7A6C67;
}
</style>
