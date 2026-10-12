<script setup lang="ts">
/**
 * 信息档案 - 复盘信息记录
 *
 * 脑图字段：复盘时间 / 岗位 / 时间 / 结论
 *
 * ⚠️ 这是「档案视角」的只读页 —— 数据来源是「复盘填写」模块的复盘记录。
 *    要新增或修改请去「复盘填写」页，这里只负责查阅与回放录音。
 */

import { ref, reactive, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { Search, Refresh, EditPen } from '@element-plus/icons-vue';
import { INTERVIEW_CONCLUSION_NAME, REVIEW_CONCLUSION_NAME, ReviewConclusion, InterviewConclusion } from 'shared-types';
import { fetchReviewList, fetchReviewDetail } from '@/api/review';

const router = useRouter();

const loading = ref(false);
const tableData = ref<any[]>([]);
const total = ref(0);

const query = reactive<any>({
  page: 1,
  size: 20,
  studentName: '',
  position: '',
  reviewConclusion: undefined,
  startDate: '',
  endDate: '',
});

async function loadData() {
  loading.value = true;
  try {
    const data = await fetchReviewList(query);
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
  query.position = '';
  query.reviewConclusion = undefined;
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
    detail.value = await fetchReviewDetail(row.id);
  } catch (e) {
    console.error(e);
  } finally {
    detailLoading.value = false;
  }
}

function conclusionTagType(v?: number) {
  if (v === ReviewConclusion.SIGNED) return 'success';
  if (v === ReviewConclusion.ADJUST) return 'warning';
  if (v === ReviewConclusion.IMPROVE) return 'danger';
  return 'info';
}

function interviewTagType(v?: number) {
  if (v === InterviewConclusion.OFFER) return 'success';
  if (v === InterviewConclusion.PASS) return 'primary';
  if (v === InterviewConclusion.FAIL) return 'danger';
  return 'info';
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
        <el-form-item label="岗位">
          <el-input v-model="query.position" placeholder="请输入岗位" clearable style="width: 150px" @keyup.enter="handleSearch" />
        </el-form-item>
        <el-form-item label="复盘结论">
          <el-select v-model="query.reviewConclusion" placeholder="全部" clearable style="width: 150px">
            <el-option v-for="(n, v) in REVIEW_CONCLUSION_NAME" :key="v" :label="n" :value="Number(v)" />
          </el-select>
        </el-form-item>
        <el-form-item label="复盘日期">
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
        <span class="tip">本页为档案查阅视图，数据来自「复盘填写」。如需新增或修改：</span>
        <el-button type="primary" :icon="EditPen" size="small" @click="router.push('/review-write')">
          前往复盘填写
        </el-button>
      </div>

      <el-table v-loading="loading" :data="tableData" border stripe style="width: 100%" empty-text="暂无复盘记录">
        <el-table-column type="index" label="序号" width="60" align="center" />
        <el-table-column prop="studentName" label="姓名" width="100" />
        <el-table-column prop="studentNo" label="学号" width="130" />
        <el-table-column prop="reviewTime" label="复盘时间" width="160" />
        <el-table-column prop="interviewTime" label="面试时间" width="160">
          <template #default="{ row }">{{ row.interviewTime || '—' }}</template>
        </el-table-column>
        <el-table-column prop="position" label="岗位" min-width="140">
          <template #default="{ row }">{{ row.position || '—' }}</template>
        </el-table-column>
        <el-table-column prop="salary" label="工资" width="110" align="right">
          <template #default="{ row }">
            <span v-if="row.salary">¥{{ Number(row.salary).toLocaleString() }}</span>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="面试结论" width="120" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.interviewConclusion" :type="interviewTagType(row.interviewConclusion)" size="small">
              {{ row.interviewConclusionName }}
            </el-tag>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="结论" width="130" align="center">
          <template #default="{ row }">
            <el-tag :type="conclusionTagType(row.reviewConclusion)" size="small">
              {{ row.reviewConclusionName || '未填写' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="录音" width="90" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.hasAudio" size="small" type="success" effect="plain">有</el-tag>
            <span v-else class="muted">—</span>
          </template>
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

    <!-- ============ 复盘详情 ============ -->
    <el-drawer v-model="detailVisible" title="复盘详情" size="560px">
      <div v-loading="detailLoading">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="姓名">{{ detail.studentName || '—' }}</el-descriptions-item>
          <el-descriptions-item label="学号">{{ detail.studentNo || '—' }}</el-descriptions-item>
          <el-descriptions-item label="班级">{{ detail.className || '—' }}</el-descriptions-item>
          <el-descriptions-item label="复盘时间">{{ detail.reviewTime || '—' }}</el-descriptions-item>
          <el-descriptions-item label="面试时间">{{ detail.interviewTime || '—' }}</el-descriptions-item>
          <el-descriptions-item label="岗位">{{ detail.position || '—' }}</el-descriptions-item>
          <el-descriptions-item label="工资">
            <span v-if="detail.salary">¥{{ Number(detail.salary).toLocaleString() }} / 月</span>
            <span v-else>—</span>
          </el-descriptions-item>
          <el-descriptions-item label="面试结论">
            <el-tag v-if="detail.interviewConclusion" :type="interviewTagType(detail.interviewConclusion)" size="small">
              {{ detail.interviewConclusionName }}
            </el-tag>
            <span v-else>—</span>
          </el-descriptions-item>
          <el-descriptions-item label="复盘结论" :span="2">
            <el-tag :type="conclusionTagType(detail.reviewConclusion)" size="small">
              {{ detail.reviewConclusionName || '未填写' }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="面试录音" :span="2">
            <audio v-if="detail.audioData" :src="detail.audioData" controls style="width: 100%" />
            <span v-else class="muted">未上传录音</span>
            <div v-if="detail.audioName" class="audio-name">{{ detail.audioName }}</div>
          </el-descriptions-item>
          <el-descriptions-item label="复盘详情" :span="2">
            <div class="detail-text">{{ detail.detail || '—' }}</div>
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
  color: #909399;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.tip {
  font-size: 12px;
  color: #909399;
}

.muted {
  color: #c0c4cc;
}

.detail-text {
  white-space: pre-wrap;
  line-height: 1.7;
  color: #606266;
}

.audio-name {
  margin-top: 6px;
  font-size: 12px;
  color: #909399;
}
</style>
