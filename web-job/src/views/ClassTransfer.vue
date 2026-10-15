<template>
  <div class="page-container">
    <!-- ============ 搜索区 ============ -->
    <el-card shadow="never" class="search-card">
      <el-form :model="query" inline>
        <el-form-item label="班级名称">
          <el-input
            v-model="query.className"
            placeholder="请输入班级名称"
            clearable
            style="width: 170px"
            @keyup.enter="handleSearch"
          />
        </el-form-item>
        <el-form-item label="交接原因">
          <el-select v-model="query.transferType" placeholder="全部" clearable style="width: 130px">
            <el-option
              v-for="(name, value) in TRANSFER_TYPE_NAME"
              :key="value"
              :label="name"
              :value="Number(value)"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="交接日期">
          <el-date-picker
            v-model="dateRange"
            type="daterange"
            range-separator="至"
            start-placeholder="开始"
            end-placeholder="结束"
            value-format="YYYY-MM-DD"
            style="width: 240px"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :icon="Search" @click="handleSearch">查询</el-button>
          <el-button :icon="Refresh" @click="handleReset">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- ============ 表格区 ============ -->
    <el-card shadow="never" class="table-card">
      <div class="toolbar">
        <el-button v-readonly-hide v-if="canAct('job:classTransfer:add', true)" type="primary" :icon="Switch" @click="handleOpenTransfer">发起交接</el-button>
        <span class="toolbar-tip">
          交接 = 整个班换负责人（班主任/教员/助教），学生不动；提交即生效，并留存交接快照
        </span>
      </div>

      <el-table
        v-loading="loading"
        :data="tableData"
        border
        stripe
        style="width: 100%"
        empty-text="暂无交接记录"
      >
        <el-table-column type="index" label="序号" width="60" align="center" />
        <el-table-column prop="className" label="班级" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">
            <div>{{ row.className }}</div>
            <div class="sub-text">{{ row.classCode }}</div>
          </template>
        </el-table-column>
        <el-table-column label="原负责人" width="200" align="center">
          <template #default="{ row }">
            <div>{{ row.oldHeadTeacherName || '—' }} <span class="sub-text">班主任</span></div>
            <div v-if="row.oldTeacherName" class="sub-text">教员：{{ row.oldTeacherName }}</div>
          </template>
        </el-table-column>
        <el-table-column label="" width="40" align="center">
          <template #default>
            <el-icon color="#A2938E"><Right /></el-icon>
          </template>
        </el-table-column>
        <el-table-column label="新负责人" width="200" align="center">
          <template #default="{ row }">
            <div class="hl">{{ row.newHeadTeacherName || '—' }} <span class="sub-text">班主任</span></div>
            <div v-if="row.newTeacherName" class="sub-text">教员：{{ row.newTeacherName }}</div>
          </template>
        </el-table-column>
        <el-table-column label="交接原因" width="110" align="center">
          <template #default="{ row }">
            <el-tag size="small" effect="plain">{{ row.transferTypeName }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="交接快照" width="160" align="center">
          <template #default="{ row }">
            <div>{{ row.snapshotStudentCount }} 人在班</div>
            <div class="sub-text">
              出勤率
              <span v-if="row.snapshotAttendanceRate === null">—</span>
              <span v-else>{{ row.snapshotAttendanceRate }}%</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="transferDate" label="交接日期" width="120" align="center" />
        <el-table-column prop="createByName" label="操作人" width="100" align="center">
          <template #default="{ row }">{{ row.createByName || '—' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="130" fixed="right" align="center">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="handleDetail(row)">详情</el-button>
            <el-button v-readonly-hide link type="danger" size="small" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pager">
        <el-pagination
          v-model:current-page="query.page"
          v-model:page-size="query.size"
          :page-sizes="[10, 20, 50]"
          :total="total"
          layout="total, sizes, prev, pager, next, jumper"
          background
          @size-change="loadData"
          @current-change="loadData"
        />
      </div>
    </el-card>

    <!-- ============ 发起交接弹窗 ============ -->
    <el-dialog
      v-model="transferVisible"
      title="发起班级交接"
      width="720px"
      :close-on-click-modal="false"
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="110px">
        <el-form-item label="选择班级" prop="classId">
          <el-select
            v-model="form.classId"
            placeholder="请选择要交接的班级"
            filterable
            style="width: 100%"
            :disabled="!!preview"
            @change="handleClassChange"
          >
            <el-option
              v-for="c in classOptions"
              :key="c.id"
              :label="`${c.className}（${c.studentCount}人·${c.classStatusName}）`"
              :value="c.id"
            />
          </el-select>
        </el-form-item>
      </el-form>

      <!-- 交接预览：看当前状态 -->
      <div v-if="preview" class="preview-box">
        <div class="preview-title">交接前状态</div>
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="当前班主任">
            {{ preview.headTeacherName || '—' }}
          </el-descriptions-item>
          <el-descriptions-item label="当前教员">
            {{ preview.teacherName || '—' }}
          </el-descriptions-item>
          <el-descriptions-item label="班级状态">
            {{ preview.classStatusName }} · {{ preview.stageName }}
          </el-descriptions-item>
          <el-descriptions-item label="在班人数">
            {{ preview.studentCount }} 人
          </el-descriptions-item>
          <el-descriptions-item label="累计出勤率" :span="2">
            <span v-if="preview.attendanceRate === null">暂无出勤记录</span>
            <span v-else>{{ preview.attendanceRate }}%</span>
          </el-descriptions-item>
          <el-descriptions-item label="学生名单" :span="2">
            <el-tag
              v-for="s in preview.students"
              :key="s.id"
              size="small"
              effect="plain"
              style="margin: 2px 4px 2px 0"
            >
              {{ s.name }}
            </el-tag>
            <span v-if="!preview.students.length" class="sub-text">（该班暂无学生）</span>
          </el-descriptions-item>
        </el-descriptions>
      </div>

      <!-- 交接表单 -->
      <el-form
        v-if="preview"
        ref="form2Ref"
        :model="form"
        :rules="rules"
        label-width="110px"
        style="margin-top: 16px"
      >
        <el-form-item label="新班主任" prop="newHeadTeacherId">
          <el-select
            v-model="form.newHeadTeacherId"
            placeholder="请选择新班主任"
            filterable
            style="width: 100%"
            @change="(v: string) => syncName('newHeadTeacherName', v)"
          >
            <el-option
              v-for="t in headOptions"
              :key="t.id"
              :label="`${t.name}（${t.id}）`"
              :value="t.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="新教员">
          <el-select
            v-model="form.newTeacherId"
            placeholder="请选择新教员（可不填）"
            filterable
            clearable
            style="width: 100%"
            @change="(v: string) => syncName('newTeacherName', v)"
          >
            <el-option
              v-for="t in teacherOptions"
              :key="t.id"
              :label="`${t.name}（${t.id}）`"
              :value="t.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="新助教">
          <el-select
            v-model="form.newAssistantId"
            placeholder="请选择新助教（可不填）"
            filterable
            clearable
            style="width: 100%"
            @change="(v: string) => syncName('newAssistantName', v)"
          >
            <el-option
              v-for="t in assistantOptions"
              :key="t.id"
              :label="`${t.name}（${t.id}）`"
              :value="t.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="交接原因" prop="transferType">
          <el-select v-model="form.transferType" style="width: 100%">
            <el-option
              v-for="(name, value) in TRANSFER_TYPE_NAME"
              :key="value"
              :label="name"
              :value="Number(value)"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="交接日期">
          <el-date-picker
            v-model="form.transferDate"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="默认今天"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="移交内容">
          <el-checkbox-group v-model="form.transferItems">
            <el-checkbox
              v-for="(name, value) in TRANSFER_ITEM_NAME"
              :key="value"
              :value="Number(value)"
            >
              {{ name }}
            </el-checkbox>
          </el-checkbox-group>
        </el-form-item>
        <el-form-item label="交接说明">
          <el-input
            v-model="form.transferReason"
            type="textarea"
            :rows="2"
            maxlength="200"
            show-word-limit
            placeholder="说明交接原因，例如：马老师调岗至新开班"
          />
        </el-form-item>
        <el-form-item label="备注">
          <el-input
            v-model="form.remark"
            type="textarea"
            :rows="2"
            maxlength="500"
            show-word-limit
            placeholder="选填"
          />
        </el-form-item>
      </el-form>

      <el-alert
        v-if="preview"
        type="warning"
        :closable="false"
        show-icon
        title="提交后立即生效：班级负责人将变更为新选择的人，同时留存本次交接快照（人数/出勤率/学生名单）。"
        style="margin-top: 8px"
      />

      <template #footer>
        <el-button @click="transferVisible = false">取消</el-button>
        <el-button v-readonly-hide type="primary" :loading="submitting" :disabled="!preview" @click="handleSubmit">
          确认交接
        </el-button>
      </template>
    </el-dialog>

    <!-- ============ 交接详情弹窗 ============ -->
    <el-dialog v-model="detailVisible" title="交接详情" width="720px">
      <template v-if="detail">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="班级">
            {{ detail.className }}（{{ detail.classCode }}）
          </el-descriptions-item>
          <el-descriptions-item label="班级状态">
            {{ detail.classStatusName }} · {{ detail.stageName }}
          </el-descriptions-item>
          <el-descriptions-item label="原班主任">
            {{ detail.oldHeadTeacherName || '—' }}
          </el-descriptions-item>
          <el-descriptions-item label="原教员">
            {{ detail.oldTeacherName || '—' }}
          </el-descriptions-item>
          <el-descriptions-item label="新班主任">
            <span class="hl">{{ detail.newHeadTeacherName || '—' }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="新教员">
            {{ detail.newTeacherName || '—' }}
          </el-descriptions-item>
          <el-descriptions-item label="新助教">
            {{ detail.newAssistantName || '—' }}
          </el-descriptions-item>
          <el-descriptions-item label="交接原因">
            {{ detail.transferTypeName }}
          </el-descriptions-item>
          <el-descriptions-item label="交接日期">{{ detail.transferDate }}</el-descriptions-item>
          <el-descriptions-item label="操作人">
            {{ detail.createByName || '—' }} @ {{ detail.createTime }}
          </el-descriptions-item>
        </el-descriptions>

        <div class="preview-title" style="margin-top: 16px">交接时快照</div>
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="在班人数">
            {{ detail.snapshotStudentCount }} 人
          </el-descriptions-item>
          <el-descriptions-item label="累计出勤率">
            <span v-if="detail.snapshotAttendanceRate === null">—</span>
            <span v-else>{{ detail.snapshotAttendanceRate }}%</span>
          </el-descriptions-item>
          <el-descriptions-item label="移交内容" :span="2">
            <el-tag
              v-for="it in detail.snapshotDetail"
              :key="it"
              size="small"
              effect="plain"
              style="margin-right: 6px"
            >
              {{ TRANSFER_ITEM_NAME[it] || it }}
            </el-tag>
            <span v-if="!detail.snapshotDetail.length" class="sub-text">—</span>
          </el-descriptions-item>
          <el-descriptions-item label="学生名单" :span="2">
            <el-tag
              v-for="(s, i) in detail.snapshotStudentList"
              :key="s.id"
              size="small"
              effect="plain"
              style="margin: 2px 4px 2px 0"
            >
              {{ i + 1 }}. {{ s.name }}（{{ s.no }}）
            </el-tag>
            <span v-if="!detail.snapshotStudentList.length" class="sub-text">（交接时该班无学生）</span>
          </el-descriptions-item>
          <el-descriptions-item label="交接说明" :span="2">
            {{ detail.transferReason || '—' }}
          </el-descriptions-item>
          <el-descriptions-item label="备注" :span="2">
            {{ detail.remark || '—' }}
          </el-descriptions-item>
        </el-descriptions>
      </template>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { canAct } from '@/store/permission';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { FormInstance, FormRules } from 'element-plus';
import { Search, Refresh, Switch, Right } from '@element-plus/icons-vue';
import {
  TRANSFER_TYPE_NAME,
  TRANSFER_ITEM_NAME,
  TransferType,
  ClassStatus,
  type ClassTransferListItem,
  type ClassTransfer,
  type ClassTransferPreview,
  type ClassOption,
  type TeacherOption,
} from 'shared-types';
import {
  fetchTransferList,
  fetchTransferDetail,
  fetchTransferPreview,
  fetchTeacherOptions,
  doTransfer,
  deleteTransfer,
  fetchClassOptions,
} from '../api/class';

/* ---------- 列表 ---------- */
const loading = ref(false);
const tableData = ref<ClassTransferListItem[]>([]);
const total = ref(0);
const dateRange = ref<[string, string] | null>(null);

const query = reactive({
  page: 1,
  size: 10,
  className: '',
  transferType: undefined as number | undefined,
});

async function loadData() {
  loading.value = true;
  try {
    const res = await fetchTransferList({
      page: query.page,
      size: query.size,
      className: query.className || undefined,
      transferType: query.transferType,
      startDate: dateRange.value?.[0],
      endDate: dateRange.value?.[1],
    });
    tableData.value = res.list;
    total.value = res.total;
  } catch (e: any) {
    ElMessage.error(e?.message || '加载失败');
  } finally {
    loading.value = false;
  }
}

function handleSearch() {
  query.page = 1;
  loadData();
}

function handleReset() {
  query.className = '';
  query.transferType = undefined;
  dateRange.value = null;
  query.page = 1;
  loadData();
}

/* ---------- 班级下拉 ---------- */
const classOptions = ref<ClassOption[]>([]);
async function loadClassOptions() {
  try {
    // ⚠️ 已结业的班**不能**出现在交接下拉里（斌哥 2026-09-30 明确）——
    //    班都结业了，没有交接的必要，出现在选项里只会让人误选。
    //    封班的班要保留：班还在运行（只是不再收新生），换班主任是正常操作。
    //    （后端 /class-transfer/do 也会再拦一道，防止直接调接口绕过）
    const all = await fetchClassOptions({ includeAll: true });
    classOptions.value = all.filter((c) => c.classStatus !== ClassStatus.GRADUATED);
  } catch (e: any) {
    ElMessage.error(e?.message || '班级下拉加载失败');
  }
}

/* ---------- 教师下拉 ---------- */
const headOptions = ref<TeacherOption[]>([]);
const teacherOptions = ref<TeacherOption[]>([]);
const assistantOptions = ref<TeacherOption[]>([]);
async function loadTeacherOptions() {
  try {
    const [h, t, a] = await Promise.all([
      fetchTeacherOptions('head'),
      fetchTeacherOptions('teacher'),
      fetchTeacherOptions('assistant'),
    ]);
    headOptions.value = h;
    teacherOptions.value = t;
    assistantOptions.value = a;
  } catch (e: any) {
    ElMessage.error(e?.message || '人员下拉加载失败');
  }
}

/* ---------- 发起交接 ---------- */
const transferVisible = ref(false);
const submitting = ref(false);
const preview = ref<ClassTransferPreview | null>(null);
const formRef = ref<FormInstance>();
const form2Ref = ref<FormInstance>();

const form = reactive({
  classId: '',
  newHeadTeacherId: '',
  newHeadTeacherName: '',
  newTeacherId: '',
  newTeacherName: '',
  newAssistantId: '',
  newAssistantName: '',
  transferDate: '',
  transferType: TransferType.REASSIGN as number,
  transferReason: '',
  remark: '',
  transferItems: [1] as number[],
});

const rules: FormRules = {
  classId: [{ required: true, message: '请选择班级', trigger: 'change' }],
  newHeadTeacherId: [{ required: true, message: '请选择新班主任', trigger: 'change' }],
  transferType: [{ required: true, message: '请选择交接原因', trigger: 'change' }],
};

function handleOpenTransfer() {
  transferVisible.value = true;
  preview.value = null;
  form.classId = '';
  form.newHeadTeacherId = '';
  form.newHeadTeacherName = '';
  form.newTeacherId = '';
  form.newTeacherName = '';
  form.newAssistantId = '';
  form.newAssistantName = '';
  form.transferDate = '';
  form.transferType = TransferType.REASSIGN;
  form.transferReason = '';
  form.remark = '';
  form.transferItems = [1];
}

/** 选班后拉预览 */
async function handleClassChange(classId: string) {
  if (!classId) return;
  try {
    preview.value = await fetchTransferPreview(classId);
  } catch (e: any) {
    ElMessage.error(e?.message || '加载班级状态失败');
    preview.value = null;
  }
}

/** 选人后把姓名同步进 form（后端也能反查，这里传过去省一次查询） */
function syncName(field: 'newHeadTeacherName' | 'newTeacherName' | 'newAssistantName', id: string) {
  const all = [...headOptions.value, ...teacherOptions.value, ...assistantOptions.value];
  const hit = all.find((t) => t.id === id);
  form[field] = hit?.name || '';
}

async function handleSubmit() {
  if (!preview.value) return;
  const ok2 = await form2Ref.value?.validate().catch(() => false);
  if (!ok2) return;

  submitting.value = true;
  try {
    const res = await doTransfer({
      classId: form.classId,
      newHeadTeacherId: form.newHeadTeacherId,
      newHeadTeacherName: form.newHeadTeacherName || undefined,
      newTeacherId: form.newTeacherId || undefined,
      newTeacherName: form.newTeacherName || undefined,
      newAssistantId: form.newAssistantId || undefined,
      newAssistantName: form.newAssistantName || undefined,
      transferDate: form.transferDate || undefined,
      transferType: form.transferType,
      transferReason: form.transferReason || undefined,
      remark: form.remark || undefined,
      transferItems: form.transferItems,
    });
    ElMessage.success(
      `交接成功：${res.className} 现由 ${res.newHeadTeacherName} 担任班主任（快照 ${res.snapshotStudentCount} 人）`,
    );
    transferVisible.value = false;
    loadData();
  } catch (e: any) {
    ElMessage.error(e?.message || '交接失败');
  } finally {
    submitting.value = false;
  }
}

/* ---------- 详情 ---------- */
const detailVisible = ref(false);
const detail = ref<ClassTransfer | null>(null);
async function handleDetail(row: ClassTransferListItem) {
  try {
    detail.value = await fetchTransferDetail(row.id);
    detailVisible.value = true;
  } catch (e: any) {
    ElMessage.error(e?.message || '加载详情失败');
  }
}

/* ---------- 删除 ---------- */
async function handleDelete(row: ClassTransferListItem) {
  try {
    await ElMessageBox.confirm(
      `确认删除这条交接记录吗？\n\n班级：${row.className}\n交接：${row.oldHeadTeacherName || '—'} → ${row.newHeadTeacherName || '—'}\n\n注意：删除记录不会把班级负责人改回去。`,
      '删除交接记录',
      { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' },
    );
  } catch {
    return;
  }
  try {
    await deleteTransfer(row.id);
    ElMessage.success('已删除');
    loadData();
  } catch (e: any) {
    ElMessage.error(e?.message || '删除失败');
  }
}

onMounted(() => {
  loadData();
  loadClassOptions();
  loadTeacherOptions();
});
</script>

<style scoped>
.page-container {
  padding: 16px;
}
.search-card {
  margin-bottom: 12px;
}
.table-card {
  margin-bottom: 12px;
}
.toolbar {
  display: flex;
  align-items: center;
  margin-bottom: 12px;
}
.toolbar-tip {
  margin-left: 12px;
  color: #A2938E;
  font-size: 12px;
}
.sub-text {
  color: #A2938E;
  font-size: 12px;
}
.hl {
  color: #CD3A33;
  font-weight: 500;
}
.pager {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
}
.preview-box {
  padding: 12px;
  background: #F6F3EF;
  border-radius: 6px;
}
.preview-title {
  font-size: 13px;
  font-weight: 500;
  color: #7A6C67;
  margin-bottom: 8px;
}
</style>
