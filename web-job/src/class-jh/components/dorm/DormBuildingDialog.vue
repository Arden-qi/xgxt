<script setup lang="ts">
/**
 * 楼栋 新增 / 修改 弹窗
 *
 * 说明：楼栋**不分男女**（性别只在「房间」上体现），所以这里没有「楼栋类型」字段。
 */

import { ref, reactive, watch, computed } from 'vue';
import { ElMessage } from 'element-plus';
import type { DormBuilding, DormBuildingSavePayload } from 'shared-types/class-jh';
import { addBuilding, updateBuilding } from '@/class-jh/api/dorm';

const props = defineProps<{
  modelValue: boolean;
  record?: DormBuilding | null;
}>();
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void;
  (e: 'success'): void;
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
});

const submitting = ref(false);

const form = reactive({
  buildingName: '',
  campusName: '',
  floorCount: undefined as number | undefined,
  managerName: '',
  managerPhone: '',
  deptName: '',
  buildingStatus: '使用中' as string,
});

const isEdit = computed(() => !!props.record?.buildingId);

function reset() {
  Object.assign(form, {
    buildingName: '',
    campusName: '',
    floorCount: undefined,
    managerName: '',
    managerPhone: '',
    deptName: '',
    buildingStatus: '使用中',
  });
}

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    reset();
    const r = props.record;
    if (r) {
      Object.assign(form, {
        buildingName: r.buildingName ?? '',
        campusName: r.campusName ?? '',
        floorCount: r.floorCount ?? undefined,
        managerName: r.managerName ?? '',
        managerPhone: r.managerPhone ?? '',
        deptName: r.deptName ?? '',
        buildingStatus: r.buildingStatus ?? '使用中',
      });
    }
  },
);

async function handleSubmit() {
  if (!form.buildingName.trim()) {
    ElMessage.warning('请填写楼栋名称');
    return;
  }
  const payload: DormBuildingSavePayload = {
    buildingName: form.buildingName.trim(),
    campusName: form.campusName.trim() || undefined,
    floorCount: form.floorCount,
    managerName: form.managerName.trim() || undefined,
    managerPhone: form.managerPhone.trim() || undefined,
    deptName: form.deptName.trim() || undefined,
    buildingStatus: form.buildingStatus || undefined,
  };
  submitting.value = true;
  try {
    if (isEdit.value && props.record) {
      await updateBuilding({ ...payload, buildingId: props.record.buildingId });
      ElMessage.success('修改成功');
    } else {
      await addBuilding(payload);
      ElMessage.success('新增成功');
    }
    visible.value = false;
    emit('success');
  } catch {
    /* 错误已统一处理 */
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <el-dialog v-model="visible" :title="isEdit ? '修改楼栋' : '新增楼栋'" width="520px" @closed="reset">
    <el-form :model="form" label-width="90px">
      <el-form-item label="楼栋名称" required>
        <el-input v-model="form.buildingName" maxlength="50" placeholder="如 A栋" />
      </el-form-item>
      <el-form-item label="所属校区">
        <el-input v-model="form.campusName" maxlength="50" placeholder="如 主校区" />
      </el-form-item>
      <el-form-item label="楼层数">
        <el-input-number v-model="form.floorCount" :min="0" :max="200" style="width: 100%" />
      </el-form-item>
      <el-form-item label="楼管姓名">
        <el-input v-model="form.managerName" maxlength="50" />
      </el-form-item>
      <el-form-item label="楼管电话">
        <el-input v-model="form.managerPhone" maxlength="20" placeholder="11 位手机号" />
      </el-form-item>
      <el-form-item label="对接部门">
        <el-input v-model="form.deptName" maxlength="50" placeholder="如 教务部" />
      </el-form-item>
      <el-form-item label="状态">
        <el-select v-model="form.buildingStatus" style="width: 100%">
          <el-option label="使用中" value="使用中" />
          <el-option label="停用" value="停用" />
        </el-select>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="handleSubmit">保存</el-button>
    </template>
  </el-dialog>
</template>
