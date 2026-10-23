<script setup lang="ts">
/**
 * 系统设置页
 *
 * 一个页签：系统设置（KV）。
 *
 * ★ 2026-10-23：按用户要求再删「操作日志」页签 —— 本页只剩「系统设置」一个页签。
 *   操作日志仍在后端写入（utils/opLog.ts → t_class_op_log），
 *   要查全局留痕请走「权限管理 · 操作日志」（/perm/log）。
 *
 * ★ 2026-10-22：「楼栋设置」页签已下线 —— 搬到「教学管理 → 宿舍管理」
 *   （宿舍管理第 4 个页签）。楼栋字典仍是同一份（sms_common.t_dorm_building），
 *   在宿舍管理里加一栋，宿舍房间/班级分派的楼栋下拉立刻多一项。
 *   楼栋面板组件保留：`@/class-jh/components/setting/BuildingSettingPanel.vue`。
 *
 * ★ 2026-10-22：原「阶段方案」页签已迁到「班级管理 → 阶段方案设计」弹窗
 *   （组件 web-job/src/teaching/components/StageSchemePanel.vue），本页不再保留。
 */

import { ref, reactive, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { SetUp } from '@element-plus/icons-vue';
import type { ClassSetting } from 'shared-types/class-jh';
import { fetchSettingDetail, updateSetting } from '@/class-jh/api/setting';

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

onMounted(() => {
  loadSettings();
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

      <!-- ★ 2026-10-22：「楼栋设置」页签已下线 —— 搬到「教学管理 → 宿舍管理」里
           （第四个页签，与宿舍管理共用同一份楼栋字典） -->

      <!-- ★ 2026-10-22：「阶段方案」页签已迁到「班级管理 → 阶段方案设计」弹窗，此处删除 -->
      <!-- ★ 2026-10-23：「操作日志」页签已按用户要求删除；留痕改在「权限管理 · 操作日志」查 -->
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
