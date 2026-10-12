<script setup lang="ts">
/**
 * 退费新增 / 编辑弹窗
 *
 * ⚠️ 金额：输入单位为「元」，提交前统一 ×100 转「分」（utils/format.yuanToFen）。
 *   可选学生来自 /refund/eligible（退学且费用未用完）。
 */

import { ref, reactive, watch, computed } from 'vue';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { FeeType, FEE_TYPE_NAME } from 'shared-types/class-jh';
import type { RefundApply, RefundEligibleItem } from 'shared-types/class-jh';
import { addRefund, updateRefund, fetchRefundEligible } from '@/class-jh/api/refund';
import { yuanToFen, fenToYuan } from '@/class-jh/utils/format';

const props = defineProps<{
  modelValue: boolean;
  record?: RefundApply | null;
}>();
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void;
  (e: 'success'): void;
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
});
const isEdit = computed(() => !!props.record);

const formRef = ref<FormInstance>();
const submitting = ref(false);
const eligible = ref<RefundEligibleItem[]>([]);

const form = reactive({
  id: '',
  studentId: '' as string,
  feeType: FeeType.TUITION,
  /** 单位：元（提交时转分） */
  refundAmountYuan: 0,
  refundReason: '',
  applyDate: new Date().toISOString().slice(0, 10),
  headTeacherOpinion: '',
  isFeeUsedUp: false,
});

const rules: FormRules = {
  studentId: [{ required: true, message: '请选择学生', trigger: 'change' }],
  feeType: [{ required: true, message: '请选择退费类型', trigger: 'change' }],
  refundAmountYuan: [{ required: true, message: '请填写退费金额', trigger: 'blur' }],
  refundReason: [{ required: true, message: '请填写退费原因', trigger: 'blur' }],
  applyDate: [{ required: true, message: '请选择申请日期', trigger: 'change' }],
};

function reset() {
  formRef.value?.clearValidate();
  Object.assign(form, {
    id: '',
    studentId: '',
    feeType: FeeType.TUITION,
    refundAmountYuan: 0,
    refundReason: '',
    applyDate: new Date().toISOString().slice(0, 10),
    headTeacherOpinion: '',
    isFeeUsedUp: false,
  });
}

async function loadEligible() {
  try {
    eligible.value = await fetchRefundEligible();
  } catch {
    eligible.value = [];
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    reset();
    loadEligible();
    if (props.record) {
      Object.assign(form, {
        id: props.record.refundId,
        studentId: props.record.studentId,
        feeType: props.record.feeType,
        refundAmountYuan: fenToYuan(props.record.refundAmount),
        refundReason: props.record.refundReason,
        applyDate: props.record.applyDate ? String(props.record.applyDate).slice(0, 10) : '',
        headTeacherOpinion: props.record.headTeacherOpinion || '',
        isFeeUsedUp: props.record.isFeeUsedUp || false,
      });
    }
  },
);

async function handleSubmit() {
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) return;
  submitting.value = true;
  try {
    const payload = {
      studentId: form.studentId,
      feeType: form.feeType,
      refundAmount: yuanToFen(form.refundAmountYuan),
      refundReason: form.refundReason,
      applyDate: form.applyDate,
      headTeacherOpinion: form.headTeacherOpinion || undefined,
      isFeeUsedUp: form.isFeeUsedUp,
    };
    if (isEdit.value) {
      await updateRefund({ ...payload, id: form.id });
      ElMessage.success('修改成功');
    } else {
      await addRefund(payload);
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
  <el-dialog v-model="visible" :title="isEdit ? '编辑退费' : '新增退费'" width="560px" @closed="reset">
    <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
      <el-form-item label="学生" prop="studentId">
        <el-select v-model="form.studentId" filterable :disabled="isEdit" placeholder="请选择学生" style="width: 100%">
          <el-option
            v-for="s in eligible"
            :key="s.studentId"
            :label="`${s.studentNo} ${s.studentName}（${s.className || '无班级'}）`"
            :value="s.studentId"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="退费类型" prop="feeType">
        <el-select v-model="form.feeType" style="width: 100%">
          <el-option v-for="(name, value) in FEE_TYPE_NAME" :key="value" :label="name" :value="Number(value)" />
        </el-select>
      </el-form-item>
      <el-form-item label="退费金额(元)" prop="refundAmountYuan">
        <el-input-number v-model="form.refundAmountYuan" :min="0" :precision="2" :step="100" style="width: 100%" />
      </el-form-item>
      <el-form-item label="申请日期" prop="applyDate">
        <el-date-picker v-model="form.applyDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
      </el-form-item>
      <el-form-item label="退费原因" prop="refundReason">
        <el-input v-model="form.refundReason" type="textarea" :rows="2" />
      </el-form-item>
      <el-form-item label="班主任意见">
        <el-input v-model="form.headTeacherOpinion" type="textarea" :rows="2" />
      </el-form-item>
      <el-form-item label="费用已用完">
        <el-switch v-model="form.isFeeUsedUp" />
        <el-text type="info" size="small" class="ml8">费用用完时不可退费（后端校验）</el-text>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="handleSubmit">确定</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.ml8 {
  margin-left: 8px;
}
</style>
