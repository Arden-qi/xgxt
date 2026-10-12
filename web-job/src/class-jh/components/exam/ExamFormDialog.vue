<script setup lang="ts">
/**
 * 考试新增 / 编辑弹窗
 */

import { reactive, ref, watch, computed } from 'vue';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { Plus, Delete } from '@element-plus/icons-vue';
import { ExamType, EXAM_TYPE_NAME, EXAM_CONTENT_TYPE_NAME } from 'shared-types/class-jh';
import type { Exam, ClassInfo } from 'shared-types/class-jh';
import { addExam, updateExam, fetchExamDetail } from '@/class-jh/api/exam';
import { fetchClassOptions } from '@/class-jh/api/classInfo';

const props = defineProps<{
  modelValue: boolean;
  record?: Exam | null;
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
  examName: '',
  examType: ExamType.MONTHLY,
  examDate: '',
  classId: '' as string,
  examContentTypes: [1, 2] as number[],
  fullScore: 100,
  fields: [] as Array<{ fieldName: string; fieldType: number }>,
  remark: '',
});

const rules: FormRules = {
  examName: [{ required: true, message: '请输入考试名称', trigger: 'blur' }],
  examType: [{ required: true, message: '请选择考试类型', trigger: 'change' }],
  examDate: [{ required: true, message: '请选择考试日期', trigger: 'change' }],
  classId: [{ required: true, message: '请选择考试班级', trigger: 'change' }],
  examContentTypes: [{ required: true, type: 'array', message: '至少选择一个内容项', trigger: 'change' }],
};

function reset() {
  formRef.value?.clearValidate();
  Object.assign(form, {
    id: '',
    examName: '',
    examType: ExamType.MONTHLY,
    examDate: '',
    classId: '',
    examContentTypes: [1, 2],
    fullScore: 100,
    fields: [],
    remark: '',
  });
}

function addField() {
  form.fields.push({ fieldName: '', fieldType: 1 });
}
function removeField(index: number) {
  form.fields.splice(index, 1);
}

async function loadClassOptions() {
  try {
    classOptions.value = await fetchClassOptions({ excludeGraduated: false });
  } catch {
    /* 错误已统一处理 */
  }
}

watch(
  () => props.modelValue,
  async (open) => {
    if (!open) return;
    reset();
    loadClassOptions();
    if (!props.record) return;
    const rec = props.record;
    const firstFull = Number(Object.values(rec.contentFullScore || {})[0]);
    Object.assign(form, {
      id: rec.examId,
      examName: rec.examName,
      examType: rec.examType,
      examDate: rec.examDate ? String(rec.examDate).slice(0, 10) : '',
      classId: rec.classId,
      examContentTypes: rec.examContentTypes?.length ? [...rec.examContentTypes] : [1, 2],
      fullScore: firstFull > 0 ? firstFull : 100,
      fields: [],
      remark: rec.remark || '',
    });
    // ⚠️ 必须回填已有自定义字段：后端保存是「先删旧再插新」，
    //    若编辑时不带旧字段，一保存就会把原自定义字段全清掉（成绩管理里对应的列也会消失）。
    try {
      const detail = await fetchExamDetail(rec.examId);
      form.fields = (detail.fields || []).map((f) => ({ fieldName: f.fieldName, fieldType: f.fieldType }));
    } catch {
      form.fields = [];
    }
  },
);

async function handleSubmit() {
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) return;
  submitting.value = true;
  try {
    const contentFullScore: Record<string, number> = {};
    form.examContentTypes.forEach((t) => {
      contentFullScore[String(t)] = form.fullScore;
    });
    const payload = {
      examName: form.examName,
      examType: form.examType,
      examDate: form.examDate,
      classId: form.classId,
      examContentTypes: [...form.examContentTypes],
      contentFullScore,
      customFields: form.fields
        .filter((f) => f.fieldName)
        .map((f, i) => ({ fieldName: f.fieldName, fieldType: f.fieldType, sortNo: i })),
      remark: form.remark || undefined,
    };
    if (isEdit.value) {
      await updateExam({ ...payload, id: form.id });
      ElMessage.success('修改成功');
    } else {
      await addExam(payload);
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
  <el-dialog v-model="visible" :title="isEdit ? '编辑考试' : '新增考试'" width="680px" @closed="reset">
    <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
      <el-row :gutter="16">
        <el-col :span="12">
          <el-form-item label="考试名称" prop="examName">
            <el-input v-model="form.examName" placeholder="如 2026年10月月考" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="考试类型" prop="examType">
            <el-select v-model="form.examType" style="width: 100%">
              <el-option v-for="(name, value) in EXAM_TYPE_NAME" :key="value" :label="name" :value="Number(value)" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="考试日期" prop="examDate">
            <el-date-picker v-model="form.examDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="考试班级" prop="classId">
            <el-select v-model="form.classId" style="width: 100%">
              <el-option v-for="c in classOptions" :key="c.classId" :label="c.className" :value="c.classId" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="内容项" prop="examContentTypes">
            <el-select v-model="form.examContentTypes" multiple style="width: 100%">
              <el-option
                v-for="(name, value) in EXAM_CONTENT_TYPE_NAME"
                :key="value"
                :label="name"
                :value="Number(value)"
              />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="单科满分">
            <el-input-number v-model="form.fullScore" :min="1" :max="1000" style="width: 100%" />
          </el-form-item>
        </el-col>
        <el-col :span="24">
          <el-form-item label="自定义字段">
            <div class="field-list">
              <div v-for="(f, idx) in form.fields" :key="idx" class="field-row">
                <el-input v-model="f.fieldName" placeholder="字段名" style="width: 200px" />
                <el-select v-model="f.fieldType" style="width: 120px">
                  <el-option label="纯文字" :value="1" />
                  <el-option label="数字" :value="2" />
                </el-select>
                <el-button :icon="Delete" circle type="danger" size="small" @click="removeField(idx)" />
              </div>
              <el-button :icon="Plus" size="small" @click="addField">添加字段</el-button>
            </div>
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

<style scoped>
.field-list {
  width: 100%;
}
.field-row {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
</style>
