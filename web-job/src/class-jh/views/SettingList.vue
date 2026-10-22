<script setup lang="ts">
/**
 * 系统设置页
 *
 * 三个页签：系统设置（KV）/ 楼栋设置 / 操作日志。
 *
 * ★ 楼栋设置（2026-10-16 新增）：宿舍楼栋字典，和「教学管理 → 宿舍管理」
 *   的楼栋下拉是同一份数据（sms_common.t_dorm_building）。
 *   这里加一栋 → 宿舍管理的楼栋下拉立刻多一项，不需要改任何代码。
 *
 * ★ 2026-10-20 楼栋设置抽成公共面板 `BuildingSettingPanel.vue`：
 *   独立的「教学管理 → 楼栋设置」页（/class-jh/building，单独授权给教务老师）
 *   与本页页签渲染**同一个组件**，不再复制两份逻辑。
 *
 * ★ 2026-10-22：原「阶段方案」页签已迁到「班级管理 → 阶段方案设计」弹窗
 *   （组件 web-job/src/teaching/components/StageSchemePanel.vue），本页不再保留。
 */

import { ref, reactive, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { Search, Refresh, SetUp } from '@element-plus/icons-vue';
import type { ClassSetting, OpLog, OpLogListQuery } from 'shared-types/class-jh';
import { fetchSettingDetail, updateSetting, fetchOpLogList } from '@/class-jh/api/setting';
import { dash, formatDateTime } from '@/class-jh/utils/format';
/** ★ 2026-10-20：楼栋设置抽成公共面板，系统设置页与独立「楼栋设置」页共用 */
import BuildingSettingPanel from '@/class-jh/components/setting/BuildingSettingPanel.vue';

const activeTab = ref('setting');

/* ================= 系统设置 ================= */
const settingLoading = ref(false);
const settingList = ref<ClassSetting[]>([]);
const settingSaving = ref(false);
/** 表单值（字符串归一化，保存时再转换类型） */
const settingValues = reactive<Record<string, string>>({});

/** 数字型设置键 */
const NUMBER_KEYS = ['attendanceTargetRate', 'feeRemindDays', 'feeUrgeWindowDays', 'refundThresholdAmount', 'closedClassIntakeTypes'];
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

      <!-- 楼栋设置（公共面板：与独立「楼栋设置」页完全相同） -->
      <el-tab-pane label="楼栋设置" name="building">
        <BuildingSettingPanel />
      </el-tab-pane>

      <!-- ★ 2026-10-22：「阶段方案」页签已迁到「班级管理 → 阶段方案设计」弹窗，此处删除 -->
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
/* 楼栋列表里「未配置 / 0」的弱化显示 */
.muted {
  color: #c0c4cc;
}
.ok {
  color: #303133;
}

</style>
