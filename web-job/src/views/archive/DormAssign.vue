<script setup lang="ts">
/**
 * 信息档案 - 宿舍分配
 *
 * 业务闭环：
 *   建宿舍台账 → 给未分配的学生挑宿舍 → 校验性别/床位 → 入住
 *   后续可调宿舍、退宿；宿舍住满或有人住时不能删
 */

import { ref, reactive, onMounted } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import { Search, Refresh, Plus } from '@element-plus/icons-vue';
import { DORM_TYPE_NAME, GENDER_NAME, DormType } from 'shared-types';
import {
  fetchDormList,
  fetchDormMembers,
  fetchUnassignedStudents,
  addDorm,
  updateDorm,
  deleteDorm,
  assignDorm,
  checkoutDorm,
} from '@/api/empDorm';

/* ============ 宿舍台账 ============ */

const loading = ref(false);
const dormList = ref<any[]>([]);
const dormTotal = ref(0);

const dormQuery = reactive<any>({
  page: 1,
  size: 10,
  dormNo: '',
  building: '',
  roomType: undefined,
  onlyAvailable: false,
});

async function loadDorms() {
  loading.value = true;
  try {
    const data = await fetchDormList(dormQuery);
    dormList.value = data.list;
    dormTotal.value = data.total;
  } catch (e) {
    console.error(e);
  } finally {
    loading.value = false;
  }
}

function handleDormSearch() {
  dormQuery.page = 1;
  loadDorms();
}

function handleDormReset() {
  dormQuery.page = 1;
  dormQuery.dormNo = '';
  dormQuery.building = '';
  dormQuery.roomType = undefined;
  dormQuery.onlyAvailable = false;
  loadDorms();
}

/* ============ 宿舍成员抽屉 ============ */

const membersVisible = ref(false);
const membersLoading = ref(false);
const members = ref<any[]>([]);
const currentDorm = ref<any>({});

async function openMembers(row: any) {
  currentDorm.value = row;
  membersVisible.value = true;
  membersLoading.value = true;
  try {
    members.value = await fetchDormMembers(row.id);
  } catch (e) {
    console.error(e);
  } finally {
    membersLoading.value = false;
  }
}

async function handleCheckout(row: any) {
  try {
    await ElMessageBox.confirm(
      `确定让「${row.studentName}」退宿吗？退宿后床位将被释放。`,
      '退宿确认',
      { type: 'warning', confirmButtonText: '确定退宿', cancelButtonText: '取消' },
    );
  } catch {
    return;
  }
  try {
    await checkoutDorm(row.studentId);
    ElMessage.success('退宿成功');
    members.value = await fetchDormMembers(currentDorm.value.id);
    loadDorms();
    loadStudents();
  } catch (e) {
    // 统一处理
  }
}

/* ============ 待分配学生 ============ */

const studentLoading = ref(false);
const studentList = ref<any[]>([]);
const studentTotal = ref(0);

const studentQuery = reactive<any>({
  page: 1,
  size: 10,
  studentName: '',
  gender: undefined,
});

async function loadStudents() {
  studentLoading.value = true;
  try {
    const data = await fetchUnassignedStudents(studentQuery);
    studentList.value = data.list;
    studentTotal.value = data.total;
  } catch (e) {
    console.error(e);
  } finally {
    studentLoading.value = false;
  }
}

/* ============ 分配宿舍 ============ */

const assignVisible = ref(false);
const assignLoading = ref(false);
const targetDorms = ref<any[]>([]);
const assignTargetDormId = ref('');
const currentStudent = ref<any>({});

/**
 * 打开分配弹窗
 * ⚠️ 只给学生性别对应的宿舍类型，并且只给还有空位的 —— 从源头避免选错
 */
async function openAssign(row: any) {
  currentStudent.value = row;
  assignTargetDormId.value = '';
  assignVisible.value = true;
  assignLoading.value = true;
  try {
    const data = await fetchDormList({
      page: 1,
      size: 100,
      roomType: row.gender === 1 ? DormType.MALE_DORM : DormType.FEMALE_DORM,
      onlyAvailable: true,
    });
    targetDorms.value = data.list;
  } catch (e) {
    console.error(e);
  } finally {
    assignLoading.value = false;
  }
}

async function submitAssign() {
  if (!assignTargetDormId.value) {
    ElMessage.warning('请选择要入住的宿舍');
    return;
  }
  try {
    await assignDorm(currentStudent.value.studentId, assignTargetDormId.value);
    ElMessage.success('分配成功');
    assignVisible.value = false;
    loadDorms();
    loadStudents();
  } catch (e) {
    // 后端会返回性别不匹配 / 床位已满的具体提示
  }
}

/* ============ 宿舍新增 / 编辑 ============ */

const dormDialogVisible = ref(false);
const dormIsEdit = ref(false);
const dormSubmitting = ref(false);
const dormFormRef = ref<FormInstance>();

const defaultDormForm = {
  id: '',
  dormNo: '',
  building: '',
  floor: 1,
  roomType: DormType.MALE_DORM,
  bedTotal: 4,
  remark: '',
};

const dormForm = reactive({ ...defaultDormForm });

const dormRules: FormRules = {
  dormNo: [{ required: true, message: '请输入宿舍号', trigger: 'blur' }],
  building: [{ required: true, message: '请输入楼栋', trigger: 'blur' }],
  floor: [{ required: true, message: '请输入楼层', trigger: 'blur' }],
  roomType: [{ required: true, message: '请选择宿舍类型', trigger: 'change' }],
  bedTotal: [{ required: true, message: '请输入床位数', trigger: 'blur' }],
};

function handleDormAdd() {
  dormIsEdit.value = false;
  Object.assign(dormForm, defaultDormForm);
  dormDialogVisible.value = true;
}

function handleDormEdit(row: any) {
  dormIsEdit.value = true;
  Object.assign(dormForm, {
    id: row.id,
    dormNo: row.dormNo,
    building: row.building,
    floor: row.floor,
    roomType: row.roomType,
    bedTotal: row.bedTotal,
    remark: row.remark || '',
  });
  dormDialogVisible.value = true;
}

async function submitDormForm() {
  const valid = await dormFormRef.value?.validate().catch(() => false);
  if (!valid) return;

  dormSubmitting.value = true;
  try {
    const payload = { ...dormForm };
    if (dormIsEdit.value) {
      await updateDorm(payload as any);
      ElMessage.success('修改成功');
    } else {
      await addDorm(payload as any);
      ElMessage.success('新增成功');
    }
    dormDialogVisible.value = false;
    loadDorms();
  } catch (e) {
    // 统一处理
  } finally {
    dormSubmitting.value = false;
  }
}

async function handleDormDelete(row: any) {
  try {
    await ElMessageBox.confirm(
      `确定删除宿舍「${row.dormNo}」吗？有学生居住时不允许删除。`,
      '删除确认',
      { type: 'warning', confirmButtonText: '确定删除', cancelButtonText: '取消' },
    );
  } catch {
    return;
  }
  try {
    await deleteDorm(row.id);
    ElMessage.success('删除成功');
    loadDorms();
  } catch (e) {
    // 统一处理
  }
}

/** 床位进度条颜色：快满了变橙，满了变红 */
function bedColor(row: any) {
  const rate = row.bedTotal > 0 ? row.bedUsed / row.bedTotal : 0;
  if (rate >= 1) return '#f56c6c';
  if (rate >= 0.7) return '#e6a23c';
  return '#409eff';
}

function bedPercent(row: any) {
  if (!row.bedTotal) return 0;
  return Math.min(100, Math.round((row.bedUsed / row.bedTotal) * 100));
}

onMounted(() => {
  loadDorms();
  loadStudents();
});
</script>

<template>
  <div class="page-container">
    <!-- ============ 宿舍台账 ============ -->
    <el-card shadow="never" class="search-card">
      <el-form :model="dormQuery" inline>
        <el-form-item label="宿舍号">
          <el-input v-model="dormQuery.dormNo" placeholder="如 A-301" clearable style="width: 140px" @keyup.enter="handleDormSearch" />
        </el-form-item>
        <el-form-item label="楼栋">
          <el-input v-model="dormQuery.building" placeholder="如 A 栋" clearable style="width: 130px" @keyup.enter="handleDormSearch" />
        </el-form-item>
        <el-form-item label="宿舍类型">
          <el-select v-model="dormQuery.roomType" placeholder="全部" clearable style="width: 120px">
            <el-option :label="DORM_TYPE_NAME[1]" :value="1" />
            <el-option :label="DORM_TYPE_NAME[2]" :value="2" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-checkbox v-model="dormQuery.onlyAvailable" @change="handleDormSearch">只看有空床位</el-checkbox>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :icon="Search" @click="handleDormSearch">查询</el-button>
          <el-button :icon="Refresh" @click="handleDormReset">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never" class="table-card">
      <div class="toolbar">
        <el-button type="primary" :icon="Plus" @click="handleDormAdd">新增宿舍</el-button>
        <span class="tip">已住人数为实时统计，修改/删除会自动校验床位是否够用</span>
      </div>

      <el-table v-loading="loading" :data="dormList" border stripe style="width: 100%" empty-text="暂无宿舍，先新增一个">
        <el-table-column type="index" label="序号" width="60" align="center" />
        <el-table-column prop="dormNo" label="宿舍号" width="110" />
        <el-table-column prop="building" label="楼栋" width="100" />
        <el-table-column prop="floor" label="楼层" width="80" align="center" />
        <el-table-column label="类型" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="row.roomType === 1 ? 'primary' : 'danger'" size="small" effect="plain">
              {{ row.roomTypeName }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="床位占用" min-width="180">
          <template #default="{ row }">
            <div class="bed-cell">
              <el-progress
                :percentage="bedPercent(row)"
                :stroke-width="12"
                :color="bedColor(row)"
                :format="() => `${row.bedUsed} / ${row.bedTotal}`"
              />
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="120">
          <template #default="{ row }">{{ row.remark || '—' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right" align="center">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openMembers(row)">住宿成员</el-button>
            <el-button link type="primary" size="small" @click="handleDormEdit(row)">编辑</el-button>
            <el-button link type="danger" size="small" @click="handleDormDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        v-model:current-page="dormQuery.page"
        v-model:page-size="dormQuery.size"
        :page-sizes="[10, 20, 50]"
        :total="dormTotal"
        layout="total, sizes, prev, pager, next, jumper"
        style="margin-top: 16px; justify-content: flex-end"
        @size-change="loadDorms"
        @current-change="loadDorms"
      />
    </el-card>

    <!-- ============ 待分配宿舍学生 ============ -->
    <el-card shadow="never" class="table-card">
      <template #header>
        <div class="card-header">
          <span class="card-title">待分配宿舍的学生</span>
          <el-input
            v-model="studentQuery.studentName"
            placeholder="按姓名搜索"
            clearable
            size="small"
            style="width: 200px"
            @keyup.enter="loadStudents"
          >
            <template #append>
              <el-button :icon="Search" @click="loadStudents" />
            </template>
          </el-input>
        </div>
      </template>

      <el-table v-loading="studentLoading" :data="studentList" border stripe style="width: 100%" empty-text="所有学生都已完成宿舍分配">
        <el-table-column type="index" label="序号" width="60" align="center" />
        <el-table-column prop="studentNo" label="学号" width="130" />
        <el-table-column prop="studentName" label="姓名" width="110" />
        <el-table-column label="性别" width="80" align="center">
          <template #default="{ row }">{{ GENDER_NAME[row.gender] }}</template>
        </el-table-column>
        <el-table-column prop="className" label="班级" width="130">
          <template #default="{ row }">{{ row.className || '—' }}</template>
        </el-table-column>
        <el-table-column prop="phone" label="手机号" width="140">
          <template #default="{ row }">{{ row.phone || '—' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="120" align="center">
          <template #default="{ row }">
            <el-button type="primary" size="small" @click="openAssign(row)">分配宿舍</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        v-model:current-page="studentQuery.page"
        v-model:page-size="studentQuery.size"
        :page-sizes="[10, 20, 50]"
        :total="studentTotal"
        layout="total, sizes, prev, pager, next, jumper"
        style="margin-top: 16px; justify-content: flex-end"
        @size-change="loadStudents"
        @current-change="loadStudents"
      />
    </el-card>

    <!-- ============ 分配宿舍弹窗 ============ -->
    <el-dialog v-model="assignVisible" title="分配宿舍" width="460px">
      <el-descriptions :column="2" border class="mb12">
        <el-descriptions-item label="姓名">{{ currentStudent.studentName }}</el-descriptions-item>
        <el-descriptions-item label="学号">{{ currentStudent.studentNo }}</el-descriptions-item>
        <el-descriptions-item label="性别">{{ GENDER_NAME[currentStudent.gender] }}</el-descriptions-item>
        <el-descriptions-item label="班级">{{ currentStudent.className || '—' }}</el-descriptions-item>
      </el-descriptions>

      <el-form label-width="90px">
        <el-form-item label="选择宿舍">
          <el-select
            v-model="assignTargetDormId"
            placeholder="请选择宿舍"
            style="width: 100%"
            :loading="assignLoading"
          >
            <el-option
              v-for="d in targetDorms"
              :key="d.id"
              :label="`${d.dormNo}（${d.roomTypeName} · 剩余 ${d.bedTotal - d.bedUsed} 床）`"
              :value="d.id"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <el-alert
        v-if="!assignLoading && targetDorms.length === 0"
        type="warning"
        :closable="false"
        title="暂无可入住的宿舍"
        description="对应性别的宿舍已住满，请先到上方新增或扩充床位。"
        show-icon
      />

      <template #footer>
        <el-button @click="assignVisible = false">取消</el-button>
        <el-button type="primary" @click="submitAssign">确定分配</el-button>
      </template>
    </el-dialog>

    <!-- ============ 宿舍成员抽屉 ============ -->
    <el-drawer
      v-model="membersVisible"
      :title="currentDorm.dormNo ? `${currentDorm.dormNo} · 住宿成员` : '住宿成员'"
      size="620px"
    >
      <el-table v-loading="membersLoading" :data="members" border stripe empty-text="该宿舍还没有学生入住">
        <el-table-column type="index" label="序号" width="60" align="center" />
        <el-table-column prop="studentNo" label="学号" width="120" />
        <el-table-column prop="studentName" label="姓名" width="100" />
        <el-table-column prop="genderName" label="性别" width="70" align="center" />
        <el-table-column prop="className" label="班级" width="110">
          <template #default="{ row }">{{ row.className || '—' }}</template>
        </el-table-column>
        <el-table-column prop="phone" label="手机号" width="130">
          <template #default="{ row }">{{ row.phone || '—' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="90" align="center">
          <template #default="{ row }">
            <el-button link type="danger" size="small" @click="handleCheckout(row)">退宿</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-drawer>

    <!-- ============ 宿舍新增 / 编辑 ============ -->
    <el-dialog v-model="dormDialogVisible" :title="dormIsEdit ? '编辑宿舍' : '新增宿舍'" width="500px">
      <el-form ref="dormFormRef" :model="dormForm" :rules="dormRules" label-width="90px">
        <el-form-item label="宿舍号" prop="dormNo">
          <el-input v-model="dormForm.dormNo" placeholder="如 A-301" />
        </el-form-item>
        <el-form-item label="楼栋" prop="building">
          <el-input v-model="dormForm.building" placeholder="如 A 栋" />
        </el-form-item>
        <el-form-item label="楼层" prop="floor">
          <el-input-number v-model="dormForm.floor" :min="1" :max="30" controls-position="right" style="width: 100%" />
        </el-form-item>
        <el-form-item label="宿舍类型" prop="roomType">
          <el-radio-group v-model="dormForm.roomType">
            <el-radio :value="1">{{ DORM_TYPE_NAME[1] }}</el-radio>
            <el-radio :value="2">{{ DORM_TYPE_NAME[2] }}</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="总床位" prop="bedTotal">
          <el-input-number v-model="dormForm.bedTotal" :min="1" :max="20" controls-position="right" style="width: 100%" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="dormForm.remark" type="textarea" :rows="2" placeholder="如 带独立卫浴" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dormDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="dormSubmitting" @click="submitDormForm">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page-container {
  padding: 16px;
}

.search-card,
.table-card {
  margin-bottom: 12px;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.card-title {
  font-size: 15px;
  font-weight: 600;
}

.bed-cell {
  padding-top: 6px;
}

.mb12 {
  margin-bottom: 12px;
}
</style>
