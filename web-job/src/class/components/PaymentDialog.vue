<template>
  <el-dialog
    v-model="visible"
    :title="`缴费情况 · ${studentName}`"
    width="720px"
    destroy-on-close
    @open="load"
  >
    <div v-loading="loading">
      <div v-if="summary" class="kpi-row three">
        <div class="kpi">
          <div class="kpi-l">应缴合计</div>
          <div class="kpi-v"><small>¥</small>{{ summary.totalAmountYuan }}</div>
        </div>
        <div class="kpi k-green">
          <div class="kpi-l">已缴合计</div>
          <div class="kpi-v"><small>¥</small>{{ summary.totalPaidYuan }}</div>
        </div>
        <div class="kpi" :class="Number(summary.totalUnpaid) > 0 ? 'k-red' : 'k-green'">
          <div class="kpi-l">待缴合计</div>
          <div class="kpi-v"><small>¥</small>{{ summary.totalUnpaidYuan }}</div>
        </div>
      </div>

      <div class="dl-title section-gap">按费用类型汇总</div>
      <el-table :data="summary?.items ?? []" size="small" border empty-text="暂无缴费数据">
        <el-table-column prop="feeTypeName" label="费用类型" width="110" />
        <el-table-column label="应缴（元）" width="130" align="right">
          <template #default="{ row }"><span class="money">{{ row.amountYuan }}</span></template>
        </el-table-column>
        <el-table-column label="已缴（元）" width="130" align="right">
          <template #default="{ row }"><span class="money">{{ row.paidYuan }}</span></template>
        </el-table-column>
        <el-table-column label="待缴（元）" width="130" align="right">
          <template #default="{ row }">
            <span class="money" :class="{ overdue: Number(row.unpaidYuan) > 0 }">{{ row.unpaidYuan }}</span>
          </template>
        </el-table-column>
      </el-table>

      <div class="dl-title section-gap">缴费明细（来自财务管理 · 缴费管理）</div>
      <el-table :data="detail" size="small" border max-height="260" empty-text="暂无缴费记录">
        <el-table-column prop="feeTypeName" label="费用类型" width="96" />
        <el-table-column label="费用周期" width="96" align="center">
          <template #default="{ row }">{{ row.period || '—' }}</template>
        </el-table-column>
        <el-table-column label="部门" width="86" align="center">
          <template #default="{ row }">{{ row.deptName || '—' }}</template>
        </el-table-column>
        <el-table-column prop="amountYuan" label="应缴（元）" width="106" align="right" />
        <el-table-column prop="paidAmountYuan" label="已缴（元）" width="106" align="right">
          <template #default="{ row }">
            <span class="money" :class="{ paid: Number(row.paidAmount) > 0 }">
              {{ row.paidAmountYuan }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="118">
          <template #default="{ row }">
            <el-tag :type="row.payStatus === 2 || row.payStatus === 3 ? 'success' : 'warning'" size="small" effect="light">
              {{ row.payStatusName }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="payDate" label="缴费日期" width="118" align="center">
          <template #default="{ row }">{{ row.payDate || '—' }}</template>
        </el-table-column>
        <el-table-column label="到期日期" width="118" align="center">
          <template #default="{ row }">{{ row.expireDate || '—' }}</template>
        </el-table-column>
        <el-table-column prop="payMethod" label="缴费方式" min-width="96">
          <template #default="{ row }">{{ row.payMethod || '—' }}</template>
        </el-table-column>
      </el-table>

      <div class="note-box section-gap">
        需求三：缴费信息<b>同步财务管理 · 缴费管理的缴费信息</b>，本模块只读；
        大学部在财务侧对应<b>「大学部」</b>部门（初高学部对应「二三期」）。如需核对或补录请联系财务。
      </div>
    </div>

    <template #footer>
      <el-button @click="visible = false">关闭</el-button>
      <el-button type="primary" @click="exportDetail">导出缴费明细</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { feeList, feeSummary } from '@/class/api/student';
import type { FeeRow } from '@/class/api/types';

/**
 * 缴费情况（列表行操作「缴费情况」）
 *
 * 数据全部来自 `t_class_fee_sync`（← 财务管理同步），前端不做任何金额计算，
 * 只展示后端已经算好的 xxYuan 字符串字段，避免前后端两套算法对不上。
 */
const props = defineProps<{ modelValue: boolean; studentId: string; studentName?: string }>();
const emit = defineEmits<{ 'update:modelValue': [boolean] }>();

interface SummaryItem {
  feeType: number;
  feeTypeName: string;
  amount: number;
  paid: number;
  amountYuan: string;
  paidYuan: string;
  unpaidYuan: string;
}
interface Summary {
  totalAmount: number;
  totalPaid: number;
  totalUnpaid: number;
  totalAmountYuan: string;
  totalPaidYuan: string;
  totalUnpaidYuan: string;
  items: SummaryItem[];
}

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const loading = ref(false);
const summary = ref<Summary | null>(null);
const detail = ref<FeeRow[]>([]);

async function load(): Promise<void> {
  if (!props.studentId) return;
  loading.value = true;
  try {
    const [s, l] = await Promise.all([
      feeSummary(props.studentId),
      feeList({ page: 1, size: 50, studentId: props.studentId }),
    ]);
    summary.value = s as unknown as Summary;
    detail.value = l.list ?? [];
  } finally {
    loading.value = false;
  }
}

function exportDetail(): void {
  ElMessage.info('原型阶段：导出缴费明细待「财务管理」提供导出接口后接入');
}
</script>

<style scoped>
.kpi-row.three {
  grid-template-columns: repeat(3, 1fr);
  margin-bottom: 0;
}
/* ★ 2026-10-06：已缴金额高亮（与初高 / 实训两处详情同一口径） */
.money.paid {
  color: var(--el-color-success);
  font-weight: 600;
}
</style>
