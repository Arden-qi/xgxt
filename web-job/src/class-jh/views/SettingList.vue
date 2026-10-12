<script setup lang="ts">
/**
 * 系统设置页
 *
 * 三个页签：系统设置（KV）/ 阶段字典 / 操作日志。
 */

import { ref, reactive, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus, Delete, Search, Refresh, SetUp } from '@element-plus/icons-vue';
import { DEPT_NAME } from 'shared-types/class-jh';
import type { ClassSetting, StageDict, OpLog, OpLogListQuery, StageSavePayload } from 'shared-types/class-jh';
import {
  fetchSettingDetail,
  updateSetting,
  fetchStageList,
  addStage,
  deleteStage,
  fetchOpLogList,
} from '@/class-jh/api/setting';
import { dash, formatDateTime } from '@/class-jh/utils/format';

const activeTab = ref('setting');

/* ================= 系统设置 ================= */
const settingLoading = ref(false);
const settingList = ref<ClassSetting[]>([]);
const settingSaving = ref(false);
/** 表单值（字符串归一化，保存时再转换类型） */
const settingValues = reactive<Record<string, string>>({});

/** 数字型设置键 */
const NUMBER_KEYS = ['attendanceTargetRate', 'feeRemindDays', 'refundThresholdAmount', 'closedClassIntakeTypes'];
/** 布尔型设置键 */
const BOOLEAN_KEYS = ['allowStudentAdd'];

async function loadSettings() {
  settingLoading.value = true;
  try {
    const list = await fetchSettingDetail();
    settingList.value = list;
    list.forEach((s) => {
      settingValues[s.settingKey] = s.settingValue ?? '';
    });
  } catch {
    /* 错误已统一处理 */
  } finally {
    settingLoading.value = false;
  }
}

function isNumberKey(key: string): boolean {
  return NUMBER_KEYS.includes(key);
}
function isBooleanKey(key: string): boolean {
  return BOOLEAN_KEYS.includes(key);
}

async function saveSettings() {
  settingSaving.value = true;
  try {
    const payload: Record<string, string | number | boolean> = {};
    settingList.value.forEach((s) => {
      const raw = settingValues[s.settingKey] ?? '';
      if (isBooleanKey(s.settingKey)) {
        payload[s.settingKey] = raw === 'true' || raw === '1';
      } else if (isNumberKey(s.settingKey)) {
        payload[s.settingKey] = Number(raw) || 0;
      } else {
        payload[s.settingKey] = String(raw);
      }
    });
    await updateSetting(payload);
    ElMessage.success('保存成功');
    loadSettings();
  } catch {
    /* 错误已统一处理 */
  } finally {
    settingSaving.value = false;
  }
}

/* ================= 阶段字典 ================= */
const stageLoading = ref(false);
const stageData = ref<StageDict[]>([]);

async function loadStage() {
  stageLoading.value = true;
  try {
    stageData.value = await fetchStageList();
  } catch {
    /* 错误已统一处理 */
  } finally {
    stageLoading.value = false;
  }
}

const stageVisible = ref(false);
const stageSubmitting = ref(false);
const stageForm = reactive<StageSavePayload>({
  stageCode: 101,
  stageName: '',
  deptCode: 1,
  studyMonths: undefined,
  sortNo: 0,
});

function openStageDialog() {
  Object.assign(stageForm, { stageCode: 101, stageName: '', deptCode: 1, studyMonths: undefined, sortNo: 0 });
  stageVisible.value = true;
}

async function submitStage() {
  if (!stageForm.stageName || !stageForm.stageCode || !stageForm.deptCode) {
    ElMessage.warning('请填写阶段编码、名称与所属部门');
    return;
  }
  stageSubmitting.value = true;
  try {
    await addStage({ ...stageForm });
    ElMessage.success('新增成功');
    stageVisible.value = false;
    loadStage();
  } catch {
    /* 错误已统一处理 */
  } finally {
    stageSubmitting.value = false;
  }
}

async function handleDeleteStage(row: StageDict) {
  try {
    await ElMessageBox.confirm(`确定删除阶段「${row.stageName}」吗？（仍有学生的阶段不可删）`, '删除确认', {
      type: 'warning',
      confirmButtonText: '确定删除',
      cancelButtonText: '取消',
    });
  } catch {
    return;
  }
  try {
    await deleteStage(row.id);
    ElMessage.success('删除成功');
    loadStage();
  } catch {
    /* 错误已统一处理 */
  }
}

/* ================= 操作日志 ================= */
const opLogLoading = ref(false);
const opLogData = ref<OpLog[]>([]);
const opLogTotal = ref(0);
const opLogQuery = reactive<OpLogListQuery & { page: number; size: number }>({
  page: 1,
  size: 20,
  bizType: undefined,
  startDate: undefined,
  endDate: undefined,
});

async function loadOpLog() {
  opLogLoading.value = true;
  try {
    const data = await fetchOpLogList(opLogQuery);
    opLogData.value = data.list;
    opLogTotal.value = data.total;
  } catch {
    /* 错误已统一处理 */
  } finally {
    opLogLoading.value = false;
  }
}

function resetOpLogQuery() {
  opLogQuery.page = 1;
  opLogQuery.size = 20;
  opLogQuery.bizType = undefined;
  opLogQuery.startDate = undefined;
  opLogQuery.endDate = undefined;
  loadOpLog();
}

onMounted(() => {
  loadSettings();
  loadStage();
  loadOpLog();
});
</script>

<template>
  <div class="page-container">
    <el-tabs v-model="activeTab" type="border-card">
      <!-- 系统设置 -->
      <el-tab-pane label="系统设置" name="setting">
        <div v-loading="settingLoading" class="setting-wrap">
          <el-form label-width="180px" class="setting-form">
            <el-form-item v-for="s in settingList" :key="s.settingKey" :label="s.settingName || s.settingKey">
              <el-switch
                v-if="isBooleanKey(s.settingKey)"
                :model-value="settingValues[s.settingKey] === 'true' || settingValues[s.settingKey] === '1'"
                @update:model-value="(v: string | number | boolean) => (settingValues[s.settingKey] = String(v))"
              />
              <el-input-number
                v-else-if="isNumberKey(s.settingKey)"
                :model-value="Number(settingValues[s.settingKey]) || 0"
                :min="0"
                style="width: 220px"
                @update:model-value="(v: number | undefined) => (settingValues[s.settingKey] = String(v ?? 0))"
              />
              <el-input v-else v-model="settingValues[s.settingKey]" style="width: 320px" />
              <el-text v-if="s.remark" type="info" size="small" class="ml12">{{ s.remark }}</el-text>
            </el-form-item>
          </el-form>
          <el-button v-readonly-hide type="primary" :icon="SetUp" :loading="settingSaving" @click="saveSettings">保存设置</el-button>
        </div>
      </el-tab-pane>

      <!-- 阶段字典 -->
      <el-tab-pane label="阶段字典" name="stage">
        <div class="toolbar">
          <el-button v-readonly-hide type="primary" :icon="Plus" @click="openStageDialog">新增阶段</el-button>
        </div>
        <el-table v-loading="stageLoading" :data="stageData" border stripe empty-text="暂无阶段">
          <el-table-column type="index" label="序号" width="60" align="center" />
          <el-table-column prop="stageCode" label="阶段编码" width="110" align="center" />
          <el-table-column prop="stageName" label="阶段名称" width="160" />
          <el-table-column label="所属部门" width="120">
            <template #default="{ row }">{{ DEPT_NAME[row.deptCode] || dash(row.deptCode) }}</template>
          </el-table-column>
          <el-table-column prop="studyMonths" label="学制(月)" width="100" align="center" />
          <el-table-column prop="sortNo" label="排序" width="90" align="center" />
          <el-table-column label="操作" width="100" align="center" fixed="right">
            <template #default="{ row }">
              <el-button v-readonly-hide link type="danger" size="small" :icon="Delete" @click="handleDeleteStage(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- 操作日志 -->
      <el-tab-pane label="操作日志" name="opLog">
        <el-form :model="opLogQuery" inline class="mb12">
          <el-form-item label="业务类型">
            <el-input v-model="opLogQuery.bizType" placeholder="如 休学/退费" clearable style="width: 150px" @keyup.enter="loadOpLog" />
          </el-form-item>
          <el-form-item label="操作时间">
            <el-date-picker v-model="opLogQuery.startDate" type="date" value-format="YYYY-MM-DD" placeholder="开始" style="width: 140px" />
            <span class="sep">~</span>
            <el-date-picker v-model="opLogQuery.endDate" type="date" value-format="YYYY-MM-DD" placeholder="结束" style="width: 140px" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :icon="Search" @click="loadOpLog">查询</el-button>
            <el-button :icon="Refresh" @click="resetOpLogQuery">重置</el-button>
          </el-form-item>
        </el-form>

        <el-table v-loading="opLogLoading" :data="opLogData" border stripe size="small" empty-text="暂无日志">
          <el-table-column type="index" label="序号" width="60" align="center" />
          <el-table-column label="操作时间" width="170">
            <template #default="{ row }">{{ formatDateTime(row.opTime) }}</template>
          </el-table-column>
          <el-table-column prop="module" label="模块" width="100">
            <template #default="{ row }">{{ dash(row.module) }}</template>
          </el-table-column>
          <el-table-column prop="bizType" label="业务类型" width="110" />
          <el-table-column label="操作人" width="110">
            <template #default="{ row }">{{ dash(row.opUserName) }}</template>
          </el-table-column>
          <el-table-column prop="opDesc" label="操作描述" min-width="240" show-overflow-tooltip />
        </el-table>

        <el-pagination
          v-model:current-page="opLogQuery.page"
          v-model:page-size="opLogQuery.size"
          :page-sizes="[10, 20, 50, 100]"
          :total="opLogTotal"
          layout="total, sizes, prev, pager, next"
          style="margin-top: 16px; justify-content: flex-end"
          @size-change="loadOpLog"
          @current-change="loadOpLog"
        />
      </el-tab-pane>
    </el-tabs>

    <!-- 新增阶段 -->
    <el-dialog v-model="stageVisible" title="新增阶段" width="480px">
      <el-form :model="stageForm" label-width="100px">
        <el-form-item label="阶段编码" required>
          <el-input-number v-model="stageForm.stageCode" :min="1" style="width: 100%" />
        </el-form-item>
        <el-form-item label="阶段名称" required>
          <el-input v-model="stageForm.stageName" placeholder="如 初中部1期" />
        </el-form-item>
        <el-form-item label="所属部门" required>
          <el-select v-model="stageForm.deptCode" style="width: 100%">
            <el-option v-for="(name, value) in DEPT_NAME" :key="value" :label="name" :value="Number(value)" />
          </el-select>
        </el-form-item>
        <el-form-item label="学制(月)">
          <el-input-number v-model="stageForm.studyMonths" :min="0" style="width: 100%" />
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="stageForm.sortNo" :min="0" style="width: 100%" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="stageVisible = false">取消</el-button>
        <el-button v-readonly-hide type="primary" :loading="stageSubmitting" @click="submitStage">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page-container {
  padding: 16px;
}
.setting-wrap {
  padding: 8px 0;
}
.setting-form {
  max-width: 720px;
}
.ml12 {
  margin-left: 12px;
}
.mb12 {
  margin-bottom: 12px;
}
.sep {
  margin: 0 6px;
}
.toolbar {
  margin-bottom: 12px;
}
</style>
