<script setup lang="ts">
/**
 * 系统设置页
 *
 * 三个页签：系统设置（KV）/ 阶段方案 / 操作日志。
 *
 * ★ 2026-10-16 改版：原「阶段字典」（一行 = 一个阶段）改成「阶段方案」——
 *    一个方案可包含多个阶段（阶段名称 + 学制月数），列表只展示 序号/方案名称/所属部门/操作。
 */

import { ref, reactive, computed, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus, Delete, Edit, Search, Refresh, SetUp } from '@element-plus/icons-vue';
import { DEPT_NAME } from 'shared-types/class-jh';
import type { ClassSetting, StagePlan, OpLog, OpLogListQuery } from 'shared-types/class-jh';
import {
  fetchSettingDetail,
  updateSetting,
  fetchStagePlanList,
  addStagePlan,
  updateStagePlan,
  deleteStagePlan,
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

/* ================= 阶段方案 ================= */
const planLoading = ref(false);
const planData = ref<StagePlan[]>([]);

/** 方案弹窗里的一行阶段明细 */
interface PhaseRow {
  id?: string;
  stageName: string;
  studyMonths?: number;
}

const planVisible = ref(false);
const planSubmitting = ref(false);
const planEditingId = ref('');
const planTitle = computed(() => (planEditingId.value ? '编辑方案' : '新增方案'));

const planForm = reactive<{ planName: string; deptCode: number; phases: PhaseRow[] }>({
  planName: '',
  deptCode: 1,
  phases: [{ stageName: '', studyMonths: undefined }],
});

async function loadPlans() {
  planLoading.value = true;
  try {
    planData.value = await fetchStagePlanList();
  } catch {
    /* 错误已统一处理 */
  } finally {
    planLoading.value = false;
  }
}

function openPlanDialog(row?: StagePlan) {
  planEditingId.value = row?.id || '';
  planForm.planName = row?.planName || '';
  planForm.deptCode = row?.deptCode ?? 1;
  planForm.phases = row?.phases?.length
    ? row.phases.map((p) => ({ id: p.id, stageName: p.stageName, studyMonths: p.studyMonths ?? undefined }))
    : [{ stageName: '', studyMonths: undefined }];
  planVisible.value = true;
}

function addPhaseRow() {
  planForm.phases.push({ stageName: '', studyMonths: undefined });
}

function removePhaseRow(idx: number) {
  planForm.phases.splice(idx, 1);
}

async function submitPlan() {
  if (!planForm.planName.trim()) {
    ElMessage.warning('请输入方案名称');
    return;
  }
  if (!planForm.phases.length) {
    ElMessage.warning('请至少添加一个阶段');
    return;
  }
  if (planForm.phases.some((p) => !p.stageName.trim())) {
    ElMessage.warning('请填写全部阶段名称');
    return;
  }
  planSubmitting.value = true;
  try {
    const payload = {
      planName: planForm.planName.trim(),
      deptCode: planForm.deptCode,
      phases: planForm.phases.map((p) => ({
        id: p.id,
        stageName: p.stageName.trim(),
        studyMonths: p.studyMonths,
      })),
    };
    if (planEditingId.value) {
      await updateStagePlan({ ...payload, id: planEditingId.value });
      ElMessage.success('保存成功');
    } else {
      await addStagePlan(payload);
      ElMessage.success('新增成功');
    }
    planVisible.value = false;
    loadPlans();
  } catch {
    /* 错误已统一处理 */
  } finally {
    planSubmitting.value = false;
  }
}

async function handleDeletePlan(row: StagePlan) {
  try {
    await ElMessageBox.confirm(`确定删除方案「${row.planName}」吗？（方案下已有班级/学生使用的阶段不可删）`, '删除确认', {
      type: 'warning',
      confirmButtonText: '确定删除',
      cancelButtonText: '取消',
    });
  } catch {
    return;
  }
  try {
    await deleteStagePlan(row.id);
    ElMessage.success('删除成功');
    loadPlans();
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
  loadPlans();
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

      <!-- 阶段方案 -->
      <el-tab-pane label="阶段方案" name="stage">
        <div class="toolbar">
          <el-button v-readonly-hide type="primary" :icon="Plus" @click="openPlanDialog()">新增方案</el-button>
        </div>
        <el-table v-loading="planLoading" :data="planData" border stripe empty-text="暂无方案">
          <el-table-column type="index" label="序号" width="60" align="center" />
          <el-table-column prop="planName" label="方案名称" min-width="220" />
          <el-table-column label="所属部门" width="140">
            <template #default="{ row }">{{ row.deptName || DEPT_NAME[row.deptCode] || dash(row.deptCode) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="170" align="center" fixed="right">
            <template #default="{ row }">
              <el-button v-readonly-hide link type="primary" size="small" :icon="Edit" @click="openPlanDialog(row)">编辑</el-button>
              <el-button v-readonly-hide link type="danger" size="small" :icon="Delete" @click="handleDeletePlan(row)">删除</el-button>
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

    <!-- 新增 / 编辑方案 -->
    <el-dialog v-model="planVisible" :title="planTitle" width="720px">
      <el-form :model="planForm" label-width="90px">
        <el-form-item label="方案名称" required>
          <el-input v-model="planForm.planName" placeholder="如 方案一" />
        </el-form-item>
        <el-form-item label="所属部门" required>
          <el-select v-model="planForm.deptCode" style="width: 100%">
            <el-option v-for="(name, value) in DEPT_NAME" :key="value" :label="name" :value="Number(value)" />
          </el-select>
        </el-form-item>
        <el-form-item label="阶段明细" required>
          <div class="phase-wrap">
            <div v-for="(p, idx) in planForm.phases" :key="idx" class="phase-row">
              <span class="phase-idx">{{ idx + 1 }}</span>
              <el-input v-model="p.stageName" placeholder="阶段名称，如 一阶段" class="phase-name" />
              <el-input-number v-model="p.studyMonths" :min="0" class="phase-month" controls-position="right" />
              <span class="phase-unit">月</span>
              <el-button link type="danger" :icon="Delete" @click="removePhaseRow(idx)">删除</el-button>
            </div>
            <el-button link type="primary" :icon="Plus" class="phase-add" @click="addPhaseRow">添加阶段名称</el-button>
            <div class="phase-hint">
              一个方案可包含多个阶段，例：方案一 → 一阶段·学制2月 / 二阶段·学制2月 / 三阶段·学制2月
            </div>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="planVisible = false">取消</el-button>
        <el-button v-readonly-hide type="primary" :loading="planSubmitting" @click="submitPlan">确定</el-button>
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

/* ---- 阶段明细（新增/编辑方案） ---- */
.phase-wrap {
  width: 100%;
}
.phase-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.phase-idx {
  flex: none;
  width: 22px;
  height: 22px;
  line-height: 22px;
  text-align: center;
  border-radius: 50%;
  background: #ecf5ff;
  color: #409eff;
  font-size: 12px;
}
.phase-name {
  flex: 1;
}
.phase-month {
  flex: none;
  width: 140px;
}
.phase-unit {
  flex: none;
  color: #606266;
  font-size: 13px;
}
.phase-add {
  margin-top: 2px;
}
.phase-hint {
  margin-top: 6px;
  color: #909399;
  font-size: 12px;
  line-height: 1.6;
}
</style>
