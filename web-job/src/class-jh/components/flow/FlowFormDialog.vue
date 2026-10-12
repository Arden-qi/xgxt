<script setup lang="ts">
/**
 * 流程发起弹窗（休学/复学/转班/换人/退学/就业协议/末班）
 *
 * 依据 flowType 动态渲染专有字段，提交时只带该类型相关字段。
 */

import { ref, reactive, watch, computed } from 'vue';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { FlowType, FLOW_TYPE_NAME, STAGE_NAME, HANDOVER_ROLE_NAME, AGREEMENT_STATUS_NAME, FEE_TYPE_NAME } from 'shared-types/class-jh';
import type { FlowSubmitPayload, StudentListItem, ClassInfo } from 'shared-types/class-jh';
import { submitFlow } from '@/class-jh/api/flow';
import { fetchStudentList } from '@/class-jh/api/student';
import { fetchClassOptions } from '@/class-jh/api/classInfo';
import { fetchAllPages } from '@/class-jh/utils/fetchAll';

const props = defineProps<{
  modelValue: boolean;
  defaultType?: FlowType;
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
const students = ref<StudentListItem[]>([]);
const classOptions = ref<ClassInfo[]>([]);

const form = reactive({
  flowType: FlowType.SUSPEND as FlowType,
  studentId: '' as string,
  applyReason: '',
  // 休学 / 退学
  suspendStartDate: '',
  expectResumeDate: '',
  suspendReason: '',
  phone: '',
  attendedHours: undefined as number | undefined,
  // 退学 → 退费
  refundFeeType: 1 as number,
  refundAmountYuan: undefined as number | undefined,
  // 复学
  resumeClassId: '',
  resumeDate: '',
  // 转班 / 末班
  toClassId: '',
  toStage: undefined as number | undefined,
  transferReason: '',
  repeatReason: '',
  // 换人
  handoverRole: 1,
  fromUserId: '',
  toUserId: '',
  handoverReason: '',
  handoverContent: '',
  // 就业协议
  agreementStatus: 1,
  signDate: '',
  agreementFileUrl: '',
});

const rules = computed<FormRules>(() => {
  const r: FormRules = {
    flowType: [{ required: true, message: '请选择流程类型', trigger: 'change' }],
    studentId: [{ required: true, message: '请选择学生', trigger: 'change' }],
  };
  if (form.flowType === FlowType.QUIT) {
    r.refundAmountYuan = [{ required: true, message: '请填写退费金额', trigger: 'blur' }];
  }
  if (form.flowType === FlowType.REPEAT) {
    r.toClassId = [{ required: true, message: '请选择末班目标班级', trigger: 'change' }];
  }
  return r;
});

/** 退费类型选项（1~4，不含试学费） */
const refundFeeTypes = computed(() =>
  Object.entries(FEE_TYPE_NAME)
    .filter(([value]) => Number(value) <= 4)
    .map(([value, name]) => ({ value: Number(value), name })),
);

function reset() {
  formRef.value?.clearValidate();
  Object.assign(form, {
    flowType: props.defaultType || FlowType.SUSPEND,
    studentId: '',
    applyReason: '',
    suspendStartDate: '',
    expectResumeDate: '',
    suspendReason: '',
    phone: '',
    attendedHours: undefined,
    refundFeeType: 1,
    refundAmountYuan: undefined,
    resumeClassId: '',
    resumeDate: '',
    toClassId: '',
    toStage: undefined,
    transferReason: '',
    repeatReason: '',
    handoverRole: 1,
    fromUserId: '',
    toUserId: '',
    handoverReason: '',
    handoverContent: '',
    agreementStatus: 1,
    signDate: '',
    agreementFileUrl: '',
  });
}

async function loadBase() {
  try {
    const [studentsAll, cls] = await Promise.all([
      fetchAllPages((page, size) => fetchStudentList({ page, size })),
      fetchClassOptions(),
    ]);
    students.value = studentsAll;
    classOptions.value = cls;
  } catch {
    /* 错误已统一处理 */
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      reset();
      loadBase();
    }
  },
);

function buildPayload(): FlowSubmitPayload {
  const st = students.value.find((s) => s.studentId === form.studentId);
  const payload: FlowSubmitPayload = {
    flowType: form.flowType,
    studentId: form.studentId,
    studentNo: st?.studentNo,
    studentName: st?.studentName,
    classId: st?.classId,
    applyReason: form.applyReason || undefined,
  };
  if (form.flowType === FlowType.SUSPEND) {
    payload.suspendStartDate = form.suspendStartDate || undefined;
    payload.expectResumeDate = form.expectResumeDate || undefined;
    payload.suspendReason = form.suspendReason || undefined;
    payload.phone = form.phone || undefined;
    payload.attendedHours = form.attendedHours;
  } else if (form.flowType === FlowType.RESUME) {
    payload.resumeClassId = form.resumeClassId || undefined;
    payload.resumeDate = form.resumeDate || undefined;
  } else if (form.flowType === FlowType.TRANSFER) {
    payload.toClassId = form.toClassId || undefined;
    payload.fromClassId = st?.classId;
    payload.toStage = form.toStage;
    payload.fromStage = st?.stage;
    payload.transferReason = form.transferReason || undefined;
  } else if (form.flowType === FlowType.QUIT) {
    payload.suspendReason = form.suspendReason || undefined;
    payload.attendedHours = form.attendedHours;
    // ★ 退学 → 退费：元转分，审批通过后自动生成退费单
    payload.refundFeeType = form.refundFeeType;
    payload.refundAmount = Math.round((form.refundAmountYuan ?? 0) * 100);
  } else if (form.flowType === FlowType.HANDOVER) {
    payload.handoverRole = form.handoverRole;
    payload.fromUserId = form.fromUserId || undefined;
    payload.toUserId = form.toUserId || undefined;
    payload.handoverReason = form.handoverReason || undefined;
    payload.handoverContent = form.handoverContent || undefined;
  } else if (form.flowType === FlowType.AGREEMENT) {
    payload.agreementStatus = form.agreementStatus;
    payload.signDate = form.signDate || undefined;
    payload.agreementFileUrl = form.agreementFileUrl || undefined;
  } else if (form.flowType === FlowType.REPEAT) {
    payload.toClassId = form.toClassId || undefined;
    payload.applyReason = form.repeatReason || form.applyReason || undefined;
  }
  return payload;
}

async function handleSubmit() {
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) return;
  submitting.value = true;
  try {
    await submitFlow(buildPayload());
    ElMessage.success('流程已提交');
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
  <el-dialog v-model="visible" title="发起流程" width="600px" @closed="reset">
    <el-form ref="formRef" :model="form" :rules="rules" label-width="110px">
      <el-form-item label="流程类型" prop="flowType">
        <el-select v-model="form.flowType" style="width: 100%">
          <el-option v-for="(name, value) in FLOW_TYPE_NAME" :key="value" :label="name" :value="Number(value)" />
        </el-select>
      </el-form-item>
      <el-form-item label="学生" prop="studentId">
        <el-select v-model="form.studentId" filterable placeholder="请选择学生" style="width: 100%">
          <el-option
            v-for="s in students"
            :key="s.studentId"
            :label="`${s.studentNo} ${s.studentName}（${s.className || '无班级'}）`"
            :value="s.studentId"
          />
        </el-select>
      </el-form-item>

      <!-- 休学 -->
      <template v-if="form.flowType === FlowType.SUSPEND">
        <el-form-item label="休学开始日">
          <el-date-picker v-model="form.suspendStartDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
        <el-form-item label="预计复学日">
          <el-date-picker v-model="form.expectResumeDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
        <el-form-item label="休学原因">
          <el-input v-model="form.suspendReason" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="联系电话">
          <el-input v-model="form.phone" />
        </el-form-item>
        <el-form-item label="已修学时">
          <el-input-number v-model="form.attendedHours" :min="0" style="width: 100%" />
        </el-form-item>
      </template>

      <!-- 复学 -->
      <template v-else-if="form.flowType === FlowType.RESUME">
        <el-form-item label="复学班级">
          <el-select v-model="form.resumeClassId" placeholder="请选择班级" style="width: 100%">
            <el-option v-for="c in classOptions" :key="c.classId" :label="c.className" :value="c.classId" />
          </el-select>
        </el-form-item>
        <el-form-item label="复学日期">
          <el-date-picker v-model="form.resumeDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
      </template>

      <!-- 转班 -->
      <template v-else-if="form.flowType === FlowType.TRANSFER">
        <el-form-item label="转入班级">
          <el-select v-model="form.toClassId" placeholder="请选择班级" style="width: 100%">
            <el-option v-for="c in classOptions" :key="c.classId" :label="`${c.className}（${c.classStatusName}）`" :value="c.classId" />
          </el-select>
        </el-form-item>
        <el-form-item label="转入阶段">
          <el-select v-model="form.toStage" placeholder="请选择阶段" clearable style="width: 100%">
            <el-option v-for="(name, value) in STAGE_NAME" :key="value" :label="name" :value="Number(value)" />
          </el-select>
        </el-form-item>
        <el-form-item label="转班原因">
          <el-input v-model="form.transferReason" type="textarea" :rows="2" />
        </el-form-item>
      </template>

      <!-- 换人 -->
      <template v-else-if="form.flowType === FlowType.HANDOVER">
        <el-form-item label="交接岗位">
          <el-select v-model="form.handoverRole" style="width: 100%">
            <el-option v-for="(name, value) in HANDOVER_ROLE_NAME" :key="value" :label="name" :value="Number(value)" />
          </el-select>
        </el-form-item>
        <el-form-item label="原任用户ID">
          <el-input v-model="form.fromUserId" placeholder="原任用户ID" />
        </el-form-item>
        <el-form-item label="接管人用户ID">
          <el-input v-model="form.toUserId" placeholder="接管人用户ID" />
        </el-form-item>
        <el-form-item label="交接原因">
          <el-input v-model="form.handoverReason" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="交接内容">
          <el-input v-model="form.handoverContent" type="textarea" :rows="2" />
        </el-form-item>
      </template>

      <!-- 退学 -->
      <template v-else-if="form.flowType === FlowType.QUIT">
        <el-form-item label="退学原因">
          <el-input v-model="form.suspendReason" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="已修学时">
          <el-input-number v-model="form.attendedHours" :min="0" style="width: 100%" />
        </el-form-item>
        <el-form-item label="退费类型">
          <el-select v-model="form.refundFeeType" style="width: 100%">
            <el-option v-for="t in refundFeeTypes" :key="t.value" :label="t.name" :value="t.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="退费金额（元）" prop="refundAmountYuan">
          <el-input-number v-model="form.refundAmountYuan" :min="0.01" :precision="2" :step="100" style="width: 100%" />
        </el-form-item>
        <el-form-item>
          <span style="font-size: 12px; color: var(--el-text-color-secondary)">
            审批通过后自动生成「待提交」退费单，转入退费审批链。
          </span>
        </el-form-item>
      </template>

      <!-- 就业协议 -->
      <template v-else-if="form.flowType === FlowType.AGREEMENT">
        <el-form-item label="协议状态">
          <el-select v-model="form.agreementStatus" style="width: 100%">
            <el-option v-for="(name, value) in AGREEMENT_STATUS_NAME" :key="value" :label="name" :value="Number(value)" />
          </el-select>
        </el-form-item>
        <el-form-item label="签订日期">
          <el-date-picker v-model="form.signDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
        <el-form-item label="协议文件地址">
          <el-input v-model="form.agreementFileUrl" placeholder="文件 URL" />
        </el-form-item>
      </template>

      <!-- 末班 -->
      <template v-else-if="form.flowType === FlowType.REPEAT">
        <el-form-item label="末班目标班级">
          <el-select v-model="form.toClassId" placeholder="请选择班级" style="width: 100%">
            <el-option v-for="c in classOptions" :key="c.classId" :label="c.className" :value="c.classId" />
          </el-select>
        </el-form-item>
        <el-form-item label="末班原因">
          <el-input v-model="form.repeatReason" type="textarea" :rows="2" />
        </el-form-item>
      </template>

      <el-form-item label="备注">
        <el-input v-model="form.applyReason" type="textarea" :rows="2" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="handleSubmit">提交</el-button>
    </template>
  </el-dialog>
</template>
