<script setup lang="ts">
/**
 * 流程详情弹窗（含审批日志）
 */

import { ref, watch, computed } from 'vue';
import type { FlowDetail } from 'shared-types/class-jh';
import { fetchFlowDetail } from '@/class-jh/api/flow';
import { dash, formatDate, formatDateTime, flowStatusTagType } from '@/class-jh/utils/format';

const props = defineProps<{
  modelValue: boolean;
  flowId?: string;
}>();
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void;
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
});

const loading = ref(false);
const detail = ref<FlowDetail | null>(null);

async function load() {
  if (!props.flowId) return;
  loading.value = true;
  try {
    detail.value = await fetchFlowDetail(props.flowId);
  } catch {
    detail.value = null;
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) load();
  },
);
</script>

<template>
  <el-dialog v-model="visible" title="流程详情" width="720px">
    <div v-loading="loading">
      <template v-if="detail">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="流程类型">{{ detail.flowTypeName }}</el-descriptions-item>
          <el-descriptions-item label="流程状态">
            <el-tag :type="flowStatusTagType(detail.flowStatus)" size="small">{{ detail.flowStatusName }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="学生">{{ dash(detail.studentName) }}</el-descriptions-item>
          <el-descriptions-item label="学号">{{ dash(detail.studentNo) }}</el-descriptions-item>
          <el-descriptions-item label="班级">{{ dash(detail.className) }}</el-descriptions-item>
          <el-descriptions-item label="发起人">{{ dash(detail.applyUserName) }}</el-descriptions-item>
          <el-descriptions-item label="发起时间">{{ formatDateTime(detail.applyTime) }}</el-descriptions-item>
          <el-descriptions-item label="当前节点">{{ dash(detail.currentNodeName) }}</el-descriptions-item>
          <el-descriptions-item label="申请原因" :span="2">{{ dash(detail.applyReason) }}</el-descriptions-item>
          <template v-if="detail.suspendStartDate || detail.expectResumeDate || detail.suspendReason">
            <el-descriptions-item label="休学开始日">{{ formatDate(detail.suspendStartDate) }}</el-descriptions-item>
            <el-descriptions-item label="预计复学日">{{ formatDate(detail.expectResumeDate) }}</el-descriptions-item>
            <el-descriptions-item label="休/退原因" :span="2">{{ dash(detail.suspendReason) }}</el-descriptions-item>
          </template>
          <template v-if="detail.toClassId">
            <el-descriptions-item label="原班级">{{ dash(detail.fromClassId) }}</el-descriptions-item>
            <el-descriptions-item label="新班级">{{ dash(detail.toClassId) }}</el-descriptions-item>
          </template>
          <el-descriptions-item v-if="detail.rejectReason" label="驳回原因" :span="2">{{ detail.rejectReason }}</el-descriptions-item>
        </el-descriptions>

        <el-divider content-position="left">审批日志</el-divider>
        <el-table :data="detail.logs || []" border stripe size="small" empty-text="暂无审批记录">
          <el-table-column type="index" label="序号" width="60" align="center" />
          <el-table-column label="节点" width="130">
            <template #default="{ row }">{{ dash(row.nodeName) }}</template>
          </el-table-column>
          <el-table-column label="审批人" width="110">
            <template #default="{ row }">{{ dash(row.approveUserName) }}</template>
          </el-table-column>
          <el-table-column label="结果" width="90" align="center">
            <template #default="{ row }">
              <el-tag size="small" :type="row.approveResult === 1 ? 'success' : 'danger'">
                {{ row.approveResult === 1 ? '同意' : '驳回' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="审批时间" width="170">
            <template #default="{ row }">{{ formatDateTime(row.approveTime) }}</template>
          </el-table-column>
          <el-table-column label="备注">
            <template #default="{ row }">{{ dash(row.rejectReason || row.remark) }}</template>
          </el-table-column>
        </el-table>
      </template>
      <el-empty v-else description="暂无数据" />
    </div>
  </el-dialog>
</template>
