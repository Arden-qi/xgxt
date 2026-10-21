<script setup lang="ts">
/**
 * 系统设置页
 *
 * 四个页签：系统设置（KV）/ 楼栋设置 / 阶段方案 / 操作日志。
 *
 * ★ 楼栋设置（2026-10-16 新增）：宿舍楼栋字典，和「教学管理 → 宿舍管理」
 *   的楼栋下拉是同一份数据（sms_common.t_dorm_building）。
 *   这里加一栋 → 宿舍管理的楼栋下拉立刻多一项，不需要改任何代码。
 *
 * ★ 阶段方案（2026-10-16 由「阶段字典」升级）：
 *   一个方案 = 方案名称 + 所属部门 + N 个阶段（阶段名称 + 学制月数）；
 *   例：方案一 → 一阶段 学制2月 / 二阶段 学制2月 / 三阶段 学制2月。
 *   班级新增/编辑里的「阶段方案 / 阶段」两个下拉即取这里的数据。
 */

import { ref, reactive, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus, Delete, Edit, Search, Refresh, SetUp, EditPen } from '@element-plus/icons-vue';
import { DEPT_NAME } from 'shared-types/class-jh';
import type { ClassSetting, StageScheme, OpLog, OpLogListQuery, StageSchemeSavePayload } from 'shared-types/class-jh';
import {
  fetchSettingDetail,
  updateSetting,
  fetchStageSchemeList,
  addStageScheme,
  updateStageScheme,
  deleteStageScheme,
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
 *   填了「楼层数 + 每层房间数」→ 点确定后端按「楼层 + 两位序号」自动生成宿舍号
 *   （1 楼第 8 间 = 108；10 楼第 8 间 = 1008，楼层两位数时房号自动变 4 位）。
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

/**
 * ★ 楼栋名自动顺延（2026-10-19）
 *   扫一遍现有楼栋名里「数字 + 号楼」的编号，取最大值 +1 预填（1/2/3 号楼 → 4 号楼）。
 *   预填只是默认值，用户可以在输入框里改（比如把 4 改成 8）。
 *
 * 【为什么只认「^数字号楼$」】楼栋名是自由文本，可能有「培训楼」「专家公寓」这类，
 *   它们不参与编号排队 —— 否则建一个「培训楼」就会把序号顶到奇怪的位置。
 *   一条都没匹配上 → 从 1 号楼开始。
 */
function nextBuildingName(): string {
  const nums = buildingData.value
    .map((b) => /^(\d+)\s*号楼$/.exec(String(b.buildingName || '').trim()))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => Number(m[1]))
    .filter((n) => Number.isFinite(n) && n > 0);
  const max = nums.length ? Math.max(...nums) : 0;
  return `${max + 1}号楼`;
}

function openBuildingDialog() {
  Object.assign(buildingForm, {
    id: '',
    // ★ 自动顺延（用户可改）
    buildingName: nextBuildingName(),
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

/* ================= 阶段方案 ================= */
const schemeLoading = ref(false);
const schemeData = ref<StageScheme[]>([]);

async function loadSchemes() {
  schemeLoading.value = true;
  try {
    schemeData.value = await fetchStageSchemeList();
  } catch {
    /* 错误已统一处理 */
  } finally {
    schemeLoading.value = false;
  }
}

/** 弹窗里的一行阶段明细（学制未填时为 undefined，提交前校验） */
interface SchemeStageRow {
  stageName: string;
  studyMonths: number | undefined;
}

const schemeVisible = ref(false);
const schemeSubmitting = ref(false);
const schemeForm = reactive<{
  id: string | undefined;
  schemeName: string;
  deptCode: number;
  stages: SchemeStageRow[];
}>({
  id: undefined,
  schemeName: '',
  deptCode: 1,
  stages: [],
});

/** 打开弹窗：传 row = 编辑（回填方案与阶段明细），不传 = 新增 */
function openSchemeDialog(row?: StageScheme) {
  if (row) {
    schemeForm.id = row.id;
    schemeForm.schemeName = row.schemeName;
    schemeForm.deptCode = row.deptCode;
    schemeForm.stages = row.stages.length
      ? row.stages.map((s) => ({ stageName: s.stageName, studyMonths: s.studyMonths ?? undefined }))
      : [{ stageName: '', studyMonths: undefined }];
  } else {
    schemeForm.id = undefined;
    schemeForm.schemeName = '';
    schemeForm.deptCode = 1;
    schemeForm.stages = [{ stageName: '', studyMonths: undefined }];
  }
  schemeVisible.value = true;
}

/** 「添加阶段名称」：一个方案可以挂多个阶段 */
function addSchemeStage() {
  schemeForm.stages.push({ stageName: '', studyMonths: undefined });
}

function removeSchemeStage(index: number) {
  if (schemeForm.stages.length <= 1) return;
  schemeForm.stages.splice(index, 1);
}

async function submitScheme() {
  const schemeName = schemeForm.schemeName.trim();
  if (!schemeName) {
    ElMessage.warning('请填写方案名称');
    return;
  }
  if (!schemeForm.deptCode) {
    ElMessage.warning('请选择所属部门');
    return;
  }
  if (!schemeForm.stages.length) {
    ElMessage.warning('请至少添加一个阶段');
    return;
  }
  for (let i = 0; i < schemeForm.stages.length; i++) {
    const s = schemeForm.stages[i];
    if (!s.stageName?.trim()) {
      ElMessage.warning(`请填写第 ${i + 1} 个阶段的阶段名称`);
      return;
    }
    if (!s.studyMonths || s.studyMonths <= 0) {
      ElMessage.warning(`请填写第 ${i + 1} 个阶段的学制（月）`);
      return;
    }
  }

  const payload: StageSchemeSavePayload = {
    schemeName,
    deptCode: schemeForm.deptCode,
    stages: schemeForm.stages.map((s) => ({ stageName: s.stageName.trim(), studyMonths: Number(s.studyMonths) })),
  };

  schemeSubmitting.value = true;
  try {
    if (schemeForm.id) {
      await updateStageScheme(schemeForm.id, payload);
      ElMessage.success('保存成功');
    } else {
      await addStageScheme(payload);
      ElMessage.success('新增成功');
    }
    schemeVisible.value = false;
    loadSchemes();
  } catch {
    /* 错误已统一处理 */
  } finally {
    schemeSubmitting.value = false;
  }
}

async function handleDeleteScheme(row: StageScheme) {
  try {
    await ElMessageBox.confirm(
      `确定删除方案「${row.schemeName}」吗？（方案下已有班级 / 学生正在使用的阶段不可删）`,
      '删除确认',
      {
        type: 'warning',
        confirmButtonText: '确定删除',
        cancelButtonText: '取消',
      },
    );
  } catch {
    return;
  }
  try {
    await deleteStageScheme(row.id);
    ElMessage.success('删除成功');
    loadSchemes();
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
  loadSchemes();
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

      <!-- 阶段方案（★ 2026-10-16 由「阶段字典」升级：一个方案可含多个阶段） -->
      <el-tab-pane label="阶段方案" name="stageScheme">
        <div class="toolbar">
          <el-button v-readonly-hide type="primary" :icon="Plus" @click="openSchemeDialog()">新增方案</el-button>
        </div>
        <el-table v-loading="schemeLoading" :data="schemeData" border stripe empty-text="暂无方案">
          <el-table-column type="index" label="序号" width="60" align="center" />
          <el-table-column prop="schemeName" label="方案名称" min-width="180" />
          <el-table-column label="所属部门" width="140">
            <template #default="{ row }">{{ DEPT_NAME[row.deptCode] || dash(row.deptCode) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="150" align="center" fixed="right">
            <template #default="{ row }">
              <el-button v-readonly-hide link type="primary" size="small" :icon="Edit" @click="openSchemeDialog(row)">编辑</el-button>
              <el-button v-readonly-hide link type="danger" size="small" :icon="Delete" @click="handleDeleteScheme(row)">删除</el-button>
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
          <el-text type="info" size="small" class="ml12">默认按已有楼栋顺延，编号可自行修改</el-text>
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
            填了前两项 → 点确定后自动生成「楼层 + 两位序号」的宿舍号
            （1 楼第 8 间 = 108、5 楼第 12 间 = 512；10 楼第 8 间 = 1008）。
            三项上限都是 50；楼层 ≥ 10 时房号自动变成 4 位，不用额外配置。
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
          <el-text type="info" size="small" class="ml12">最多 {{ DORM_FLOOR_MAX }} 层</el-text>
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


    <!-- 新增 / 编辑方案（★ 一个方案可挂多个阶段） -->
    <el-dialog v-model="schemeVisible" :title="schemeForm.id ? '编辑方案' : '新增方案'" width="640px">
      <el-form :model="schemeForm" label-width="90px">
        <el-form-item label="方案名称" required>
          <el-input v-model="schemeForm.schemeName" maxlength="50" placeholder="如 方案一" />
        </el-form-item>
        <el-form-item label="所属部门" required>
          <el-select v-model="schemeForm.deptCode" style="width: 100%">
            <el-option v-for="(name, value) in DEPT_NAME" :key="value" :label="name" :value="Number(value)" />
          </el-select>
        </el-form-item>
        <el-form-item label="阶段明细" required>
          <div class="scheme-stages">
            <div v-for="(s, i) in schemeForm.stages" :key="i" class="scheme-stage-row">
              <span class="scheme-stage-row__no">{{ i + 1 }}</span>
              <el-input v-model="s.stageName" maxlength="50" placeholder="阶段名称，如 一阶段" class="scheme-stage-row__name" />
              <el-input-number
                v-model="s.studyMonths"
                :min="1"
                :max="120"
                controls-position="right"
                class="scheme-stage-row__months"
              />
              <span class="scheme-stage-row__unit">月</span>
              <el-button
                link
                type="danger"
                :icon="Delete"
                :disabled="schemeForm.stages.length <= 1"
                @click="removeSchemeStage(i)"
              >
                删除
              </el-button>
            </div>
            <el-button link type="primary" :icon="Plus" @click="addSchemeStage">添加阶段名称</el-button>
            <div class="scheme-stages__tip">
              一个方案可包含多个阶段，例：方案一 → 一阶段 · 学制2月 / 二阶段 · 学制2月 / 三阶段 · 学制2月
            </div>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="schemeVisible = false">取消</el-button>
        <el-button v-readonly-hide type="primary" :loading="schemeSubmitting" @click="submitScheme">确定</el-button>
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

/* 新增/编辑方案弹窗里的「阶段明细」 */
.scheme-stages {
  width: 100%;
}
.scheme-stage-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.scheme-stage-row__no {
  width: 20px;
  height: 20px;
  line-height: 20px;
  text-align: center;
  border-radius: 50%;
  background: #ecf5ff;
  color: #409eff;
  font-size: 12px;
  flex: none;
}
.scheme-stage-row__name {
  width: 220px;
}
.scheme-stage-row__months {
  width: 130px;
}
.scheme-stage-row__unit {
  color: #909399;
}
.scheme-stages__tip {
  margin-top: 6px;
  font-size: 12px;
  color: #909399;
  line-height: 1.6;
}
</style>
