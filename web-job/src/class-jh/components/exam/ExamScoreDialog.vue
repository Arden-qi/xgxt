<script setup lang="ts">
/**
 * 成绩录入弹窗
 *
 * 按学生逐条录入各内容项得分（笔试/机试/面试/其他）。
 * ⚠️ 只录入原始分，总分与 examResult 由后端自动判定。
 * ⚠️ 先拉「考试班级学生」做骨架，再合并「已有成绩」，保证无成绩的学生也能录入。
 */

import { ref, watch, computed } from 'vue';
import { ElMessage } from 'element-plus';
import { ExamContentType } from 'shared-types/class-jh';
import type { Exam, ExamScoreSaveItem, ExamScore, StudentListItem } from 'shared-types/class-jh';
import { fetchExamScoreList, saveExamScores } from '@/class-jh/api/exam';
import { fetchStudentList } from '@/class-jh/api/student';
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
 * 成绩录入行
 *
 * ⚠️ 铁律：不许自造 interface —— 从 shared-types 派生：
 *    学生身份字段取 StudentListItem，分数项取 ExamScore。
 */
type ScoreRow = Pick<StudentListItem, 'studentId' | 'studentNo' | 'studentName'> &
  Pick<ExamScore, 'scoreWritten' | 'scoreMachine' | 'scoreInterview' | 'scoreOther'>;

const loading = ref(false);
const submitting = ref(false);
const rows = ref<ScoreRow[]>([]);

/** 考试是否包含某内容项 */
function hasContent(type: number): boolean {
  return (props.exam?.examContentTypes || []).includes(type);
}

async function loadData() {
  if (!props.exam) return;
  const exam = props.exam;
  loading.value = true;
  try {
    // ⚠️ 后端 size 上限 100，必须分页取全（以前写 size:500 会被 40000 拒绝 → 弹窗空白）
    const [students, scores] = await Promise.all([
      fetchAllPages((page, size) => fetchStudentList({ classId: exam.classId, page, size })),
      fetchAllPages((page, size) => fetchExamScoreList({ examId: exam.examId, page, size })),
    ]);
    const byStudent = new Map(scores.map((s) => [s.studentId, s]));

    rows.value = students.map((st) => {
      const s = byStudent.get(st.studentId);
      return {
        studentId: st.studentId,
        studentNo: st.studentNo,
        studentName: st.studentName,
        scoreWritten: s?.scoreWritten,
        scoreMachine: s?.scoreMachine,
        scoreInterview: s?.scoreInterview,
        scoreOther: s?.scoreOther,
      };
    });
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

async function handleSubmit() {
  if (!props.exam) return;
  submitting.value = true;
  try {
    const scores: ExamScoreSaveItem[] = rows.value.map((r) => ({
      studentId: r.studentId,
      scoreWritten: r.scoreWritten,
      scoreMachine: r.scoreMachine,
      scoreInterview: r.scoreInterview,
      scoreOther: r.scoreOther,
    }));
    const res = await saveExamScores({
      examId: props.exam.examId,
      classId: props.exam.classId,
      scores,
    });
    ElMessage.success(`已保存 ${res.saved} 条成绩`);
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
  <el-dialog v-model="visible" title="成绩录入" width="820px">
    <el-descriptions v-if="exam" :column="2" border class="mb12" size="small">
      <el-descriptions-item label="考试名称">{{ exam.examName }}</el-descriptions-item>
      <el-descriptions-item label="考试班级">{{ exam.className }}</el-descriptions-item>
      <el-descriptions-item label="考试日期">{{ exam.examDate }}</el-descriptions-item>
      <el-descriptions-item label="考试类型">{{ exam.examTypeName }}</el-descriptions-item>
    </el-descriptions>

    <el-table v-loading="loading" :data="rows" border stripe size="small" empty-text="该班级暂无学生" max-height="420">
      <el-table-column type="index" label="序号" width="55" align="center" />
      <el-table-column prop="studentNo" label="学号" width="120" />
      <el-table-column prop="studentName" label="姓名" width="90" />
      <el-table-column v-if="hasContent(ExamContentType.WRITTEN)" label="笔试" width="110" align="center">
        <template #default="{ row }">
          <el-input-number v-model="row.scoreWritten" :min="0" :max="1000" :controls="false" style="width: 90px" />
        </template>
      </el-table-column>
      <el-table-column v-if="hasContent(ExamContentType.MACHINE)" label="机试" width="110" align="center">
        <template #default="{ row }">
          <el-input-number v-model="row.scoreMachine" :min="0" :max="1000" :controls="false" style="width: 90px" />
        </template>
      </el-table-column>
      <el-table-column v-if="hasContent(ExamContentType.INTERVIEW)" label="面试" width="110" align="center">
        <template #default="{ row }">
          <el-input-number v-model="row.scoreInterview" :min="0" :max="1000" :controls="false" style="width: 90px" />
        </template>
      </el-table-column>
      <el-table-column v-if="hasContent(ExamContentType.OTHER)" label="其他" width="110" align="center">
        <template #default="{ row }">
          <el-input-number v-model="row.scoreOther" :min="0" :max="1000" :controls="false" style="width: 90px" />
        </template>
      </el-table-column>
    </el-table>

    <el-text type="info" size="small" class="mt8">总分与是否通过（examResult）由后端按内容项自动判定。</el-text>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="handleSubmit">保存成绩</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.mb12 {
  margin-bottom: 12px;
}
.mt8 {
  display: block;
  margin-top: 8px;
}
</style>
