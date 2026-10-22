<script setup lang="ts">
/**
 * 系统设置页
 *
 * ★ 2026-10-22：页面只剩「阶段方案」一个页签 ——
 *   原来的「系统设置（KV）」和「操作日志」两个页签已按需求删除。
 *   · 设置项（出勤达标线、催费窗口天数等）仍保存在后端 t_class_setting 里，
 *     只是不再开界面入口；需要改值时改库或走接口 PUT /api/class-jh/setting/update。
 *   · 操作日志仍在后端写入（utils/opLog.ts → t_class_op_log），
 *     要查全局留痕请走「权限管理 · 操作日志」（/perm/log）。
 *
 * 阶段方案 = 方案名称 + 所属部门 + N 个阶段（阶段名称 + 学制月数），
 * ★ 2026-10-16 由「阶段字典」升级而来：
 *   例：方案一 → 一阶段 学制2月 / 二阶段 学制2月 / 三阶段 学制2月。
 *   班级新增/编辑里的「阶段方案 / 阶段」两个下拉即取这里的数据。
 */

import { ref, reactive, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus, Delete, Edit } from '@element-plus/icons-vue';
import { DEPT_NAME } from 'shared-types/class-jh';
import type { StageScheme, StageSchemeSavePayload } from 'shared-types/class-jh';
import {
  fetchStageSchemeList,
  addStageScheme,
  updateStageScheme,
  deleteStageScheme,
} from '@/class-jh/api/setting';
import { dash } from '@/class-jh/utils/format';

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

onMounted(() => {
  loadSchemes();
});
</script>

<template>
  <div class="page-container">
    <el-tabs model-value="stageScheme" type="border-card">
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
    </el-tabs>

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
.toolbar {
  margin-bottom: 12px;
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
