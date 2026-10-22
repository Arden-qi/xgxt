<script setup lang="ts">
/**
 * 阶段方案设计面板（★ 2026-10-22 从「系统设置」迁到「班级管理」）
 * ============================================================
 *
 * 【为什么搬】
 *   用户口径：阶段方案是建班/排阶段时天天用的东西，藏在「系统设置」里太深；
 *   搬进班级管理，点工具栏的「阶段方案设计」以弹窗形式出现，原系统设置页签删除。
 *
 * 【数据口径没变】
 *   一个方案 = 方案名称 + 所属部门 + N 个阶段（阶段名称 + 学制月数），
 *   存在 sms_class_jh.t_class_stage_scheme(_stage)；班级表单的「阶段方案 / 阶段」
 *   两个下拉取的就是这份数据。
 *
 * 【权限】入口只给校长 / 学管主任（后端 stage-scheme 接口也加了同样的角色限制）。
 *   本组件只管展示与增删改，路由与角色判断在页面层。
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

const emit = defineEmits<{ (e: 'changed'): void }>();

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
    await loadSchemes();
    emit('changed');
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
      { type: 'warning', confirmButtonText: '确定删除', cancelButtonText: '取消' },
    );
  } catch {
    return;
  }
  try {
    await deleteStageScheme(row.id);
    ElMessage.success('删除成功');
    await loadSchemes();
    emit('changed');
  } catch {
    /* 错误已统一处理 */
  }
}

onMounted(loadSchemes);

defineExpose({ reload: loadSchemes });
</script>

<template>
  <div class="ssp">
    <div class="ssp-toolbar">
      <span class="ssp-tip">
        一个方案 = 方案名称 + 所属部门 + N 个阶段；班级新增/编辑时的「阶段方案 / 阶段」取自这里
      </span>
      <el-button v-readonly-hide type="primary" :icon="Plus" size="small" @click="openSchemeDialog()">
        新增方案
      </el-button>
    </div>

    <el-table v-loading="schemeLoading" :data="schemeData" border stripe size="small" empty-text="暂无方案" max-height="420">
      <el-table-column type="index" label="序号" width="60" align="center" />
      <el-table-column prop="schemeName" label="方案名称" min-width="180" />
      <el-table-column label="所属部门" width="120">
        <template #default="{ row }">{{ DEPT_NAME[row.deptCode] || dash(row.deptCode) }}</template>
      </el-table-column>
      <el-table-column label="阶段明细" min-width="240">
        <template #default="{ row }">
          <span v-if="!row.stages?.length" class="ssp-muted">—</span>
          <span v-for="(s, i) in row.stages" :key="s.id || i" class="ssp-stage-tag">
            {{ s.stageName }}<template v-if="s.studyMonths"> · {{ s.studyMonths }}月</template>
          </span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="150" align="center" fixed="right">
        <template #default="{ row }">
          <el-button v-readonly-hide link type="primary" size="small" :icon="Edit" @click="openSchemeDialog(row)">
            编辑
          </el-button>
          <el-button v-readonly-hide link type="danger" size="small" :icon="Delete" @click="handleDeleteScheme(row)">
            删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 新增 / 编辑方案 -->
    <el-dialog v-model="schemeVisible" :title="schemeForm.id ? '编辑方案' : '新增方案'" width="640px" append-to-body>
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
          <div class="ssp-stages">
            <div v-for="(s, i) in schemeForm.stages" :key="i" class="ssp-stage-row">
              <span class="ssp-stage-row__no">{{ i + 1 }}</span>
              <el-input v-model="s.stageName" maxlength="50" placeholder="阶段名称，如 一阶段" class="ssp-stage-row__name" />
              <el-input-number
                v-model="s.studyMonths"
                :min="1"
                :max="120"
                controls-position="right"
                class="ssp-stage-row__months"
              />
              <span class="ssp-stage-row__unit">月</span>
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
            <div class="ssp-stages__tip">
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
.ssp-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}
.ssp-tip {
  font-size: 12px;
  color: var(--el-text-color-secondary, #909399);
}
.ssp-muted {
  color: var(--el-text-color-placeholder, #c0c4cc);
}
.ssp-stage-tag {
  display: inline-block;
  margin-right: 8px;
  padding: 0 8px;
  line-height: 20px;
  font-size: 12px;
  border-radius: 10px;
  background: var(--el-fill-color-light, #f5f7fa);
  color: var(--el-text-color-regular, #606266);
}
.ssp-stages {
  width: 100%;
}
.ssp-stage-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.ssp-stage-row__no {
  width: 18px;
  text-align: center;
  color: var(--el-text-color-secondary, #909399);
}
.ssp-stage-row__name {
  flex: 1;
}
.ssp-stage-row__months {
  width: 110px;
}
.ssp-stage-row__unit {
  color: var(--el-text-color-secondary, #909399);
}
.ssp-stages__tip {
  margin-top: 6px;
  font-size: 12px;
  color: var(--el-text-color-secondary, #909399);
}
</style>
