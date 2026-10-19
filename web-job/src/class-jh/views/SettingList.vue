<script setup lang="ts">
/**
 * 系统设置页
 *
 * 四个页签：系统设置（KV）/ 楼栋设置 / 阶段字典 / 操作日志。
 *
 * ★ 2026-10-16 新增「楼栋设置」：宿舍楼栋字典，和「教学管理 → 宿舍管理」
 *   的楼栋下拉是同一份数据（sms_common.t_dorm_building）。
 *   这里加一栋 → 宿舍管理的楼栋下拉立刻多一项，不需要改任何代码。
 */

import { ref, reactive, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus, Delete, Search, Refresh, SetUp, EditPen } from '@element-plus/icons-vue';
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
import {
  listDormBuildings,
  saveDormBuilding,
  deleteDormBuilding,
  DORM_FLOOR_MAX,
  DORM_ROOMS_PER_FLOOR_MAX,
  DORM_BED_PER_ROOM_MAX,
  DORM_BED_PER_ROOM_DEFAULT,
  type DormBuildingRow,
} from '@/teaching/api/building';
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

/* ================= 楼栋设置 ================= */
/**
 * ★ 宿舍楼栋字典
 *
 * 与「教学管理 → 宿舍管理」的楼栋下拉**共用同一份数据**（接口 /api/teaching/building/*）。
 * 所以新增/删除后不需要通知谁：宿舍管理那边每次开「新增房间」弹窗都会重拉一次，
 * 列表页的楼栋筛选也会在下次 load 时带上。
 */
const buildingLoading = ref(false);
const buildingData = ref<DormBuildingRow[]>([]);
const buildingVisible = ref(false);
const buildingSubmitting = ref(false);
/**
 * 楼栋表单
 *
 * ★ floorCount / roomsPerFloor / bedPerRoom（2026-10-19 加）
 *   填了「楼层数 + 每层房间数」→ 点确定后端按
 *   「楼层 + 两位序号」自动生成 3 位宿舍号的房间（1 楼第 8 间 = 108）。
 *   0 表示未配置（老楼栋的房间是手工加的，不动它）。
 */
const buildingForm = reactive({
  id: '',
  buildingName: '',
  category: 1 as number,
  floorCount: 0,
  roomsPerFloor: 0,
  bedPerRoom: DORM_BED_PER_ROOM_DEFAULT,
  remark: '',
});

const DORM_BUILDING_CATEGORY_OPTIONS = [
  { value: 1, label: '男寝' },
  { value: 2, label: '女寝' },
];

function buildingCategoryName(category: number | null | undefined) {
  if (category === 1) return '男寝';
  if (category === 2) return '女寝';
  return '未设置';
}

async function loadBuildings() {
  buildingLoading.value = true;
  try {
    buildingData.value = await listDormBuildings();
  } catch {
    /* 错误已统一处理 */
  } finally {
    buildingLoading.value = false;
  }
}

function openBuildingDialog() {
  Object.assign(buildingForm, {
    id: '',
    buildingName: '',
    category: 1,
    floorCount: 0,
    roomsPerFloor: 0,
    bedPerRoom: DORM_BED_PER_ROOM_DEFAULT,
    remark: '',
  });
  buildingVisible.value = true;
}

function openBuildingEdit(row: DormBuildingRow) {
  Object.assign(buildingForm, {
    id: row.id,
    buildingName: row.buildingName,
    category: row.category ?? 1,
    floorCount: row.floorCount ?? 0,
    roomsPerFloor: row.roomsPerFloor ?? 0,
    bedPerRoom: row.bedPerRoom || DORM_BED_PER_ROOM_DEFAULT,
    remark: row.remark || '',
  });
  buildingVisible.value = true;
}

/**
 * ★ 按当前表单配置算一下会生成多少间（给弹窗里的提示文案用）
 *   楼层数或每层房间数为 0（未配置）→ 不生成。
 */
function buildingPlanCount(): number {
  const f = Number(buildingForm.floorCount) || 0;
  const r = Number(buildingForm.roomsPerFloor) || 0;
  return f > 0 && r > 0 ? f * r : 0;
}

async function submitBuilding() {
  const name = buildingForm.buildingName.trim();
  if (!name) {
    ElMessage.warning('请填写楼栋名称');
    return;
  }
  buildingSubmitting.value = true;
  try {
    const r = await saveDormBuilding({
      id: buildingForm.id || undefined,
      buildingName: name,
      category: buildingForm.category,
      floorCount: Number(buildingForm.floorCount) || 0,
      roomsPerFloor: Number(buildingForm.roomsPerFloor) || 0,
      bedPerRoom: Number(buildingForm.bedPerRoom) || DORM_BED_PER_ROOM_DEFAULT,
      remark: buildingForm.remark || undefined,
    });
    /**
     * ★ 提示里要说清楚**实际建了几间**：
     *   配置 6 层 × 15 间，但其中 3 间之前建过 → 实际只新建 87 间。
     *   不报数字的话，用户会以为「点了确定但好像没生效」。
     */
    const rooms = r?.rooms;
    if (rooms) {
      const parts: string[] = [];
      if (rooms.created) parts.push(`新建 ${rooms.created} 间`);
      if (rooms.revived) parts.push(`恢复 ${rooms.revived} 间`);
      if (rooms.skipped) parts.push(`${rooms.skipped} 间已存在`);
      ElMessage.success(`${buildingForm.id ? '楼栋已更新' : '新增成功'}，自动生成宿舍：${parts.join('，') || '无变化'}`);
    } else {
      ElMessage.success(buildingForm.id ? '楼栋已更新' : '新增成功');
    }
    buildingVisible.value = false;
    loadBuildings();
  } catch {
    /* 错误已统一处理（如「楼栋已存在」「名下还有宿舍不能删」） */
  } finally {
    buildingSubmitting.value = false;
  }
}

async function handleDeleteBuilding(row: DormBuildingRow) {
  try {
    await ElMessageBox.confirm(
      `确定删除楼栋「${row.buildingName}」吗？（名下已有宿舍的楼栋不能删）`,
      '删除确认',
      { type: 'warning', confirmButtonText: '确定删除', cancelButtonText: '取消' },
    );
  } catch {
    return;
  }
  try {
    await deleteDormBuilding(row.id);
    ElMessage.success('删除成功');
    loadBuildings();
  } catch {
    /* 错误已统一处理 */
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
  loadBuildings();
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

      <!-- 楼栋设置 -->
      <el-tab-pane label="楼栋设置" name="building">
        <div class="toolbar">
          <el-button v-readonly-hide type="primary" :icon="Plus" @click="openBuildingDialog">新增楼栋</el-button>
          <el-text type="info" size="small" class="ml12">
            这里的楼栋就是「宿舍管理」里楼栋下拉的选项，两边实时一致
          </el-text>
        </div>
        <el-table v-loading="buildingLoading" :data="buildingData" border stripe empty-text="暂无楼栋">
          <el-table-column type="index" label="序号" width="60" align="center" />
          <el-table-column prop="buildingName" label="楼栋名称" min-width="180" />
          <el-table-column label="类别" width="100" align="center">
            <template #default="{ row }">
              <el-tag v-if="row.category" :type="row.category === 1 ? 'primary' : 'danger'" size="small">
                {{ buildingCategoryName(row.category) }}
              </el-tag>
              <el-tag v-else type="info" size="small">未设置</el-tag>
            </template>
          </el-table-column>
          <!-- ★ 楼层 = 该楼配置的楼层数（未配置显示 —） -->
          <el-table-column label="楼层" width="90" align="center">
            <template #default="{ row }">
              <span v-if="row.floorCount">{{ row.floorCount }} 层</span>
              <span v-else class="muted">—</span>
            </template>
          </el-table-column>
          <!--
            ★ 宿舍数 = 该楼栋名下**当前在用**的房间数（后端实时统计）
              宿舍管理里删掉一间，这里刷新就少 1 —— 不用做任何同步。
          -->
          <el-table-column label="宿舍数" width="90" align="center">
            <template #default="{ row }">
              <b :class="row.roomCount ? 'ok' : 'muted'">{{ row.roomCount }}</b>
            </template>
          </el-table-column>
          <el-table-column prop="remark" label="备注" min-width="200">
            <template #default="{ row }">{{ dash(row.remark) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="140" align="center" fixed="right">
            <template #default="{ row }">
              <el-button v-readonly-hide link type="primary" size="small" :icon="EditPen" @click="openBuildingEdit(row)">编辑</el-button>
              <el-button v-readonly-hide link type="danger" size="small" :icon="Delete" @click="handleDeleteBuilding(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
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

    <!-- 新增 / 编辑楼栋 -->
    <el-dialog v-model="buildingVisible" :title="buildingForm.id ? '编辑楼栋' : '新增楼栋'" width="560px">
      <el-form :model="buildingForm" label-width="100px">
        <el-form-item label="楼栋名称" required>
          <el-input v-model="buildingForm.buildingName" maxlength="50" placeholder="如 4号楼" />
        </el-form-item>
        <el-form-item label="类别" required>
          <el-radio-group v-model="buildingForm.category">
            <el-radio v-for="d in DORM_BUILDING_CATEGORY_OPTIONS" :key="d.value" :value="d.value">
              {{ d.label }}
            </el-radio>
          </el-radio-group>
        </el-form-item>
        <!--
          ★ 楼层数 / 每层房间数 / 每间床位数（2026-10-19）
            填了前两项 → 点确定后自动生成「楼层+两位序号」的宿舍号
            （1 楼第 8 间 = 108、5 楼第 12 间 = 512）。
            楼层上限 9、每层上限 99 —— 因为宿舍号是 3 位数字，
            第 1 位只能是一位楼层数，装不下 10 层以上的楼。
        -->
        <el-form-item label="楼层数">
          <el-input-number
            v-model="buildingForm.floorCount"
            :min="0"
            :max="DORM_FLOOR_MAX"
            :step="1"
            step-strictly
            style="width: 140px"
          />
          <el-text type="info" size="small" class="ml12">最多 {{ DORM_FLOOR_MAX }} 层（宿舍号首位）</el-text>
        </el-form-item>
        <el-form-item label="每层房间数">
          <el-input-number
            v-model="buildingForm.roomsPerFloor"
            :min="0"
            :max="DORM_ROOMS_PER_FLOOR_MAX"
            :step="1"
            step-strictly
            style="width: 140px"
          />
          <el-text type="info" size="small" class="ml12">填 0 表示不自动生成</el-text>
        </el-form-item>
        <el-form-item label="每间床位数">
          <el-input-number
            v-model="buildingForm.bedPerRoom"
            :min="1"
            :max="DORM_BED_PER_ROOM_MAX"
            :step="1"
            step-strictly
            style="width: 140px"
          />
        </el-form-item>
        <el-alert
          v-if="buildingPlanCount() > 0"
          type="info"
          :closable="false"
          show-icon
          class="mb12"
          :title="`确定后将自动生成 ${buildingPlanCount()} 间宿舍（房号 101 ~ ${buildingForm.floorCount}${String(buildingForm.roomsPerFloor).padStart(2, '0')}）；已存在的房间不会重复生成`"
        />
        <el-form-item label="备注">
          <el-input v-model="buildingForm.remark" maxlength="100" placeholder="选填" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="buildingVisible = false">取消</el-button>
        <el-button v-readonly-hide type="primary" :loading="buildingSubmitting" @click="submitBuilding">确定</el-button>
      </template>
    </el-dialog>

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
/* 楼栋列表里「未配置 / 0」的弱化显示 */
.muted {
  color: #c0c4cc;
}
.ok {
  color: #303133;
}
</style>
