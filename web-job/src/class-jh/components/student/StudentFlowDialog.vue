<script setup lang="ts">
/**
 * 学生流程弹窗集合：休学 / 复学 / 退学 / 末班 / 转班
 *
 * 用法：<StudentFlowDialog v-model="visible" :mode="flowMode" :record="currentRow" @success="loadData" />
 * mode: 'suspend' | 'resume' | 'quit' | 'repeat' | 'transfer'
 */

import { reactive, ref, watch, computed } from 'vue';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { STAGE_NAME, FEE_TYPE_NAME } from 'shared-types/class-jh';
import type { StudentListItem, ClassInfo } from 'shared-types/class-jh';
import {
  suspendStudent,
  resumeStudent,
  quitStudent,
  repeatStudent,
  transferStudent,
} from '@/class-jh/api/student';
import { fetchClassOptions } from '@/class-jh/api/classInfo';

type FlowMode = 'suspend' | 'resume' | 'quit' | 'repeat' | 'transfer';

const props = defineProps<{
  modelValue: boolean;
  mode: FlowMode;
  record?: StudentListItem | null;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void;
  (e: 'success'): void;
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
});

const FLOW_TITLE: Record<FlowMode, string> = {
  suspend: '休学申请',
  resume: '复学申请',
  quit: '退学申请',
  repeat: '末班申请',
  transfer: '转班申请',
};

const title = computed(() => FLOW_TITLE[props.mode]);

const formRef = ref<FormInstance>();
const submitting = ref(false);
const classOptions = ref<ClassInfo[]>([]);

const form = reactive({
  suspendStartDate: '',
  expectResumeDate: '',
  suspendReason: '',
  phone: '',
  attendedHours: undefined as number | undefined,
  resumeClassId: '',
  resumeDate: '',
  applyReason: '',
  quitDate: '',
  quitFeeType: 1 as number,
  quitAmountYuan: undefined as number | undefined,
  toClassId: '',
  toStage: undefined as number | undefined,
  transferReason: '',
  repeatReason: '',
  notifyUserId: '',
  isNotified: true,
});

/** 退费类型选项（1~4，不含试学费） */
const refundFeeTypes = computed(() =>
  Object.entries(FEE_TYPE_NAME)
    .filter(([value]) => Number(value) <= 4)
    .map(([value, name]) => ({ value: Number(value), name })),
);

const rules = computed<FormRules>(() => {
  const r: FormRules = {};
  if (props.mode === 'suspend') {
    r.suspendStartDate = [{ required: true, message: '请选择计划休学开始日', trigger: 'change' }];
    r.suspendReason = [{ required: true, message: '请填写休学原因', trigger: 'blur' }];
  } else if (props.mode === 'resume') {
    r.resumeClassId = [{ required: true, message: '请选择复学班级', trigger: 'change' }];
    r.resumeDate = [{ required: true, message: '请选择复学日期', trigger: 'change' }];
  } else if (props.mode === 'quit') {
    r.suspendReason = [{ required: true, message: '请填写退学原因', trigger: 'blur' }];
    r.quitAmountYuan = [{ required: true, message: '请填写退费金额', trigger: 'blur' }];
  } else if (props.mode === 'repeat') {
    r.toClassId = [{ required: true, message: '请选择转入班级', trigger: 'change' }];
    r.repeatReason = [{ required: true, message: '请填写末班原因', trigger: 'blur' }];
  } else if (props.mode === 'transfer') {
    r.toClassId = [{ required: true, message: '请选择目标班级', trigger: 'change' }];
  }
  return r;
});

function reset() {
  formRef.value?.clearValidate();
  Object.assign(form, {
    suspendStartDate: '',
    expectResumeDate: '',
    suspendReason: '',
    phone: '',
    attendedHours: undefined,
    resumeClassId: '',
    resumeDate: '',
    applyReason: '',
    quitDate: '',
    quitFeeType: 1,
    quitAmountYuan: undefined,
    toClassId: '',
    toStage: undefined,
    transferReason: '',
    repeatReason: '',
    notifyUserId: '',
    isNotified: true,
  });
}

async function loadClassOptions() {
  try {
    classOptions.value = await fetchClassOptions({ excludeGraduated: true });
  } catch {
    /* 错误已统一处理 */
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    reset();
    loadClassOptions();
    if (props.record) {
      form.phone = props.record.phone || '';
    }
  },
);

async function handleSubmit() {
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) return;
  if (!props.record) return;

  const studentId = props.record.studentId;
  submitting.value = true;
  try {
    if (props.mode === 'suspend') {
      const payload = {
        studentId,
        suspendStartDate: form.suspendStartDate,
        expectResumeDate: form.expectResumeDate || undefined,
        suspendReason: form.suspendReason,
        phone: form.phone || undefined,
        attendedHours: form.attendedHours,
      };
      await suspendStudent(payload);
    } else if (props.mode === 'resume') {
      const payload = {
        studentId,
        resumeClassId: form.resumeClassId,
        resumeDate: form.resumeDate,
        applyReason: form.applyReason || undefined,
      };
      await resumeStudent(payload);
    } else if (props.mode === 'quit') {
      const payload = {
        studentId,
        applyDate: form.quitDate || undefined,
        suspendReason: form.suspendReason,
        attendedHours: form.attendedHours,
        // ★ 退学须登记退费信息：元 → 分（后端审批通过后据此自动生成退费单）
        refundFeeType: form.quitFeeType,
        refundAmount: Math.round((form.quitAmountYuan ?? 0) * 100),
      };
      await quitStudent(payload);
    } else if (props.mode === 'repeat') {
      const payload = {
        studentId,
        toClassId: form.toClassId,
        repeatReason: form.repeatReason,
        notifyUserId: form.notifyUserId || undefined,
        isNotified: form.isNotified,
      };
      await repeatStudent(payload);
    } else if (props.mode === 'transfer') {
      const payload = {
        studentId,
        toClassId: form.toClassId,
        toStage: form.toStage,
        transferReason: form.transferReason || undefined,
      };
      await transferStudent(payload);
    }
    ElMessage.success(title.value + '已提交');
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
  <el-dialog v-model="visible" :title="title" width="560px" @closed="reset">
    <el-form ref="formRef" :model="form" :rules="rules" label-width="120px">
      <el-form-item v-if="record" label="学生">
        <span>{{ record.studentName }}（{{ record.studentNo }}）</span>
      </el-form-item>

      <!-- 休学 -->
      <template v-if="mode === 'suspend'">
        <el-form-item label="计划休学开始日" prop="suspendStartDate">
          <el-date-picker v-model="form.suspendStartDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
        <el-form-item label="预计复学时间">
          <el-date-picker v-model="form.expectResumeDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
        <el-form-item label="休学原因" prop="suspendReason">
          <el-input v-model="form.suspendReason" type="textarea" :rows="3" placeholder="请填写休学原因" />
        </el-form-item>
        <el-form-item label="联系电话">
          <el-input v-model="form.phone" placeholder="联系电话" />
        </el-form-item>
        <el-form-item label="已上课时">
          <el-input-number v-model="form.attendedHours" :min="0" />
        </el-form-item>
      </template>

      <!-- 复学 -->
      <template v-else-if="mode === 'resume'">
        <el-form-item label="复学班级" prop="resumeClassId">
          <el-select v-model="form.resumeClassId" placeholder="请选择复学班级" style="width: 100%">
            <el-option
              v-for="c in classOptions"
              :key="c.classId"
              :label="`${c.className}（${c.stageName}）`"
              :value="c.classId"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="复学日期" prop="resumeDate">
          <el-date-picker v-model="form.resumeDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
        <el-form-item label="申请说明">
          <el-input v-model="form.applyReason" type="textarea" :rows="2" placeholder="可选" />
        </el-form-item>
      </template>

      <!-- 退学 -->
      <template v-else-if="mode === 'quit'">
        <el-form-item label="申请日期">
          <el-date-picker v-model="form.quitDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
        <el-form-item label="退学原因" prop="suspendReason">
          <el-input v-model="form.suspendReason" type="textarea" :rows="3" placeholder="请填写退学原因" />
        </el-form-item>
        <el-form-item label="已上课时">
          <el-input-number v-model="form.attendedHours" :min="0" />
        </el-form-item>
        <el-form-item label="退费类型" prop="quitFeeType">
          <el-select v-model="form.quitFeeType" style="width: 100%">
            <el-option v-for="t in refundFeeTypes" :key="t.value" :label="t.name" :value="t.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="退费金额（元）" prop="quitAmountYuan">
          <el-input-number v-model="form.quitAmountYuan" :min="0.01" :precision="2" :step="100" style="width: 100%" />
        </el-form-item>
        <el-form-item>
          <span style="font-size: 12px; color: var(--el-text-color-secondary)">
            退学审批通过后，将按此金额自动生成「待提交」退费单，转入退费审批链。
          </span>
        </el-form-item>
      </template>

      <!-- 末班 -->
      <template v-else-if="mode === 'repeat'">
        <el-form-item label="转入班级" prop="toClassId">
          <el-select v-model="form.toClassId" placeholder="请选择转入班级（可为封班）" style="width: 100%">
            <el-option
              v-for="c in classOptions"
              :key="c.classId"
              :label="`${c.className}（${c.stageName}）`"
              :value="c.classId"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="末班原因" prop="repeatReason">
          <el-input v-model="form.repeatReason" type="textarea" :rows="3" placeholder="如：阶段考核未通过" />
        </el-form-item>
        <el-form-item label="被通知班主任">
          <el-input v-model="form.notifyUserId" placeholder="班主任 ID（可选）" />
        </el-form-item>
        <el-form-item label="是否已通知">
          <el-switch v-model="form.isNotified" />
        </el-form-item>
      </template>

      <!-- 转班 -->
      <template v-else-if="mode === 'transfer'">
        <el-form-item label="目标班级" prop="toClassId">
          <el-select v-model="form.toClassId" placeholder="请选择目标班级" style="width: 100%">
            <el-option
              v-for="c in classOptions"
              :key="c.classId"
              :label="`${c.className}（${c.stageName}）`"
              :value="c.classId"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="目标阶段">
          <el-select v-model="form.toStage" clearable placeholder="默认取目标班级阶段" style="width: 100%">
            <el-option v-for="(name, value) in STAGE_NAME" :key="value" :label="name" :value="Number(value)" />
          </el-select>
        </el-form-item>
        <el-form-item label="转班原因">
          <el-input v-model="form.transferReason" type="textarea" :rows="2" placeholder="可选" />
        </el-form-item>
      </template>
    </el-form>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="handleSubmit">提交</el-button>
    </template>
  </el-dialog>
</template>
