<script setup lang="ts">
/**
 * 师资交接弹窗
 */

import { reactive, ref, watch, computed } from 'vue';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { HandoverRole, HANDOVER_ROLE_NAME } from 'shared-types/class-jh';
import type { ClassInfo } from 'shared-types/class-jh';
import { addHandover } from '@/class-jh/api/classInfo';

const props = defineProps<{
  modelValue: boolean;
  record?: ClassInfo | null;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void;
  (e: 'success'): void;
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
});

const formRef = ref<FormInstance>();
const submitting = ref(false);

const form = reactive({
  handoverRole: HandoverRole.HEAD_TEACHER,
  toUserId: '',
  toUserName: '',
  handoverReason: '',
  handoverContent: '',
});

const rules: FormRules = {
  handoverRole: [{ required: true, message: '请选择交接岗位', trigger: 'change' }],
  toUserId: [{ required: true, message: '请输入接管人 ID', trigger: 'blur' }],
  toUserName: [{ required: true, message: '请输入接管人姓名', trigger: 'blur' }],
  handoverContent: [{ required: true, message: '请填写交接内容', trigger: 'blur' }],
};

function reset() {
  formRef.value?.clearValidate();
  Object.assign(form, {
    handoverRole: HandoverRole.HEAD_TEACHER,
    toUserId: '',
    toUserName: '',
    handoverReason: '',
    handoverContent: '',
  });
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) reset();
  },
);

async function handleSubmit() {
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid || !props.record) return;
  submitting.value = true;
  try {
    const payload = {
      classId: props.record.classId,
      handoverRole: form.handoverRole,
      toUserId: form.toUserId,
      toUserName: form.toUserName,
      handoverReason: form.handoverReason || undefined,
      handoverContent: form.handoverContent,
    };
    await addHandover(payload);
    ElMessage.success('交接成功');
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
  <el-dialog v-model="visible" title="师资交接" width="560px" @closed="reset">
    <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
      <el-form-item v-if="record" label="班级">
        <span>{{ record.className }}（{{ record.stageName }}）</span>
      </el-form-item>
      <el-form-item label="交接岗位" prop="handoverRole">
        <el-radio-group v-model="form.handoverRole">
          <el-radio :value="HandoverRole.HEAD_TEACHER">班主任</el-radio>
          <el-radio :value="HandoverRole.TEACHER">教员</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="接管人 ID" prop="toUserId">
        <el-input v-model="form.toUserId" placeholder="接管人 ID" />
      </el-form-item>
      <el-form-item label="接管人姓名" prop="toUserName">
        <el-input v-model="form.toUserName" placeholder="接管人姓名" />
      </el-form-item>
      <el-form-item label="交接原因">
        <el-input v-model="form.handoverReason" placeholder="如：原任调岗" />
      </el-form-item>
      <el-form-item label="交接内容" prop="handoverContent">
        <el-input v-model="form.handoverContent" type="textarea" :rows="4" placeholder="教学进度、班级情况等" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="handleSubmit">提交交接</el-button>
    </template>
  </el-dialog>
</template>
