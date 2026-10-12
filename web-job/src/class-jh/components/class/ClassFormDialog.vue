<script setup lang="ts">
/**
 * 班级新增 / 编辑弹窗
 */

import { reactive, ref, watch, computed } from 'vue';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { ClassStatus, DEPT_NAME, STAGE_NAME, CLASS_STATUS_NAME } from 'shared-types/class-jh';
import type { ClassInfo } from 'shared-types/class-jh';
import { addClass, updateClass } from '@/class-jh/api/classInfo';

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
const isEdit = computed(() => !!props.record);

const formRef = ref<FormInstance>();
const submitting = ref(false);

const form = reactive({
  id: '',
  className: '',
  stage: 102,
  headTeacherId: '',
  headTeacherName: '',
  teacherId: '',
  teacherName: '',
  assistantId: '',
  assistantName: '',
  classroom: '',
  openDate: '',
  deptCode: 1,
  classStatus: ClassStatus.OPEN,
  remark: '',
});

const rules: FormRules = {
  className: [{ required: true, message: '请输入班级名称', trigger: 'blur' }],
  stage: [{ required: true, message: '请选择学习阶段', trigger: 'change' }],
  headTeacherId: [{ required: true, message: '请输入班主任', trigger: 'blur' }],
  headTeacherName: [{ required: true, message: '请输入班主任姓名', trigger: 'blur' }],
  teacherId: [{ required: true, message: '请输入教员', trigger: 'blur' }],
  teacherName: [{ required: true, message: '请输入教员姓名', trigger: 'blur' }],
};

function reset() {
  formRef.value?.clearValidate();
  Object.assign(form, {
    id: '',
    className: '',
    stage: 102,
    headTeacherId: '',
    headTeacherName: '',
    teacherId: '',
    teacherName: '',
    assistantId: '',
    assistantName: '',
    classroom: '',
    openDate: '',
    deptCode: 1,
    classStatus: ClassStatus.OPEN,
    remark: '',
  });
}

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    reset();
    if (props.record) {
      Object.assign(form, {
        id: props.record.classId,
        className: props.record.className,
        stage: props.record.stage,
        headTeacherId: props.record.headTeacherId,
        headTeacherName: props.record.headTeacherName,
        teacherId: props.record.teacherId,
        teacherName: props.record.teacherName,
        assistantId: props.record.assistantId || '',
        assistantName: props.record.assistantName || '',
        classroom: props.record.classroom || '',
        openDate: props.record.openDate || '',
        deptCode: props.record.deptCode,
        classStatus: props.record.classStatus,
        remark: props.record.remark || '',
      });
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
      await updateClass(payload);
      ElMessage.success('修改成功');
    } else {
      await addClass(payload);
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
  <el-dialog v-model="visible" :title="isEdit ? '编辑班级' : '新增班级'" width="680px" @closed="reset">
    <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
      <el-row :gutter="16">
        <el-col :span="12">
          <el-form-item label="班级名称" prop="className">
            <el-input v-model="form.className" placeholder="如 G104" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="学习阶段" prop="stage">
            <el-select v-model="form.stage" style="width: 100%">
              <el-option v-for="(name, value) in STAGE_NAME" :key="value" :label="name" :value="Number(value)" />
            </el-select>
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
          <el-form-item label="班级状态">
            <el-select v-model="form.classStatus" style="width: 100%">
              <el-option
                v-for="(name, value) in CLASS_STATUS_NAME"
                :key="value"
                :label="name"
                :value="Number(value)"
              />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="班主任" prop="headTeacherId">
            <el-input v-model="form.headTeacherId" placeholder="班主任 ID" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="班主任姓名" prop="headTeacherName">
            <el-input v-model="form.headTeacherName" placeholder="班主任姓名" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="教员" prop="teacherId">
            <el-input v-model="form.teacherId" placeholder="教员 ID" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="教员姓名" prop="teacherName">
            <el-input v-model="form.teacherName" placeholder="教员姓名" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="助教">
            <el-input v-model="form.assistantId" placeholder="助教 ID（可选）" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="助教姓名">
            <el-input v-model="form.assistantName" placeholder="助教姓名（可选）" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="教室">
            <el-input v-model="form.classroom" placeholder="如 101" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="开班日期">
            <el-date-picker v-model="form.openDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
          </el-form-item>
        </el-col>
        <el-col :span="24">
          <el-form-item label="备注">
            <el-input v-model="form.remark" type="textarea" :rows="2" />
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
