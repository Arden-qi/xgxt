<script setup lang="ts">
/**
 * 结业成绩审批弹窗（经理决定每名学生 isPassed）
 *
 * ⚠️ 审批基于已录入的成绩（examScore 列表），逐生调用 approveExam。
 */

import { ref, watch, computed } from 'vue';
import { ElMessage } from 'element-plus';
import type { Exam, ExamScore } from 'shared-types/class-jh';
import { fetchExamScoreList, approveExam } from '@/class-jh/api/exam';
import { fetchAllPages } from '@/class-jh/utils/fetchAll';

const props = defineProps<{
  modelValue: boolean;
  exam?: Exam | null;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void;
  (e: 'success'): void;
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
});

/**
 * 结业审批行
 *
 * ⚠️ 铁律：不许自造 interface —— 从 shared-types 的 ExamScore 派生（Pick 出本页需要的字段）。
 *    字段名若与后端不一致，编译期就会报错。
 */
type ApproveRow = Pick<
  ExamScore,
  'studentId' | 'studentNo' | 'studentName' | 'scoreTotal' | 'examResult' | 'examResultName' | 'isPassed'
>;

const loading = ref(false);
const submitting = ref(false);
const rows = ref<ApproveRow[]>([]);

async function loadData() {
  if (!props.exam) return;
  const exam = props.exam;
  loading.value = true;
  try {
    const list = await fetchAllPages((page, size) => fetchExamScoreList({ examId: exam.examId, page, size }));
    rows.value = list.map((s) => ({
      studentId: s.studentId,
      studentNo: s.studentNo,
      studentName: s.studentName,
      scoreTotal: s.scoreTotal,
      examResult: s.examResult,
      examResultName: s.examResultName,
      isPassed: s.isPassed,
    }));
  } catch {
    rows.value = [];
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) loadData();
  },
);

function setAll(passed: boolean) {
  rows.value.forEach((r) => {
    r.isPassed = passed;
  });
}

async function handleSubmit() {
  if (!props.exam) return;
  const targets = rows.value.filter((r) => r.isPassed !== undefined && r.isPassed !== null);
  if (!targets.length) {
    ElMessage.warning('请先为至少一名学生选择审批结果');
    return;
  }
  submitting.value = true;
  try {
    for (const r of targets) {
      await approveExam({ examId: props.exam.examId, studentId: r.studentId, isPassed: r.isPassed as boolean });
    }
    ElMessage.success(`已完成 ${targets.length} 名学生的结业审批`);
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
  <el-dialog v-model="visible" title="结业成绩审批" width="720px">
    <el-descriptions v-if="exam" :column="2" border class="mb12" size="small">
      <el-descriptions-item label="考试名称">{{ exam.examName }}</el-descriptions-item>
      <el-descriptions-item label="考试班级">{{ exam.className }}</el-descriptions-item>
    </el-descriptions>

    <div class="toolbar">
      <el-button size="small" @click="setAll(true)">全部通过</el-button>
      <el-button size="small" @click="setAll(false)">全部未通过</el-button>
    </div>

    <el-table v-loading="loading" :data="rows" border stripe size="small" empty-text="暂无成绩，请先录入" max-height="420">
      <el-table-column type="index" label="序号" width="55" align="center" />
      <el-table-column prop="studentNo" label="学号" width="120" />
      <el-table-column prop="studentName" label="姓名" width="90" />
      <el-table-column label="总分" width="90" align="center">
        <template #default="{ row }">{{ row.scoreTotal ?? '—' }}</template>
      </el-table-column>
      <el-table-column label="系统判定" width="110" align="center">
        <template #default="{ row }">
          <el-tag :type="row.examResult === 1 ? 'success' : 'danger'" size="small" v-if="row.examResultName">
            {{ row.examResultName }}
          </el-tag>
          <span v-else>—</span>
        </template>
      </el-table-column>
      <el-table-column label="结业审批" min-width="160" align="center">
        <template #default="{ row }">
          <el-radio-group v-model="row.isPassed" size="small">
            <el-radio :value="true">通过</el-radio>
            <el-radio :value="false">未通过</el-radio>
          </el-radio-group>
        </template>
      </el-table-column>
    </el-table>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="handleSubmit">提交审批</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.mb12 {
  margin-bottom: 12px;
}
.toolbar {
  margin-bottom: 8px;
}
</style>
