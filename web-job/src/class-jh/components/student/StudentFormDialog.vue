<script setup lang="ts">
/**
 * 学生新增 / 编辑弹窗
 *
 * 用法：<StudentFormDialog v-model="visible" :record="editRow" @success="loadData" />
 */

import { reactive, ref, watch, computed } from 'vue';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import {
  Gender,
  AgreementStatus,
  DEPT_NAME,
  STAGE_NAME,
  AGREEMENT_STATUS_NAME,
} from 'shared-types/class-jh';
import type { StudentListItem, ClassInfo } from 'shared-types/class-jh';
import { addStudent, updateStudent } from '@/class-jh/api/student';
import { fetchClassOptions } from '@/class-jh/api/classInfo';

const props = defineProps<{
  modelValue: boolean;
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

const isEdit = computed(() => !!props.record);

const formRef = ref<FormInstance>();
const submitting = ref(false);
const classOptions = ref<ClassInfo[]>([]);

const form = reactive({
  id: '',
  studentNo: '',
  studentName: '',
  gender: Gender.MALE,
  birthDate: '',
  nativePlace: '',
  deptCode: 1,
  classId: '' as string,
  stage: undefined as number | undefined,
  education: '',
  graduateSchool: '',
  enrollDate: '',
  phone: '',
  parentPhone: '',
  homeAddress: '',
  idCardNo: '',
  agreementStatus: AgreementStatus.UNSIGNED,
  remark: '',
  literacyDesc: '',
});

const rules: FormRules = {
  studentName: [{ required: true, message: '请输入姓名', trigger: 'blur' }],
  gender: [{ required: true, message: '请选择性别', trigger: 'change' }],
  phone: [{ pattern: /^1[3-9]\d{9}$/, message: '手机号格式不正确', trigger: 'blur' }],
};

function reset() {
  formRef.value?.clearValidate();
  Object.assign(form, {
    id: '',
    studentNo: '',
    studentName: '',
    gender: Gender.MALE,
    birthDate: '',
    nativePlace: '',
    deptCode: 1,
    classId: '',
    stage: undefined,
    education: '',
    graduateSchool: '',
    enrollDate: '',
    phone: '',
    parentPhone: '',
    homeAddress: '',
    idCardNo: '',
    agreementStatus: AgreementStatus.UNSIGNED,
    remark: '',
    literacyDesc: '',
  });
}

async function loadClassOptions() {
  if (classOptions.value.length) return;
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
    loadClassOptions();
    if (props.record) {
      Object.assign(form, {
        id: props.record.studentId,
        studentNo: props.record.studentNo,
        studentName: props.record.studentName,
        gender: props.record.gender,
        birthDate: '',
        nativePlace: '',
        deptCode: props.record.deptCode,
        classId: props.record.classId || '',
        stage: props.record.stage ?? undefined,
        education: props.record.education || '',
        graduateSchool: '',
        enrollDate: props.record.enrollDate || '',
        phone: props.record.phone || '',
        parentPhone: props.record.parentPhone || '',
        homeAddress: '',
        idCardNo: '',
        agreementStatus: AgreementStatus.UNSIGNED,
        remark: props.record.remark || '',
        literacyDesc: props.record.literacyDesc || '',
      });
    } else {
      reset();
    }
  },
);

async function handleSubmit() {
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) return;
  submitting.value = true;
  try {
    const payload = { ...form };
    if (isEdit.value) {
      await updateStudent(payload);
      ElMessage.success('修改成功');
    } else {
      await addStudent(payload);
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
  <el-dialog v-model="visible" :title="isEdit ? '编辑学生' : '新增学生'" width="720px" @closed="reset">
    <el-form ref="formRef" :model="form" :rules="rules" label-width="96px">
      <el-row :gutter="16">
        <el-col :span="12">
          <el-form-item label="学号">
            <el-input v-model="form.studentNo" placeholder="留空则由系统生成" :disabled="isEdit" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="姓名" prop="studentName">
            <el-input v-model="form.studentName" placeholder="请输入姓名" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="性别" prop="gender">
            <el-radio-group v-model="form.gender">
              <el-radio :value="Gender.MALE">男</el-radio>
              <el-radio :value="Gender.FEMALE">女</el-radio>
            </el-radio-group>
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="出生日期">
            <el-date-picker v-model="form.birthDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="部门">
            <el-select v-model="form.deptCode" style="width: 100%">
              <el-option v-for="(name, value) in DEPT_NAME" :key="value" :label="name" :value="Number(value)" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="班级">
            <el-select v-model="form.classId" clearable placeholder="可不选" style="width: 100%">
              <el-option
                v-for="c in classOptions"
                :key="c.classId"
                :label="`${c.className}（${c.stageName}）`"
                :value="c.classId"
              />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="学习阶段">
            <el-select v-model="form.stage" clearable placeholder="可不选" style="width: 100%">
              <el-option v-for="(name, value) in STAGE_NAME" :key="value" :label="name" :value="Number(value)" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="入学时间">
            <el-date-picker v-model="form.enrollDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="学历">
            <el-input v-model="form.education" placeholder="如 初中 / 高中" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="毕业院校">
            <el-input v-model="form.graduateSchool" placeholder="请输入毕业院校" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="手机号" prop="phone">
            <el-input v-model="form.phone" placeholder="学生手机号" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="家长手机号">
            <el-input v-model="form.parentPhone" placeholder="家长手机号" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="身份证号">
            <el-input v-model="form.idCardNo" placeholder="请输入身份证号" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="籍贯">
            <el-input v-model="form.nativePlace" placeholder="请输入籍贯" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="就业协议">
            <el-select v-model="form.agreementStatus" style="width: 100%">
              <el-option
                v-for="(name, value) in AGREEMENT_STATUS_NAME"
                :key="value"
                :label="name"
                :value="Number(value)"
              />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="24">
          <el-form-item label="家庭住址">
            <el-input v-model="form.homeAddress" placeholder="请输入家庭住址" />
          </el-form-item>
        </el-col>
        <el-col :span="24">
          <el-form-item label="综合素养">
            <el-input v-model="form.literacyDesc" type="textarea" :rows="2" placeholder="综合素养描述" />
          </el-form-item>
        </el-col>
        <el-col :span="24">
          <el-form-item label="备注">
            <el-input v-model="form.remark" type="textarea" :rows="2" placeholder="特殊心理问题、家庭变故等" />
          </el-form-item>
        </el-col>
      </el-row>
    </el-form>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="handleSubmit">确定</el-button>
    </template>
  </el-dialog>
</template>
