<template>
  <div class="page-container">
    <!-- ============ 顶部：班级信息 + 返回 ============ -->
    <el-card shadow="never" class="head-card">
      <div class="head-row">
        <div class="head-left">
          <el-button :icon="ArrowLeft" @click="goBack">返回</el-button>
          <span class="cls-title">{{ classInfo?.className || '班级花名册' }}</span>
          <el-tag v-if="classInfo" size="small" effect="plain">{{ classInfo.classCode }}</el-tag>
          <el-tag v-if="classInfo" size="small" type="info" effect="plain">
            {{ classInfo.deptName }} · {{ classInfo.stageName }}
          </el-tag>
          <el-tag v-if="classInfo" size="small" :type="statusTagType(classInfo.classStatus)">
            {{ classInfo.classStatusName }}
          </el-tag>
        </div>
        <div class="head-right">
          <span class="head-stat">在班 <b>{{ classInfo?.studentCount ?? 0 }}</b> 人</span>
        </div>
      </div>
    </el-card>

    <!-- ============ 列表 ============ -->
    <el-card shadow="never" class="table-card">
      <div class="toolbar">
        <div class="toolbar-left">
          <el-radio-group v-model="query.status" size="small" @change="handleStatusChange">
            <el-radio-button :value="1">在班</el-radio-button>
            <el-radio-button :value="2">已离班</el-radio-button>
            <el-radio-button :value="undefined">全部</el-radio-button>
          </el-radio-group>
          <el-input
            v-model="query.studentName"
            placeholder="搜姓名"
            clearable
            size="small"
            style="width: 130px; margin-left: 12px"
            @keyup.enter="handleSearch"
          />
          <el-input
            v-model="query.studentNo"
            placeholder="搜学号"
            clearable
            size="small"
            style="width: 130px"
            @keyup.enter="handleSearch"
          />
          <el-button size="small" :icon="Search" @click="handleSearch">查询</el-button>
        </div>
        <div class="toolbar-right">
          <el-button v-readonly-hide
            v-if="canEditRoster"
            type="primary"
            size="small"
            :icon="Plus"
            :disabled="!canAddStudent"
            @click="handleOpenAdd"
          >
            加学生
          </el-button>
          <el-button v-readonly-hide
            v-if="canEditRoster"
            type="danger"
            size="small"
            :disabled="selectedInClass.length === 0"
            @click="handleRemove"
          >
            移出班级
          </el-button>
        </div>
      </div>

      <el-alert
        v-if="classInfo && !canAddStudent"
        type="warning"
        :closable="false"
        show-icon
        class="tip-alert"
      >
        <template #title>
          <span v-if="classInfo.classStatus === ClassStatus.GRADUATED">
            班级已结业，不能再加学生。
          </span>
          <span v-else>
            班级已封班，只能加入<b>休学学生</b>或<b>末次班学生</b>（末班次数 &gt; 0）。
          </span>
        </template>
      </el-alert>

      <el-table
        v-loading="loading"
        :data="tableData"
        border
        stripe
        style="width: 100%"
        empty-text="暂无数据"
        @selection-change="handleSelectionChange"
      >
        <el-table-column type="selection" width="48" align="center" :selectable="isSelectable" />
        <el-table-column type="index" label="序号" width="60" align="center" />
        <el-table-column prop="studentNo" label="学号" width="110" align="center" />
        <el-table-column prop="studentName" label="姓名" width="100" align="center" />
        <el-table-column label="性别" width="70" align="center">
          <template #default="{ row }">{{ row.gender === 1 ? '男' : row.gender === 2 ? '女' : '—' }}</template>
        </el-table-column>
        <el-table-column prop="phone" label="手机号" width="130" align="center">
          <template #default="{ row }">{{ row.phone || '—' }}</template>
        </el-table-column>
        <el-table-column prop="parentPhone" label="家长手机" width="130" align="center">
          <template #default="{ row }">{{ row.parentPhone || '—' }}</template>
        </el-table-column>
        <el-table-column label="末班次数" width="90" align="center">
          <template #default="{ row }">
            <span :class="{ 'repeat-warn': (row.repeatCount || 0) > 0 }">
              {{ row.repeatCount || 0 }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="joinDate" label="入班日期" width="110" align="center" />
        <el-table-column label="入班方式" width="110" align="center">
          <template #default="{ row }">
            <el-tag size="small" effect="plain">{{ row.joinTypeName }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="row.status === 1 ? 'success' : 'info'">
              {{ row.statusName }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="离班信息" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.status === 2">
              {{ row.leaveDate }} · {{ row.leaveTypeName }}
              <span v-if="row.leaveReason"> · {{ row.leaveReason }}</span>
            </span>
            <span v-else>—</span>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        v-model:current-page="query.page"
        v-model:page-size="query.size"
        :total="total"
        :page-sizes="[10, 20, 50, 100]"
        layout="total, sizes, prev, pager, next"
        class="pagination"
        @size-change="loadData"
        @current-change="loadData"
      />
    </el-card>

    <!-- ============ 加学生弹窗 ============ -->
    <el-dialog v-model="addVisible" title="加学生进班" width="720px" @closed="handleAddClosed">
      <el-form :model="addForm" label-width="90px">
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="入班方式" required>
              <el-select v-model="addForm.joinType" style="width: 100%">
                <el-option
                  v-for="(name, value) in JOIN_TYPE_NAME"
                  :key="value"
                  :label="name"
                  :value="Number(value)"
                />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="入班日期" required>
              <el-date-picker
                v-model="addForm.joinDate"
                type="date"
                value-format="YYYY-MM-DD"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="搜索学生">
          <el-input
            v-model="candidateKeyword"
            placeholder="输入姓名或学号搜索"
            clearable
            style="width: 260px"
            @keyup.enter="loadCandidates"
          />
          <el-button style="margin-left: 8px" @click="loadCandidates">搜索</el-button>
        </el-form-item>

        <el-table
          ref="candidateTableRef"
          v-loading="candidateLoading"
          :data="candidates"
          border
          height="320"
          empty-text="没有可加入的学生"
          @selection-change="handleCandidateChange"
        >
          <el-table-column type="selection" width="48" align="center" :selectable="isCandidateSelectable" />
          <el-table-column prop="studentNo" label="学号" width="120" align="center" />
          <el-table-column prop="studentName" label="姓名" width="100" align="center" />
          <el-table-column label="性别" width="70" align="center">
            <template #default="{ row }">
              {{ row.gender === 1 ? '男' : row.gender === 2 ? '女' : '—' }}
            </template>
          </el-table-column>
          <el-table-column prop="currentClassName" label="当前班级" min-width="120">
            <template #default="{ row }">{{ row.currentClassName || '未分班' }}</template>
          </el-table-column>
          <el-table-column label="末班次数" width="90" align="center">
            <template #default="{ row }">
              <span :class="{ 'repeat-warn': (row.repeatCount || 0) > 0 }">{{ row.repeatCount || 0 }}</span>
            </template>
          </el-table-column>
        </el-table>

        <div class="add-tip">
          已选 <b>{{ selectedCandidates.length }}</b> 人
          <span v-if="addForm.joinType === JoinType.REPEAT_IN" class="tip-warn">
            （末班转入：建议从考试模块的「末班」操作发起，这里手动加只做补救）
          </span>
        </div>
      </el-form>

      <template #footer>
        <el-button v-readonly-hide @click="addVisible = false">取消</el-button>
        <el-button v-readonly-hide
          type="primary"
          :loading="saving"
          :disabled="selectedCandidates.length === 0"
          @click="handleAddSubmit"
        >
          确认加入
        </el-button>
      </template>
    </el-dialog>

    <!-- ============ 移出班级弹窗 ============ -->
    <el-dialog v-model="removeVisible" title="移出班级" width="520px">
      <el-form :model="removeForm" label-width="90px">
        <el-form-item label="学生">
          <span>{{ selectedInClass.map((s) => s.studentName).join('、') }}</span>
        </el-form-item>
        <el-form-item label="离班方式" required>
          <el-select v-model="removeForm.leaveType" style="width: 100%">
            <el-option
              v-for="(name, value) in LEAVE_TYPE_NAME"
              :key="value"
              :label="name"
              :value="Number(value)"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="离班日期" required>
          <el-date-picker
            v-model="removeForm.leaveDate"
            type="date"
            value-format="YYYY-MM-DD"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="离班原因">
          <el-input
            v-model="removeForm.leaveReason"
            type="textarea"
            :rows="2"
            maxlength="200"
            show-word-limit
            placeholder="如：转去实训二期2班"
          />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button v-readonly-hide @click="removeVisible = false">取消</el-button>
        <el-button v-readonly-hide type="danger" :loading="saving" @click="handleRemoveSubmit">确认移出</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { myRoles, isReadOnlyUser, canAct } from '@/store/permission';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { ArrowLeft, Search, Plus } from '@element-plus/icons-vue';
import {
  ClassStatus,
  JoinType,
  JOIN_TYPE_NAME,
  LEAVE_TYPE_NAME,
  RoleCode,
} from 'shared-types';
import type {
  ClassInfo,
  ClassStudentListItem,
  ClassStudentQuery,
  ClassStudentCandidate,
} from 'shared-types';
import {
  fetchClassDetail,
  fetchClassStudentList,
  fetchClassStudentCandidates,
  addClassStudents,
  removeClassStudents,
} from '@/api/class';

const route = useRoute();
const router = useRouter();

/**
 * 能不能编辑花名册（加学生 / 移出班级）
 *
 * ⚠️ 教务老师对花名册是【只读】的（斌哥 2026-09-30）：能看名单，不能动学生。
 * ⚠️ 系统管理员同理（他本身是只读账号）。
 * ⚠️ 前端隐藏只是"不碍眼"，后端 /class-student 的加/移接口也会再拦一道。
 */
const canEditRoster = computed(
  () =>
    canAct(
      'job:class:edit',
      !isReadOnlyUser.value && !myRoles.value.includes(RoleCode.ACAD_STAFF),
    ),
);

/** 班级ID（从路由参数取） */
const classId = computed(() => String(route.params.id || ''));

/* ============ 班级信息 ============ */

const classInfo = ref<ClassInfo | null>(null);

/** 能不能加学生：已结业不能加；封班能加（但要限制人员） */
const canAddStudent = computed(() => {
  if (!classInfo.value) return false;
  return classInfo.value.classStatus !== ClassStatus.GRADUATED;
});

function statusTagType(status: number) {
  // ★ 2026-10-02：班级状态只剩「封班 / 已结业」两种（"开放"已废弃）
  //   封班 = 正常运行态（绿）；其它（已结业等）= 灰
  if (status === ClassStatus.CLOSED) return 'success';
  return 'info';
}

async function loadClassInfo() {
  try {
    classInfo.value = await fetchClassDetail(classId.value);
  } catch {
    // 错误提示已统一处理
  }
}

/* ============ 列表 ============ */

const loading = ref(false);
const saving = ref(false);
const tableData = ref<ClassStudentListItem[]>([]);
const total = ref(0);
const selectedRows = ref<ClassStudentListItem[]>([]);

const query = reactive<ClassStudentQuery>({
  page: 1,
  size: 20,
  classId: classId.value,
  status: 1,
  studentNo: undefined,
  studentName: undefined,
});

/** 只有「在班」的人能被选中移出 */
const selectedInClass = computed(() => selectedRows.value.filter((r) => r.status === 1));

function isSelectable(row: ClassStudentListItem) {
  return row.status === 1;
}

function handleSelectionChange(rows: ClassStudentListItem[]) {
  selectedRows.value = rows;
}

async function loadData() {
  loading.value = true;
  query.classId = classId.value;
  try {
    const data = await fetchClassStudentList(query);
    tableData.value = data.list;
    total.value = data.total;
  } catch {
    // 错误提示已统一处理
  } finally {
    loading.value = false;
  }
}

function handleStatusChange() {
  query.page = 1;
  loadData();
}

function handleSearch() {
  query.page = 1;
  loadData();
}

/* ============ 加学生 ============ */

const addVisible = ref(false);
const candidateLoading = ref(false);
const candidates = ref<ClassStudentCandidate[]>([]);
const candidateKeyword = ref('');
const selectedCandidates = ref<ClassStudentCandidate[]>([]);
const candidateTableRef = ref();

const addForm = reactive({
  joinType: JoinType.NEW as number,
  joinDate: new Date().toISOString().slice(0, 10),
  remark: '',
});

/** 封班时，只允许选「休学学生」或「末次班学生」 */
function isCandidateSelectable(row: ClassStudentCandidate) {
  if (!classInfo.value) return false;
  if (classInfo.value.classStatus !== ClassStatus.CLOSED) return true;
  // 学生状态 6=休学；或末班次数 > 0
  return row.studentStatus === 6 || (row.repeatCount || 0) > 0;
}

function handleOpenAdd() {
  addForm.joinType = JoinType.NEW;
  addForm.joinDate = new Date().toISOString().slice(0, 10);
  addForm.remark = '';
  candidateKeyword.value = '';
  selectedCandidates.value = [];
  candidates.value = [];
  addVisible.value = true;
  loadCandidates();
}

async function loadCandidates() {
  candidateLoading.value = true;
  try {
    candidates.value = await fetchClassStudentCandidates({
      classId: classId.value,
      studentName: candidateKeyword.value || undefined,
      studentNo: candidateKeyword.value || undefined,
      limit: 100,
    });
  } catch {
    // 错误提示已统一处理
  } finally {
    candidateLoading.value = false;
  }
}

function handleCandidateChange(rows: ClassStudentCandidate[]) {
  selectedCandidates.value = rows;
}

function handleAddClosed() {
  candidateTableRef.value?.clearSelection();
  selectedCandidates.value = [];
}

async function handleAddSubmit() {
  if (!selectedCandidates.value.length) return;
  saving.value = true;
  try {
    const res = await addClassStudents({
      classId: classId.value,
      studentIds: selectedCandidates.value.map((c) => c.studentId),
      joinType: addForm.joinType as any,
      joinDate: addForm.joinDate,
      remark: addForm.remark || undefined,
    });
    ElMessage.success(`已加入 ${res.addedCount} 名学生`);
    addVisible.value = false;
    loadClassInfo();
    loadData();
  } catch {
    // 错误提示已统一处理
  } finally {
    saving.value = false;
  }
}

/* ============ 移出班级 ============ */

const removeVisible = ref(false);
const removeForm = reactive({
  leaveType: 1 as number,
  leaveDate: new Date().toISOString().slice(0, 10),
  leaveReason: '',
});

function handleRemove() {
  if (!selectedInClass.value.length) return;
  removeForm.leaveType = 1;
  removeForm.leaveDate = new Date().toISOString().slice(0, 10);
  removeForm.leaveReason = '';
  removeVisible.value = true;
}

async function handleRemoveSubmit() {
  saving.value = true;
  try {
    const res = await removeClassStudents({
      classId: classId.value,
      studentIds: selectedInClass.value.map((s) => s.studentId),
      leaveType: removeForm.leaveType as any,
      leaveDate: removeForm.leaveDate,
      leaveReason: removeForm.leaveReason || undefined,
    });
    ElMessage.success(`已移出 ${res.removedCount} 名学生`);
    removeVisible.value = false;
    loadClassInfo();
    loadData();
  } catch {
    // 错误提示已统一处理
  } finally {
    saving.value = false;
  }
}

/* ============ 其他 ============ */

/**
 * 返回
 *
 * ★ 第 3 期 D2（2026-10-09）：旧班级列表页 `/class` 已下线，
 *   这里改成回「教学管理 → 班级管理」的统一页，并带上原学段
 *   —— 否则点返回会跳到已经不存在的路由（404）。
 *   ⚠️ `job` = 实训（旧的 `/class` 路由对应的就是实训班级）
 */
function goBack() {
  router.push({ path: '/teaching/class', query: { stage: 'job' } });
}

onMounted(() => {
  loadClassInfo();
  loadData();
});
</script>

<style scoped>
.page-container {
  padding: 16px;
}

.head-card {
  margin-bottom: 12px;
}

.head-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.head-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.cls-title {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
}

.head-stat {
  font-size: 14px;
  color: #606266;
}

.head-stat b {
  color: #409eff;
  font-size: 16px;
}

.table-card {
  margin-bottom: 12px;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.toolbar-left,
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tip-alert {
  margin-bottom: 12px;
}

.pagination {
  margin-top: 14px;
  display: flex;
  justify-content: flex-end;
}

.repeat-warn {
  color: #f56c6c;
  font-weight: 600;
}

.add-tip {
  margin-top: 12px;
  font-size: 13px;
  color: #606266;
}

.add-tip b {
  color: #409eff;
}

.tip-warn {
  color: #e6a23c;
}
</style>
