<script setup lang="ts">
/**
 * 催费管理页（缴费台账 / 催费推送 / 催费记录 / 导出）
 */

import { ref, reactive, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { Search, Refresh, Download, Bell, Promotion } from '@element-plus/icons-vue';
import { FEE_TYPE_NAME, PAY_STATUS_NAME, SHARE_CHANNEL_NAME, ShareChannel } from 'shared-types/class-jh';
import type { FeeRecord, FeeListQuery, FeeNotify, FeeNotifyListQuery, ClassInfo } from 'shared-types/class-jh';
import { fetchFeeList, fetchFeeNotifyList, exportFee, shareFee } from '@/class-jh/api/fee';
import { fetchClassOptions } from '@/class-jh/api/classInfo';
import { exportCsv } from '@/class-jh/utils/exportCsv';
import { dash, formatAmount, formatDate, payStatusTagType } from '@/class-jh/utils/format';

const loading = ref(false);
const tableData = ref<FeeRecord[]>([]);
const total = ref(0);
const classOptions = ref<ClassInfo[]>([]);

const query = reactive<FeeListQuery & { page: number; size: number }>({
  page: 1,
  size: 20,
  classId: undefined,
  feeType: undefined,
  payStatus: undefined,
  isUrgent: undefined,
  keyword: undefined,
  startDate: undefined,
  endDate: undefined,
});

async function loadData() {
  loading.value = true;
  try {
    const data = await fetchFeeList(query);
    tableData.value = data.list;
    total.value = data.total;
  } catch {
    /* 错误已统一处理 */
  } finally {
    loading.value = false;
  }
}

async function loadClassOptions() {
  try {
    classOptions.value = await fetchClassOptions({ excludeGraduated: false });
  } catch {
    /* 错误已统一处理 */
  }
}

function handleSearch() {
  query.page = 1;
  loadData();
}

function handleReset() {
  query.page = 1;
  query.size = 20;
  query.classId = undefined;
  query.feeType = undefined;
  query.payStatus = undefined;
  query.isUrgent = undefined;
  query.keyword = undefined;
  query.startDate = undefined;
  query.endDate = undefined;
  loadData();
}

/* ============ 催费推送 ============ */
const shareVisible = ref(false);
const shareSubmitting = ref(false);
const shareRow = ref<FeeRecord | null>(null);
const shareText = ref('');
const shareResultVisible = ref(false);
const shareForm = reactive({
  shareChannel: ShareChannel.WECHAT,
  remark: '',
});

function handleShare(row: FeeRecord) {
  shareRow.value = row;
  shareForm.shareChannel = ShareChannel.WECHAT;
  shareForm.remark = '';
  shareText.value = '';
  shareVisible.value = true;
}

async function submitShare() {
  if (!shareRow.value) return;
  shareSubmitting.value = true;
  try {
    const res = await shareFee({
      studentId: shareRow.value.studentId,
      feeType: shareRow.value.feeType,
      shareChannel: shareForm.shareChannel,
      remark: shareForm.remark || undefined,
    });
    shareText.value = res.shareText;
    shareVisible.value = false;
    shareResultVisible.value = true;
    loadData();
  } catch {
    /* 错误已统一处理 */
  } finally {
    shareSubmitting.value = false;
  }
}

async function copyShareText() {
  try {
    await navigator.clipboard.writeText(shareText.value);
    ElMessage.success('已复制催费文案');
  } catch {
    ElMessage.warning('复制失败，请手动选择文本复制');
  }
}

/* ============ 催费记录 ============ */
const notifyVisible = ref(false);
const notifyLoading = ref(false);
const notifyData = ref<FeeNotify[]>([]);
const notifyTotal = ref(0);
const notifyQuery = reactive<FeeNotifyListQuery & { page: number; size: number }>({
  page: 1,
  size: 10,
  studentId: undefined,
});

async function loadNotify() {
  notifyLoading.value = true;
  try {
    const data = await fetchFeeNotifyList(notifyQuery);
    notifyData.value = data.list;
    notifyTotal.value = data.total;
  } catch {
    /* 错误已统一处理 */
  } finally {
    notifyLoading.value = false;
  }
}

function openNotify(studentId?: string) {
  notifyQuery.page = 1;
  notifyQuery.studentId = studentId;
  notifyVisible.value = true;
  loadNotify();
}

/* ============ 导出 ============ */
async function handleExport() {
  try {
    const list = await exportFee(query);
    exportCsv(
      '催费台账',
      ['学号', '姓名', '班级', '缴费类型', '应缴金额', '缴费状态', '应缴日期', '剩余天数', '是否紧急'],
      list.map((r) => [
        r.studentNo,
        r.studentName,
        r.className,
        r.feeTypeName,
        formatAmount(r.feeAmount),
        r.payStatusName,
        formatDate(r.expireDate),
        r.remainDays ?? '',
        r.isUrgent ? '是' : '否',
      ]),
    );
    ElMessage.success('导出成功');
  } catch {
    /* 错误已统一处理 */
  }
}

onMounted(() => {
  loadClassOptions();
  loadData();
});
</script>

<template>
  <div class="page-container">
    <el-card shadow="never" class="search-card">
      <!-- ★ 2026-10-19：筛选全部「选完即查」（@change → handleSearch），不用再点查询；选完不动，用户视角就是筛选没生效 -->
      <el-form :model="query" inline>
        <el-form-item label="关键字">
          <el-input v-model="query.keyword" placeholder="学号/姓名" clearable style="width: 150px" @keyup.enter="handleSearch" @clear="handleSearch" />
        </el-form-item>
        <el-form-item label="班级">
          <el-select v-model="query.classId" placeholder="全部" clearable style="width: 150px" @change="handleSearch">
            <el-option v-for="c in classOptions" :key="c.classId" :label="c.className" :value="c.classId" />
          </el-select>
        </el-form-item>
        <el-form-item label="缴费类型">
          <el-select v-model="query.feeType" placeholder="全部" clearable style="width: 130px" @change="handleSearch">
            <el-option v-for="(name, value) in FEE_TYPE_NAME" :key="value" :label="name" :value="Number(value)" />
          </el-select>
        </el-form-item>
        <el-form-item label="缴费状态">
          <el-select v-model="query.payStatus" placeholder="全部" clearable style="width: 120px" @change="handleSearch">
            <el-option v-for="(name, value) in PAY_STATUS_NAME" :key="value" :label="name" :value="Number(value)" />
          </el-select>
        </el-form-item>
        <el-form-item label="仅看紧急">
          <el-switch v-model="query.isUrgent" @change="handleSearch" />
        </el-form-item>
        <el-form-item label="应缴日期">
          <el-date-picker v-model="query.startDate" type="date" value-format="YYYY-MM-DD" placeholder="开始" style="width: 140px" @change="handleSearch" />
          <span class="sep">~</span>
          <el-date-picker v-model="query.endDate" type="date" value-format="YYYY-MM-DD" placeholder="结束" style="width: 140px" @change="handleSearch" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :icon="Search" @click="handleSearch">查询</el-button>
          <el-button :icon="Refresh" @click="handleReset">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never" class="table-card">
      <div class="toolbar">
        <el-button :icon="Bell" @click="openNotify()">催费记录</el-button>
        <el-button :icon="Download" @click="handleExport">导出</el-button>
      </div>

      <el-table v-loading="loading" :data="tableData" border stripe style="width: 100%" empty-text="暂无数据">
        <el-table-column type="index" label="序号" width="60" align="center" />
        <el-table-column prop="studentNo" label="学号" width="120" />
        <el-table-column prop="studentName" label="姓名" width="90" />
        <el-table-column label="班级" width="110">
          <template #default="{ row }">{{ dash(row.className) }}</template>
        </el-table-column>
        <el-table-column prop="feeTypeName" label="缴费类型" width="100" />
        <el-table-column label="应缴金额" width="120" align="right">
          <template #default="{ row }">{{ formatAmount(row.feeAmount) }}</template>
        </el-table-column>
        <el-table-column label="缴费状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="payStatusTagType(row.payStatus)" size="small">{{ row.payStatusName }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="应缴日期" width="120">
          <template #default="{ row }">{{ formatDate(row.expireDate) }}</template>
        </el-table-column>
        <el-table-column label="剩余天数" width="100" align="center">
          <template #default="{ row }">{{ dash(row.remainDays) }}</template>
        </el-table-column>
        <el-table-column label="紧急" width="80" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.isUrgent" type="danger" size="small">紧急</el-tag>
            <span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="140" align="center" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" :icon="Promotion" @click="handleShare(row)">催费推送</el-button>
            <el-button link type="info" size="small" @click="openNotify(row.studentId)">记录</el-button>
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

    <!-- 催费推送 -->
    <el-dialog v-model="shareVisible" title="催费推送" width="480px">
      <el-form :model="shareForm" label-width="100px">
        <el-form-item label="学生">
          <el-input :model-value="shareRow ? `${shareRow.studentNo} ${shareRow.studentName}` : ''" disabled />
        </el-form-item>
        <el-form-item label="缴费类型">
          <el-input :model-value="shareRow?.feeTypeName" disabled />
        </el-form-item>
        <el-form-item label="触达渠道">
          <el-select v-model="shareForm.shareChannel" style="width: 100%">
            <el-option v-for="(name, value) in SHARE_CHANNEL_NAME" :key="value" :label="name" :value="Number(value)" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="shareForm.remark" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="shareVisible = false">取消</el-button>
        <el-button type="primary" :loading="shareSubmitting" @click="submitShare">生成文案</el-button>
      </template>
    </el-dialog>

    <!-- 催费文案 -->
    <el-dialog v-model="shareResultVisible" title="催费文案" width="480px">
      <el-input v-model="shareText" type="textarea" :rows="6" readonly />
      <template #footer>
        <el-button @click="shareResultVisible = false">关闭</el-button>
        <el-button type="primary" @click="copyShareText">复制文案</el-button>
      </template>
    </el-dialog>

    <!-- 催费记录 -->
    <el-dialog v-model="notifyVisible" title="催费记录" width="720px">
      <el-table v-loading="notifyLoading" :data="notifyData" border stripe size="small" empty-text="暂无催费记录">
        <el-table-column type="index" label="序号" width="60" align="center" />
        <el-table-column prop="studentNo" label="学号" width="120" />
        <el-table-column prop="studentName" label="姓名" width="90" />
        <el-table-column prop="feeTypeName" label="缴费类型" width="100" />
        <el-table-column label="金额" width="110" align="right">
          <template #default="{ row }">{{ formatAmount(row.feeAmount) }}</template>
        </el-table-column>
        <el-table-column prop="shareChannelName" label="渠道" width="90" />
        <el-table-column label="催费时间" width="170">
          <template #default="{ row }">{{ row.notifyTime }}</template>
        </el-table-column>
        <el-table-column label="操作人">
          <template #default="{ row }">{{ dash(row.notifyUserName) }}</template>
        </el-table-column>
      </el-table>
      <el-pagination
        v-model:current-page="notifyQuery.page"
        v-model:page-size="notifyQuery.size"
        :total="notifyTotal"
        layout="total, prev, pager, next"
        style="margin-top: 12px; justify-content: flex-end"
        @current-change="loadNotify"
      />
    </el-dialog>
  </div>
</template>

<style scoped>
.page-container {
  padding: 16px;
}
.sep {
  margin: 0 6px;
}
.search-card {
  margin-bottom: 12px;
}
.search-card :deep(.el-form-item) {
  margin-bottom: 8px;
  margin-top: 8px;
}
.toolbar {
  margin-bottom: 12px;
}
.table-card :deep(.el-card__body) {
  padding: 16px;
}
</style>
