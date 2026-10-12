<script setup lang="ts">
/**
 * 退费详情弹窗（含审批日志）
 */

import { ref, watch, computed } from 'vue';
import type { RefundDetail } from 'shared-types/class-jh';
import { REFUND_STATUS_NAME } from 'shared-types/class-jh';
import { fetchRefundDetail } from '@/class-jh/api/refund';
import { dash, formatAmount, formatDate, formatDateTime, refundStatusTagType } from '@/class-jh/utils/format';

const props = defineProps<{
  modelValue: boolean;
  refundId?: string;
}>();
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void;
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
});

const loading = ref(false);
const detail = ref<RefundDetail | null>(null);

async function load() {
  if (!props.refundId) return;
  loading.value = true;
  try {
    detail.value = await fetchRefundDetail(props.refundId);
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

/** 节点状态中文名 */
function nodeName(status: number): string {
  return REFUND_STATUS_NAME[status] || String(status);
}
</script>

<template>
  <el-dialog v-model="visible" title="退费详情" width="720px">
    <div v-loading="loading">
      <template v-if="detail">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="学号">{{ detail.studentNo }}</el-descriptions-item>
          <el-descriptions-item label="姓名">{{ detail.studentName }}</el-descriptions-item>
          <el-descriptions-item label="班级">{{ dash(detail.className) }}</el-descriptions-item>
          <el-descriptions-item label="退费类型">{{ detail.feeTypeName }}</el-descriptions-item>
          <el-descriptions-item label="退费金额">{{ formatAmount(detail.refundAmount) }}</el-descriptions-item>
          <el-descriptions-item label="申请日期">{{ formatDate(detail.applyDate) }}</el-descriptions-item>
          <el-descriptions-item label="退费状态">
            <el-tag :type="refundStatusTagType(detail.refundStatus)" size="small">{{ detail.refundStatusName }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="当前处理人">{{ dash(detail.currentHandlerName) }}</el-descriptions-item>
          <el-descriptions-item label="退费原因" :span="2">{{ dash(detail.refundReason) }}</el-descriptions-item>
          <el-descriptions-item label="班主任意见" :span="2">{{ dash(detail.headTeacherOpinion) }}</el-descriptions-item>
          <el-descriptions-item label="出款时间">{{ formatDateTime(detail.payOutTime) }}</el-descriptions-item>
          <el-descriptions-item label="出款凭证号">{{ dash(detail.payOutVoucherNo) }}</el-descriptions-item>
        </el-descriptions>

        <el-divider content-position="left">审批日志</el-divider>
        <el-table :data="detail.logs || []" border stripe size="small" empty-text="暂无审批记录">
          <el-table-column type="index" label="序号" width="60" align="center" />
          <el-table-column label="节点" width="130">
            <template #default="{ row }">{{ nodeName(row.nodeStatus) }}</template>
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
