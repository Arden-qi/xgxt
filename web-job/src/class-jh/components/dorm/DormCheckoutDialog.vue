<script setup lang="ts">
/**
 * 退宿弹窗（释放床位）
 *
 * 从入住名单直接发起；学生 / 房间 / 床位只读，仅填写退宿原因。
 */

import { ref, reactive, watch, computed } from 'vue';
import { ElMessage } from 'element-plus';
import type { DormResident } from 'shared-types/class-jh';
import { checkoutDorm } from '@/class-jh/api/dorm';

const props = defineProps<{
  modelValue: boolean;
  resident?: DormResident | null;
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
  checkoutReason: '',
});

watch(
  () => props.modelValue,
  (open) => {
    if (open) form.checkoutReason = '';
  },
);

async function handleSubmit() {
  if (!props.resident) return;
  submitting.value = true;
  try {
    await checkoutDorm({
      studentId: props.resident.studentId,
      roomId: props.resident.roomId,
      bedId: props.resident.bedId,
      checkoutReason: form.checkoutReason || undefined,
    });
    ElMessage.success('退宿成功');
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
  <el-dialog v-model="visible" title="退宿" width="480px">
    <el-form :model="form" label-width="90px">
      <el-form-item label="学生">
        <el-input :model-value="resident ? `${resident.studentNo} ${resident.studentName}` : ''" disabled />
      </el-form-item>
      <el-form-item label="房间/床位">
        <el-input :model-value="resident ? `${resident.roomNo} / ${resident.bedNo}` : ''" disabled />
      </el-form-item>
      <el-form-item label="退宿原因">
        <el-input v-model="form.checkoutReason" type="textarea" :rows="3" placeholder="请填写退宿原因" />
      </el-form-item>
    </el-form>
    <el-text type="warning" size="small">退宿后床位将释放为「空闲」。</el-text>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="handleSubmit">确定退宿</el-button>
    </template>
  </el-dialog>
</template>
