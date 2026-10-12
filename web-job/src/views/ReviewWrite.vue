<script setup lang="ts">
/**
 * 复盘填写
 *
 * 脑图 - 界面字段：姓名 / 工资 / 岗位 / 面试结论 / 复盘结论
 * 脑图 - 操作：新建 / 编辑 / 详情 / 搜索·筛选 / 上传录音
 *
 * ⚠️ 录音处理：前端把音频读成 base64 dataURL 提交，后端存文本字段。
 *    另外提供浏览器直接录音（MediaRecorder），不支持的浏览器自动隐藏按钮。
 */

import { ref, reactive, onMounted, computed, watch } from 'vue';
import { canAct } from '@/store/permission';
import {
  ElMessage,
  ElMessageBox,
  type FormInstance,
  type FormRules,
  type UploadRequestOptions,
} from 'element-plus';
import { Search, Refresh, Plus, Microphone, Upload } from '@element-plus/icons-vue';
import {
  INTERVIEW_CONCLUSION_NAME,
  REVIEW_CONCLUSION_NAME,
  InterviewConclusion,
  ReviewConclusion,
} from 'shared-types';
import {
  fetchReviewList,
  fetchReviewDetail,
  addReview,
  updateReview,
  deleteReview,
  removeReviewAudio,
} from '@/api/review';
import StudentSelect from '@/components/StudentSelect.vue';
// ★ 2026-10-02：复盘结论选「已签约入职」时，联动把学生标记为「已就业」
import { confirmEmployment } from '@/api/student';

/** 录音单文件大小上限 */
const AUDIO_MAX_SIZE = 8 * 1024 * 1024;

function nowStr() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ============ 列表 ============ */

const loading = ref(false);
const tableData = ref<any[]>([]);
const total = ref(0);

const query = reactive<any>({
  page: 1,
  size: 20,
  studentName: '',
  position: '',
  interviewConclusion: undefined,
  reviewConclusion: undefined,
  startDate: '',
  endDate: '',
});

async function loadData() {
  loading.value = true;
  try {
    const data = await fetchReviewList(query);
    tableData.value = data.list;
    total.value = data.total;
  } catch (e) {
    console.error(e);
  } finally {
    loading.value = false;
  }
}

function handleSearch() {
  query.page = 1;
  loadData();
}

function handleReset() {
  query.page = 1;
  query.studentName = '';
  query.position = '';
  query.interviewConclusion = undefined;
  query.reviewConclusion = undefined;
  query.startDate = '';
  query.endDate = '';
  loadData();
}

/* ============ 详情 ============ */

const detailVisible = ref(false);
const detailLoading = ref(false);
const detail = ref<any>({});

async function handleDetail(row: any) {
  detailVisible.value = true;
  detailLoading.value = true;
  detail.value = {};
  try {
    detail.value = await fetchReviewDetail(row.id);
  } catch (e) {
    console.error(e);
  } finally {
    detailLoading.value = false;
  }
}

/* ============ 新增 / 编辑 ============ */

const dialogVisible = ref(false);
const isEdit = ref(false);
const submitting = ref(false);
const formRef = ref<FormInstance>();

const defaultForm = {
  id: '',
  studentId: '',
  studentName: '',
  reviewTime: nowStr(),
  interviewTime: '',
  position: '',
  salary: undefined as number | undefined,
  interviewConclusion: undefined as number | undefined,
  reviewConclusion: undefined as number | undefined,
  audioName: '',
  audioData: '',
  detail: '',
};

const form = reactive({ ...defaultForm });
const studentLabel = ref('');

/* ★ 2026-10-02（斌哥）：面试结论选「已发 offer」→ 复盘结论**只能**是「已签约入职」
 *
 * 【为什么要锁】
 *   发了 offer 基本就等于签约了，两个字段自由填容易出现
 *   「已发 offer + 保持当前策略」这种自相矛盾的记录。
 *
 * 【交互】选了 offer → 自动选中「已签约入职」并锁住（其它项禁用、下拉禁点）；
 *         取消 offer → 解锁，恢复自由选。
 * 【后端也有兜底校验】传了别的组合会被拒（防止绕过前端）。
 */
const reviewLocked = computed(() => form.interviewConclusion === InterviewConclusion.OFFER);

watch(
  () => form.interviewConclusion,
  (v) => {
    if (v === InterviewConclusion.OFFER) {
      form.reviewConclusion = ReviewConclusion.SIGNED;
    }
  },
);

const rules: FormRules = {
  studentId: [{ required: true, message: '请选择学生', trigger: 'change' }],
  reviewTime: [{ required: true, message: '请选择复盘时间', trigger: 'change' }],
};

function handleAdd() {
  isEdit.value = false;
  Object.assign(form, defaultForm, { reviewTime: nowStr() });
  studentLabel.value = '';
  dialogVisible.value = true;
}

async function handleEdit(row: any) {
  isEdit.value = true;
  try {
    const data = await fetchReviewDetail(row.id);
    Object.assign(form, {
      id: data.id,
      studentId: data.studentId,
      studentName: data.studentName,
      reviewTime: data.reviewTime,
      interviewTime: data.interviewTime || '',
      position: data.position || '',
      salary: data.salary,
      interviewConclusion: data.interviewConclusion,
      reviewConclusion: data.reviewConclusion,
      audioName: data.audioName || '',
      audioData: data.audioData || '',
      detail: data.detail || '',
    });
    studentLabel.value = data.studentName;
    dialogVisible.value = true;
  } catch (e) {
    console.error(e);
  }
}

function onStudentChange(id: string, name: string) {
  form.studentId = id;
  form.studentName = name;
}

/* ============ 录音：上传文件 ============ */

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('读取失败'));
    reader.readAsDataURL(file);
  });
}

const audioUploading = ref(false);

async function handleAudioUpload(options: UploadRequestOptions) {
  const file = options.file as File;
  if (file.size > AUDIO_MAX_SIZE) {
    ElMessage.warning(`录音不能超过 8MB，当前 ${(file.size / 1024 / 1024).toFixed(2)}MB`);
    return;
  }
  audioUploading.value = true;
  try {
    form.audioData = await readAsDataUrl(file);
    form.audioName = file.name;
    ElMessage.success('录音已就绪，点「确定」保存');
  } catch (e) {
    ElMessage.error('录音读取失败');
  } finally {
    audioUploading.value = false;
  }
}

function removeAudio() {
  form.audioName = '';
  form.audioData = '';
}

/* ============ 录音：浏览器直接录 ============ */

const recording = ref(false);
const recordSeconds = ref(0);
let recorder: MediaRecorder | null = null;
let chunks: BlobPart[] = [];
let timer: number | undefined;

/** 浏览器不支持录音就隐藏按钮，不要让功能点了没反应 */
const canRecord = computed(
  () => typeof window !== 'undefined' && !!window.MediaRecorder && !!navigator.mediaDevices,
);

async function toggleRecord() {
  if (recording.value) {
    recorder?.stop();
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'audio/webm' });
      const reader = new FileReader();
      reader.onload = () => {
        form.audioData = reader.result as string;
        form.audioName = `面谈录音_${nowStr().replace(/[-: ]/g, '')}.webm`;
        ElMessage.success(`录音完成（${recordSeconds.value} 秒），点「确定」保存`);
      };
      reader.readAsDataURL(blob);
      stream.getTracks().forEach((t) => t.stop());
      recording.value = false;
      window.clearInterval(timer);
      recordSeconds.value = 0;
    };
    recorder.start();
    recording.value = true;
    recordSeconds.value = 0;
    timer = window.setInterval(() => {
      recordSeconds.value += 1;
    }, 1000);
  } catch (e) {
    ElMessage.warning('无法访问麦克风，请检查浏览器权限后改用「上传录音」');
  }
}

/* ============ 提交 ============ */

async function handleSubmit() {
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) return;

  submitting.value = true;
  try {
    const payload = {
      id: form.id,
      studentId: form.studentId,
      reviewTime: form.reviewTime,
      interviewTime: form.interviewTime || undefined,
      position: form.position || undefined,
      salary: form.salary || undefined,
      interviewConclusion: form.interviewConclusion || undefined,
      reviewConclusion: form.reviewConclusion || undefined,
      audioName: form.audioName || undefined,
      audioData: form.audioData || undefined,
      detail: form.detail || undefined,
    };

    // ⚠️ 拿到 offer 时后端会自动落一条就业通知（t_notification），此处无需前端动作

    let suggestEmploy = false;
    if (isEdit.value) {
      const r = await updateReview(payload as any);
      suggestEmploy = !!r?.suggestEmploy;
      ElMessage.success('修改成功');
    } else {
      const r = await addReview(payload as any);
      suggestEmploy = !!r?.suggestEmploy;
      ElMessage.success('新增成功');
    }

    const sid = form.studentId;
    const sname = form.studentName;

    dialogVisible.value = false;
    loadData();

    // ★ 2026-10-02：选了「复盘结论 = 已签约入职」→ 问一句要不要把学生标记为「已就业」
    //   （后端只在"学生还在待就业"时才回 true，所以不会对已就业的重复问）
    if (suggestEmploy) {
      await askConfirmEmploy(sid, sname);
    }
  } catch (e) {
    // 统一处理
  } finally {
    submitting.value = false;
  }
}

/**
 * ★ 2026-10-02 新增：复盘选了「已签约入职」，提示是否同步标记为「已就业」
 *
 * 【为什么不直接自动改】
 *   自动改状态等于"悄悄改错也没人知道"。这里让老师点一下 —— 选错了当场能看见。
 *   （斌哥定的方案 C：复盘提示 + 手工按钮，两条路都留）
 */
async function askConfirmEmploy(studentId: string, studentName: string): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `复盘结论为「已签约入职」。<br/>要把 <b>${studentName}</b> 的状态从「待就业」改为「已就业」吗？<br/><br/>` +
        `<span style="color:#8f959e">确认后会同时写一条就业日志（入职记录）。</span>`,
      '确认就业',
      {
        type: 'warning',
        dangerouslyUseHTMLString: true,
        confirmButtonText: '标记为已就业',
        cancelButtonText: '暂不',
      },
    );
  } catch {
    return; // 老师选了「暂不」
  }

  const t = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const today = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;

  try {
    await confirmEmployment({
      studentId,
      hireDate: today,
      remark: '由复盘「已签约入职」联动标记（入职日期默认取当天，可在学员档案里修正）',
    });
    ElMessage.success('已标记为「已就业」');
  } catch {
    // 错误提示由请求层统一弹（如"该生不是待就业"）
  }
}

async function handleDelete(row: any) {
  try {
    await ElMessageBox.confirm(
      `确定删除「${row.studentName}」${row.reviewTime} 的复盘记录吗？`,
      '删除确认',
      { type: 'warning', confirmButtonText: '确定删除', cancelButtonText: '取消' },
    );
  } catch {
    return;
  }
  try {
    await deleteReview(row.id);
    ElMessage.success('删除成功');
    loadData();
  } catch (e) {
    // 统一处理
  }
}

async function handleRemoveAudio(row: any) {
  try {
    await ElMessageBox.confirm('确定删除该复盘的录音吗？复盘正文会保留。', '删除录音', {
      type: 'warning',
      confirmButtonText: '确定删除',
      cancelButtonText: '取消',
    });
  } catch {
    return;
  }
  try {
    await removeReviewAudio(row.id);
    ElMessage.success('录音已删除');
    loadData();
  } catch (e) {
    // 统一处理
  }
}

/* ============ 展示辅助 ============ */

function reviewTagType(v?: number) {
  if (v === ReviewConclusion.SIGNED) return 'success';
  if (v === ReviewConclusion.ADJUST) return 'warning';
  if (v === ReviewConclusion.IMPROVE) return 'danger';
  return 'info';
}

function interviewTagType(v?: number) {
  if (v === InterviewConclusion.OFFER) return 'success';
  if (v === InterviewConclusion.PASS) return 'primary';
  if (v === InterviewConclusion.FAIL) return 'danger';
  return 'info';
}

function money(v?: number) {
  return v ? `¥${Number(v).toLocaleString()}` : '—';
}

onMounted(loadData);
</script>

<template>
  <div class="page-container">
    <!-- ============ 搜索/筛选 ============ -->
    <el-card shadow="never" class="search-card">
      <el-form :model="query" inline>
        <el-form-item label="姓名">
          <el-input v-model="query.studentName" placeholder="请输入姓名" clearable style="width: 150px" @keyup.enter="handleSearch" />
        </el-form-item>
        <el-form-item label="岗位">
          <el-input v-model="query.position" placeholder="请输入岗位" clearable style="width: 150px" @keyup.enter="handleSearch" />
        </el-form-item>
        <el-form-item label="面试结论">
          <el-select v-model="query.interviewConclusion" placeholder="全部" clearable style="width: 140px">
            <el-option v-for="(n, v) in INTERVIEW_CONCLUSION_NAME" :key="v" :label="n" :value="Number(v)" />
          </el-select>
        </el-form-item>
        <el-form-item label="复盘结论">
          <el-select v-model="query.reviewConclusion" placeholder="全部" clearable style="width: 150px">
            <el-option v-for="(n, v) in REVIEW_CONCLUSION_NAME" :key="v" :label="n" :value="Number(v)" />
          </el-select>
        </el-form-item>
        <el-form-item label="复盘日期">
          <el-date-picker
            v-model="query.startDate"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="开始"
            style="width: 150px"
          />
          <span class="range-split">~</span>
          <el-date-picker
            v-model="query.endDate"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="结束"
            style="width: 150px"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :icon="Search" @click="handleSearch">查询</el-button>
          <el-button :icon="Refresh" @click="handleReset">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- ============ 列表 ============ -->
    <el-card shadow="never" class="table-card">
      <div class="toolbar">
        <el-button v-if="canAct('job:review:add', true)" type="primary" :icon="Plus" @click="handleAdd">新建复盘</el-button>
      </div>

      <el-table v-loading="loading" :data="tableData" border stripe style="width: 100%" empty-text="暂无复盘记录">
        <el-table-column type="index" label="序号" width="60" align="center" />
        <el-table-column prop="studentName" label="姓名" width="100" />
        <el-table-column prop="studentNo" label="学号" width="130" />
        <el-table-column prop="reviewTime" label="复盘时间" width="150" />
        <el-table-column prop="interviewTime" label="面试时间" width="150">
          <template #default="{ row }">{{ row.interviewTime || '—' }}</template>
        </el-table-column>
        <el-table-column prop="position" label="岗位" min-width="140">
          <template #default="{ row }">{{ row.position || '—' }}</template>
        </el-table-column>
        <el-table-column label="工资" width="110" align="right">
          <template #default="{ row }">{{ money(row.salary) }}</template>
        </el-table-column>
        <el-table-column label="面试结论" width="120" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.interviewConclusion" :type="interviewTagType(row.interviewConclusion)" size="small">
              {{ row.interviewConclusionName }}
            </el-tag>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="复盘结论" width="130" align="center">
          <template #default="{ row }">
            <el-tag :type="reviewTagType(row.reviewConclusion)" size="small">
              {{ row.reviewConclusionName || '未填写' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="录音" width="100" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.hasAudio" size="small" type="success" effect="plain">有录音</el-tag>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right" align="center">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="handleDetail(row)">详情</el-button>
            <!-- ★ 2026-10-07 行内写按钮也走权限树：后端总闸把 update/delete/remove-audio 都归 review:edit -->
            <el-button v-if="canAct('job:review:edit', true)" link type="primary" size="small" @click="handleEdit(row)">编辑</el-button>
            <el-button v-if="canAct('job:review:edit', true)" link type="danger" size="small" @click="handleRemoveAudio(row)">删录音</el-button>
            <el-button v-if="canAct('job:review:edit', true)" link type="danger" size="small" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        v-model:current-page="query.page"
        v-model:page-size="query.size"
        :page-sizes="[10, 20, 50, 100]"
        :total="total"
        layout="total, sizes, prev, pager, next, jumper"
        style="margin-top: 16px; justify-content: flex-end"
        @size-change="loadData"
        @current-change="loadData"
      />
    </el-card>

    <!-- ============ 新建 / 编辑 ============ -->
    <el-dialog v-model="dialogVisible" :title="isEdit ? '编辑复盘' : '新建复盘'" width="640px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="110px">
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="姓名" prop="studentId">
              <StudentSelect
                :model-value="form.studentId"
                :initial-label="studentLabel"
                @update:model-value="(v) => (form.studentId = v)"
                @change="onStudentChange"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="复盘时间" prop="reviewTime">
              <el-date-picker
                v-model="form.reviewTime"
                type="datetime"
                value-format="YYYY-MM-DD HH:mm"
                placeholder="选择复盘时间"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="面试时间">
              <el-date-picker
                v-model="form.interviewTime"
                type="datetime"
                value-format="YYYY-MM-DD HH:mm"
                placeholder="选择面试时间"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="岗位">
              <el-input v-model="form.position" placeholder="如 前端开发工程师" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="工资（元/月）">
              <el-input-number v-model="form.salary" :min="0" :max="1000000" :step="500" controls-position="right" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="面试结论">
              <el-select v-model="form.interviewConclusion" placeholder="请选择" clearable style="width: 100%">
                <el-option
                  v-for="(n, v) in INTERVIEW_CONCLUSION_NAME"
                  :key="v"
                  :label="n"
                  :value="Number(v)"
                />
              </el-select>
              <!-- ★ 2026-10-02：把"offer 数从哪来"写在字段边上（斌哥反馈找不到填 offer 的地方） -->
              <div class="field-tip">选「已发 offer」会计入<b>数据统计</b>的 offer 数</div>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="复盘结论">
              <el-select v-model="form.reviewConclusion" placeholder="请选择" clearable style="width: 100%">
                <el-option
                  v-for="(n, v) in REVIEW_CONCLUSION_NAME"
                  :key="v"
                  :label="n"
                  :value="Number(v)"
                  :disabled="reviewLocked && Number(v) !== ReviewConclusion.SIGNED"
                />
              </el-select>
              <!-- ★ 2026-10-02：面试结论选「已发 offer」时，这里只剩「已签约入职」可选 -->
              <div v-if="reviewLocked" class="field-tip tip-lock">
                面试结论为「已发 offer」→ 复盘结论固定为<b>已签约入职</b>
              </div>
              <div v-else class="field-tip">
                选「已签约入职」可一键把该生标记为<b>已就业</b>
              </div>
            </el-form-item>
          </el-col>
          <el-col :span="24">
            <el-form-item label="上传录音">
              <div class="audio-box">
                <el-upload :http-request="handleAudioUpload" :show-file-list="false" accept="audio/*">
                  <el-button type="primary" :loading="audioUploading" :icon="Upload">上传录音</el-button>
                </el-upload>
                <el-button
                  v-if="canRecord"
                  :type="recording ? 'danger' : 'default'"
                  :icon="Microphone"
                  @click="toggleRecord"
                >
                  {{ recording ? `停止录音（${recordSeconds}s）` : '开始录音' }}
                </el-button>
                <span class="tip">支持 mp3 / wav / m4a，≤ 8MB</span>
              </div>
              <div v-if="form.audioName" class="audio-file">
                <span class="audio-file-name">{{ form.audioName }}</span>
                <audio v-if="form.audioData" :src="form.audioData" controls style="flex: 1" />
                <el-button link type="danger" size="small" @click="removeAudio">移除</el-button>
              </div>
            </el-form-item>
          </el-col>
          <el-col :span="24">
            <el-form-item label="复盘详情">
              <el-input
                v-model="form.detail"
                type="textarea"
                :rows="4"
                placeholder="记录本次面试暴露的问题、改进建议、下一步计划等"
              />
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>

      <el-alert
        v-if="form.interviewConclusion === InterviewConclusion.OFFER"
        type="success"
        :closable="false"
        show-icon
        title="面试结论为「已发 offer」"
        description="保存后系统会自动向消息通知中心推送一条就业通知。"
        class="mt8"
      />

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSubmit">确定</el-button>
      </template>
    </el-dialog>

    <!-- ============ 详情 ============ -->
    <el-drawer v-model="detailVisible" title="复盘详情" size="580px">
      <div v-loading="detailLoading">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="姓名">{{ detail.studentName || '—' }}</el-descriptions-item>
          <el-descriptions-item label="学号">{{ detail.studentNo || '—' }}</el-descriptions-item>
          <el-descriptions-item label="班级">{{ detail.className || '—' }}</el-descriptions-item>
          <el-descriptions-item label="复盘时间">{{ detail.reviewTime || '—' }}</el-descriptions-item>
          <el-descriptions-item label="面试时间">{{ detail.interviewTime || '—' }}</el-descriptions-item>
          <el-descriptions-item label="岗位">{{ detail.position || '—' }}</el-descriptions-item>
          <el-descriptions-item label="工资">
            <span v-if="detail.salary">¥{{ Number(detail.salary).toLocaleString() }} / 月</span>
            <span v-else>—</span>
          </el-descriptions-item>
          <el-descriptions-item label="面试结论">
            <el-tag v-if="detail.interviewConclusion" :type="interviewTagType(detail.interviewConclusion)" size="small">
              {{ detail.interviewConclusionName }}
            </el-tag>
            <span v-else>—</span>
          </el-descriptions-item>
          <el-descriptions-item label="复盘结论" :span="2">
            <el-tag :type="reviewTagType(detail.reviewConclusion)" size="small">
              {{ detail.reviewConclusionName || '未填写' }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="录音" :span="2">
            <audio v-if="detail.audioData" :src="detail.audioData" controls style="width: 100%" />
            <span v-else class="muted">未上传录音</span>
            <div v-if="detail.audioName" class="audio-name">{{ detail.audioName }}</div>
          </el-descriptions-item>
          <el-descriptions-item label="复盘详情" :span="2">
            <div class="detail-text">{{ detail.detail || '—' }}</div>
          </el-descriptions-item>
        </el-descriptions>
      </div>
    </el-drawer>
  </div>
</template>

<style scoped>
.page-container {
  padding: 16px;
}

.search-card {
  margin-bottom: 12px;
}

.search-card :deep(.el-form-item) {
  margin-bottom: 0;
}

.range-split {
  margin: 0 6px;
  color: #909399;
}

.muted {
  color: #c0c4cc;
}

.audio-box {
  display: flex;
  align-items: center;
  gap: 10px;
}

.tip {
  font-size: 12px;
  color: #909399;
}

.audio-file {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
}

.audio-file-name {
  font-size: 13px;
  color: #606266;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.audio-name {
  margin-top: 6px;
  font-size: 12px;
  color: #909399;
}

.detail-text {
  white-space: pre-wrap;
  line-height: 1.7;
  color: #606266;
}

.mt8 {
  margin-top: 8px;
}

/* 表单项下面的小字提示（2026-10-02 新增） */
.field-tip {
  width: 100%;
  margin-top: 2px;
  font-size: 11.5px;
  line-height: 1.5;
  color: #a8abb2;
}
/* 被规则锁住时的提示（面试结论 = 已发 offer） */
.tip-lock {
  color: #e6a23c;
}
</style>
