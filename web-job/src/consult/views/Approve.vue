<script setup lang="ts">
/**
 * 审批中心（咨询经理专属）
 *
 * 两张待办：
 *   ① 待分配学生 → 分配咨询老师
 *   ② 待我审批的退费申请 → 批准 / 驳回
 */

import { ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { ApproveCenterData } from 'shared-types/consult';
import { ConsultRefundStatus as CRS } from 'shared-types/consult';
import {
  fetchApproveCenter,
  assignOwner,
  fetchConsultants,
  approveRefund,
  rejectRefund,
} from '@/consult/api/consult';

const loading = ref(false);
const data = ref<ApproveCenterData | null>(null);

const assignVisible = ref(false);
const consultants = ref<Array<{ id: string; name: string; title: string }>>([]);
const assignForm = ref({ consultStudentId: '', ownerName: '' });

async function load() {
  loading.value = true;
  try {
    data.value = await fetchApproveCenter();
  } finally {
    loading.value = false;
  }
}

async function openAssign(consultStudentId: string) {
  assignForm.value = { consultStudentId, ownerName: '' };
  if (!consultants.value.length) consultants.value = await fetchConsultants();
  assignVisible.value = true;
}

async function submitAssign() {
  if (!assignForm.value.ownerName) {
    ElMessage.warning('请选择咨询老师');
    return;
  }
  await assignOwner(assignForm.value);
  ElMessage.success('已分配');
  assignVisible.value = false;
  load();
}

async function doApprove(row: any) {
  await ElMessageBox.confirm(
    `确认批准「${row.studentName}」退费 ¥${(row.refundAmount / 100).toFixed(2)}？`,
    '审批通过',
    { type: 'warning' },
  );
  await approveRefund(row.refundId);
  ElMessage.success('已批准，已上报财务');
  load();
}

async function doReject(row: any) {
  const { value } = await ElMessageBox.prompt('请输入驳回原因', '驳回退费', {
    inputValidator: (v) => (!!v?.trim() ? true : '驳回原因必填'),
  });
  await rejectRefund(row.refundId, value.trim());
  ElMessage.success('已驳回');
  load();
}

const fmtMoney = (cent?: number) => (cent == null ? '—' : `¥${(cent / 100).toFixed(2)}`);

onMounted(load);
</script>

<template>
  <div v-loading="loading" class="page">
    <!-- 待分配学生 -->
    <el-card shadow="never">
      <template #header>
        <div class="card-head">
          <span>待分配学生</span>
          <el-tag size="small" type="warning">
            {{ data?.pendingAssignList?.length || 0 }} 条待办
          </el-tag>
        </div>
      </template>

      <el-table v-if="data?.pendingAssignList?.length" :data="data.pendingAssignList" size="small">
        <el-table-column prop="studentName" label="学生" min-width="110" />
        <el-table-column prop="source" label="来源" min-width="150" />
        <el-table-column prop="phone" label="联系方式" min-width="130" />
        <el-table-column prop="creatorName" label="建档人" min-width="140" />
        <el-table-column prop="createTime" label="建档时间" min-width="140" />
        <el-table-column label="操作" width="100" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openAssign(row.consultStudentId)">
              分配
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-else description="暂无待分配学生" :image-size="70" />
    </el-card>

    <!-- 待审批退费 -->
    <el-card shadow="never">
      <template #header>
        <div class="card-head">
          <span>待我审批的退费申请</span>
          <el-tag size="small" type="warning">
            {{ data?.pendingRefundList?.length || 0 }} 条待办
          </el-tag>
        </div>
      </template>

      <el-table v-if="data?.pendingRefundList?.length" :data="data.pendingRefundList" size="small">
        <el-table-column prop="studentName" label="学生" min-width="110" />
        <el-table-column prop="applyByName" label="发起人" min-width="110" />
        <el-table-column label="试学天数" width="100" align="center">
          <template #default="{ row }">{{ row.trialDays }} 天</template>
        </el-table-column>
        <el-table-column label="消耗扣减" width="120">
          <template #default="{ row }">
            <span class="warn">{{ fmtMoney(row.deductTotal) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="应退金额" width="120">
          <template #default="{ row }">
            <b class="ok">{{ fmtMoney(row.refundAmount) }}</b>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <el-button link type="success" @click="doApprove(row)">批准</el-button>
            <el-button link type="danger" @click="doReject(row)">驳回</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-else description="暂无待审批退费" :image-size="70" />
    </el-card>

    <!-- 分配弹窗 -->
    <el-dialog v-model="assignVisible" title="分配咨询老师" width="420px">
      <el-select v-model="assignForm.ownerName" placeholder="请选择咨询老师" style="width: 100%">
        <el-option
          v-for="c in consultants"
          :key="c.id"
          :value="c.name"
          :label="`${c.name}（${c.title}）`"
        />
      </el-select>
      <template #footer>
        <el-button @click="assignVisible = false">取消</el-button>
        <el-button type="primary" @click="submitAssign">确定分配</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
}

.ok {
  color: #67c23a;
}

.warn {
  color: #e6a23c;
}
</style>
