<template>
  <div class="trf">
    <!-- ★ 把"走哪几步"显式告诉用户（合并后审批链变了，不能让人猜） -->
    <el-alert class="trf-chain" type="info" :closable="false" show-icon>
      <template #title>
        本模块审批链（三学段统一）：
        <b>班主任 / 项目经理发起 → 学管审批 → 校长审批 → 通过后通知财务出款</b>
      </template>
    </el-alert>

    <!-- 汇总卡片 -->
    <div class="trf-cards">
      <div v-for="s in summaries" :key="s.stage" class="trf-card">
        <div class="trf-card__head">{{ s.stageName }}</div>
        <div class="trf-card__row">
          <span>共 <b>{{ s.total }}</b> 单</span>
          <span class="warn">审批中 <b>{{ s.pendingCount }}</b></span>
          <span class="ok">已通过 <b>{{ s.approvedCount }}</b></span>
          <span class="bad">已驳回 <b>{{ s.rejectedCount }}</b></span>
        </div>
        <div class="trf-card__amt">已通过金额：¥{{ fmtCent(s.approvedAmount) }}</div>
      </div>
      <el-empty v-if="!summaries.length" description="当前账号没有可访问的学段" :image-size="60" />
    </div>

    <!-- 筛选栏 -->
    <el-form class="trf-filter" inline>
      <el-form-item label="学段">
        <el-select v-model="query.stage" clearable placeholder="全部学段" style="width: 130px">
          <el-option v-for="s in stageOptions" :key="s.value" :label="s.label" :value="s.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="状态">
        <el-select v-model="query.status" clearable placeholder="全部" style="width: 140px">
          <el-option v-for="(n, v) in REFUND_STATUS_NAME" :key="v" :label="n" :value="Number(v)" />
        </el-select>
      </el-form-item>
      <el-form-item label="关键字">
        <el-input
          v-model="query.keyword"
          placeholder="学生姓名 / 学号"
          clearable
          style="width: 180px"
          @keyup.enter="load(1)"
        />
      </el-form-item>
      <el-form-item>
        <el-checkbox v-model="query.onlyMine">只看待我审批</el-checkbox>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="load(1)">查询</el-button>
        <el-button @click="reset">重置</el-button>
        <el-button type="success" @click="openCreate">发起退费</el-button>
      </el-form-item>
    </el-form>

    <!-- 列表 -->
    <el-table v-loading="loading" :data="rows" border stripe size="small">
      <el-table-column v-if="!query.stage" label="学段" width="70" align="center">
        <template #default="{ row }">{{ row.stageName }}</template>
      </el-table-column>
      <el-table-column label="学生" min-width="130">
        <template #default="{ row }">
          {{ row.studentName }}
          <span class="muted">{{ row.studentNo }}</span>
        </template>
      </el-table-column>
      <el-table-column label="班级" min-width="120">
        <template #default="{ row }">{{ row.className || '—' }}</template>
      </el-table-column>
      <el-table-column label="费用类型" min-width="110">
        <template #default="{ row }">{{ row.feeTypeName || '—' }}</template>
      </el-table-column>
      <el-table-column label="退费金额" width="110" align="right">
        <template #default="{ row }">
          <b>¥{{ row.refundAmountText }}</b>
        </template>
      </el-table-column>
      <el-table-column label="申请日期" width="105" align="center">
        <template #default="{ row }">{{ row.applyDate || '—' }}</template>
      </el-table-column>
      <el-table-column label="状态" width="105" align="center">
        <template #default="{ row }">
          <el-tag :type="tagType(row.approvalStatus)" size="small">
            {{ row.approvalStatusName }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="当前处理" width="110" align="center">
        <template #default="{ row }">
          <span class="muted">{{ row.currentHandlerHint || '—' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="250" fixed="right" align="center">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="openDetail(row)">详情</el-button>
          <el-button
            v-if="row.canSubmit"
            link
            type="primary"
            size="small"
            @click="doSubmit(row)"
          >
            提交
          </el-button>
          <el-button v-if="row.canApprove" link type="success" size="small" @click="doApprove(row)">
            审批通过
          </el-button>
          <el-button v-if="row.canApprove" link type="danger" size="small" @click="doReject(row)">
            驳回
          </el-button>
          <el-button v-if="row.canCancel" link type="warning" size="small" @click="doCancel(row)">
            撤回
          </el-button>
          <el-button
            v-if="row.approvalStatus === REFUND_STATUS.APPROVED && canFinanceConfirm"
            link
            type="info"
            size="small"
            @click="doFinanceConfirm(row)"
          >
            登记出款
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination
      class="trf-page"
      :current-page="query.page"
      :page-size="query.size"
      :total="total"
      layout="total, prev, pager, next"
      @current-change="(p: number) => load(p)"
    />

    <!-- 新建对话框 -->
    <el-dialog v-model="createVisible" title="发起退费申请" width="640px">
      <el-form label-width="90px">
        <el-form-item label="学段" required>
          <el-select v-model="form.stage" style="width: 160px" @change="onStageChange">
            <el-option v-for="s in stageOptions" :key="s.value" :label="s.label" :value="s.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="学生" required>
          <el-select
            v-model="form.studentId"
            filterable
            remote
            reserve-keyword
            placeholder="输入姓名 / 学号搜索"
            :remote-method="searchStudents"
            :loading="stuLoading"
            style="width: 100%"
          >
            <el-option
              v-for="s in students"
              :key="s.id"
              :label="`${s.name}（${s.no}）${s.className ? ' · ' + s.className : ''}`"
              :value="s.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="费用项" required>
          <div v-for="(it, i) in form.items" :key="i" class="trf-item">
            <el-select v-model="it.feeType" style="width: 150px">
              <el-option v-for="o in FEE_TYPE_OPTIONS" :key="o.value" :label="o.label" :value="o.value" />
            </el-select>
            <el-input-number
              v-model="it.yuan"
              :min="0"
              :precision="2"
              :step="100"
              controls-position="right"
              style="width: 180px"
            />
            <span class="muted">元</span>
            <el-button v-if="form.items.length > 1" link type="danger" @click="form.items.splice(i, 1)">
              删除
            </el-button>
          </div>
          <el-button link type="primary" @click="form.items.push({ feeType: 1, yuan: 0 })">
            + 增加一项
          </el-button>
        </el-form-item>
        <el-form-item label="退费总额">
          <b class="amt">¥{{ formTotalText }}</b>
          <span class="muted">（自动汇总各项）</span>
        </el-form-item>
        <el-form-item label="申请日期">
          <el-date-picker v-model="form.applyDate" type="date" value-format="YYYY-MM-DD" style="width: 180px" />
        </el-form-item>
        <el-form-item label="退费原因" required>
          <el-input v-model="form.refundReason" type="textarea" :rows="3" maxlength="500" show-word-limit />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button :loading="saving" @click="doCreate(false)">保存草稿</el-button>
        <el-button type="primary" :loading="saving" @click="doCreate(true)">保存并提交</el-button>
      </template>
    </el-dialog>

    <!-- 详情对话框 -->
    <el-dialog v-model="detailVisible" title="退费单详情" width="680px">
      <template v-if="detail">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="学段">{{ detail.record.stageName }}</el-descriptions-item>
          <el-descriptions-item label="学生">
            {{ detail.record.studentName }}（{{ detail.record.studentNo }}）
          </el-descriptions-item>
          <el-descriptions-item label="班级">{{ detail.record.className || '—' }}</el-descriptions-item>
          <el-descriptions-item label="申请日期">{{ detail.record.applyDate || '—' }}</el-descriptions-item>
          <el-descriptions-item label="费用类型">{{ detail.record.feeTypeName || '—' }}</el-descriptions-item>
          <el-descriptions-item label="退费金额">
            <b>¥{{ detail.record.refundAmountText }}</b>
          </el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="tagType(detail.record.approvalStatus)" size="small">
              {{ detail.record.approvalStatusName }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="当前处理">
            {{ detail.record.currentHandlerHint || '—' }}
          </el-descriptions-item>
          <el-descriptions-item label="退费原因" :span="2">
            {{ detail.record.refundReason || '—' }}
          </el-descriptions-item>
          <el-descriptions-item v-if="detail.record.refundTime" label="出款时间" :span="2">
            {{ detail.record.refundTime }}
          </el-descriptions-item>
        </el-descriptions>

        <el-divider content-position="left">费用项明细</el-divider>
        <el-table :data="detail.record.items" size="small" border>
          <el-table-column label="费用类型">
            <template #default="{ row }">{{ row.feeTypeName }}</template>
          </el-table-column>
          <el-table-column label="金额" align="right">
            <template #default="{ row }">¥{{ row.amountText }}</template>
          </el-table-column>
        </el-table>

        <el-divider content-position="left">审批轨迹</el-divider>
        <el-empty v-if="!detail.logs.length" description="暂无审批轨迹" :image-size="50" />
        <el-timeline v-else>
          <el-timeline-item
            v-for="(l, i) in detail.logs"
            :key="i"
            :timestamp="l.time || ''"
            placement="top"
          >
            <b>{{ l.operatorName }}</b> · {{ l.actionName }}（{{ l.nodeName }}）
            <div v-if="l.comment" class="muted">{{ l.comment }}</div>
          </el-timeline-item>
        </el-timeline>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
/**
 * 退费管理 · 统一页（第 2 期第 4 个域）
 *
 * ★ 一个页面取代原来三套（初高 / 大学 / 实训），靠顶部「学段」筛选切换。
 * ★ 审批链统一采用实训那套（学管 → 校长），与后端 `service.ts` 口径一致。
 * ★ 金额：接口一律传「分」，页面用「元」输入/展示。
 */
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  FEE_TYPE_OPTIONS,
  REFUND_STATUS,
  REFUND_STATUS_NAME,
  STAGE_NAME,
  approveRefund,
  cancelRefund,
  createRefund,
  financeConfirm,
  getRefundDetail,
  getRefundSummary,
  listRefunds,
  listStudentOptions,
  rejectRefund,
  submitRefund,
  type RefundDetail,
  type RefundRow,
  type RefundSummary,
  type StudentOption,
  type TeachingStage,
} from '../api/refund';

const loading = ref(false);
const saving = ref(false);
const rows = ref<RefundRow[]>([]);
const total = ref(0);
const summaries = ref<RefundSummary[]>([]);
const stageOptions = ref<Array<{ value: TeachingStage; label: string }>>([]);

const query = reactive({
  stage: undefined as TeachingStage | undefined,
  status: undefined as number | undefined,
  keyword: '',
  onlyMine: false,
  page: 1,
  size: 20,
});

/** 财务登记出款按钮：仅财务 / 管理员看到（后端有二次校验） */
const canFinanceConfirm = ref(false);

/* ---------------- 加载 ---------------- */

function tagType(s: number) {
  if (s === REFUND_STATUS.APPROVED) return 'success';
  if (s === REFUND_STATUS.REJECTED) return 'danger';
  if (s === REFUND_STATUS.PENDING_MANAGER || s === REFUND_STATUS.PENDING_PRINCIPAL) return 'warning';
  return 'info';
}

function fmtCent(cent: number) {
  return (Number(cent || 0) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2 });
}

async function load(p = query.page) {
  query.page = p;
  loading.value = true;
  try {
    const res = await listRefunds({
      stage: query.stage,
      status: query.status,
      keyword: query.keyword || undefined,
      onlyMine: query.onlyMine || undefined,
      page: query.page,
      size: query.size,
    });
    rows.value = res.list || [];
    total.value = res.total || 0;
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '加载失败');
  } finally {
    loading.value = false;
  }
}

async function loadSummary() {
  try {
    const list = await getRefundSummary();
    summaries.value = list || [];
    stageOptions.value = (list || []).map((s) => ({ value: s.stage, label: s.stageName }));
  } catch {
    /* 汇总失败不影响主流程 */
  }
}

function reset() {
  query.stage = undefined;
  query.status = undefined;
  query.keyword = '';
  query.onlyMine = false;
  load(1);
}

onMounted(async () => {
  await loadSummary();
  await load(1);
});

/* ---------------- 新建 ---------------- */

const createVisible = ref(false);
const students = ref<StudentOption[]>([]);
const stuLoading = ref(false);

const form = reactive<{
  stage: TeachingStage;
  studentId: string;
  items: Array<{ feeType: number; yuan: number }>;
  applyDate: string;
  refundReason: string;
}>({
  stage: 'job',
  studentId: '',
  items: [{ feeType: 1, yuan: 0 }],
  applyDate: '',
  refundReason: '',
});

const formTotalText = computed(() =>
  form.items.reduce((a, x) => a + Number(x.yuan || 0), 0).toFixed(2),
);

function openCreate() {
  form.stage = (query.stage || stageOptions.value[0]?.value || 'job') as TeachingStage;
  form.studentId = '';
  form.items = [{ feeType: 1, yuan: 0 }];
  form.applyDate = '';
  form.refundReason = '';
  students.value = [];
  createVisible.value = true;
  searchStudents('');
}

function onStageChange() {
  form.studentId = '';
  students.value = [];
  searchStudents('');
}

async function searchStudents(kw: string) {
  if (!form.stage) return;
  stuLoading.value = true;
  try {
    students.value = (await listStudentOptions(form.stage, kw)) || [];
  } catch {
    students.value = [];
  } finally {
    stuLoading.value = false;
  }
}

async function doCreate(submit: boolean) {
  if (!form.studentId) return ElMessage.warning('请选择学生');
  if (!form.refundReason.trim()) return ElMessage.warning('请填写退费原因');
  const items = form.items.map((x) => ({
    feeType: x.feeType,
    amount: Math.round(Number(x.yuan || 0) * 100),
  }));
  const refundAmount = items.reduce((a, x) => a + x.amount, 0);
  if (refundAmount <= 0) return ElMessage.warning('退费金额必须大于 0');

  saving.value = true;
  try {
    await createRefund({
      stage: form.stage,
      studentId: form.studentId,
      items,
      refundAmount,
      applyDate: form.applyDate || undefined,
      refundReason: form.refundReason,
      submit,
    });
    ElMessage.success(submit ? '已创建并提交，等待学管审批' : '已保存草稿');
    createVisible.value = false;
    await Promise.all([load(1), loadSummary()]);
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '创建失败');
  } finally {
    saving.value = false;
  }
}

/* ---------------- 详情 ---------------- */

const detailVisible = ref(false);
const detail = ref<RefundDetail | null>(null);

async function openDetail(row: RefundRow) {
  try {
    detail.value = await getRefundDetail(row.id);
    detailVisible.value = true;
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '加载详情失败');
  }
}

/* ---------------- 动作 ---------------- */

async function doSubmit(row: RefundRow) {
  try {
    await submitRefund(row.stage, row.id);
    ElMessage.success('已提交');
    await Promise.all([load(), loadSummary()]);
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '提交失败');
  }
}

async function doApprove(row: RefundRow) {
  try {
    const { value } = await ElMessageBox.prompt('审批意见（可空）', '审批通过', {
      inputPlaceholder: '可填写审批意见',
      confirmButtonText: '通过',
      cancelButtonText: '取消',
      inputValue: '',
    });
    const r = await approveRefund(row.stage, row.id, value || undefined);
    ElMessage.success(
      r.finished
        ? r.pushed
          ? '审批通过，已通知财务出款'
          : '审批通过（推送财务失败，请人工补录）'
        : '本环节已通过，流转到下一节点',
    );
    await Promise.all([load(), loadSummary()]);
  } catch (e: any) {
    if (e === 'cancel' || e?.message === 'cancel') return;
    ElMessage.error(e?.response?.data?.message || e?.message || '审批失败');
  }
}

async function doReject(row: RefundRow) {
  try {
    const { value } = await ElMessageBox.prompt('请填写驳回原因（必填）', '驳回退费申请', {
      inputPlaceholder: '驳回原因会通知到发起人',
      confirmButtonText: '确认驳回',
      cancelButtonText: '取消',
      inputValidator: (v: string) => (v && v.trim() ? true : '驳回原因必填'),
    });
    await rejectRefund(row.stage, row.id, value);
    ElMessage.success('已驳回');
    await Promise.all([load(), loadSummary()]);
  } catch (e: any) {
    if (e === 'cancel' || e?.message === 'cancel') return;
    ElMessage.error(e?.response?.data?.message || e?.message || '驳回失败');
  }
}

async function doCancel(row: RefundRow) {
  try {
    const { value } = await ElMessageBox.prompt('撤回原因（可空）', '撤回申请', {
      confirmButtonText: '确认撤回',
      cancelButtonText: '取消',
      inputValue: '',
    });
    await cancelRefund(row.stage, row.id, value || undefined);
    ElMessage.success('已撤回');
    await Promise.all([load(), loadSummary()]);
  } catch (e: any) {
    if (e === 'cancel' || e?.message === 'cancel') return;
    ElMessage.error(e?.response?.data?.message || e?.message || '撤回失败');
  }
}

async function doFinanceConfirm(row: RefundRow) {
  try {
    const { value } = await ElMessageBox.prompt('出款备注（可空）', '登记出款', {
      confirmButtonText: '确认',
      cancelButtonText: '取消',
      inputValue: '',
    });
    await financeConfirm(row.stage, row.id, { financeRemark: value || undefined });
    ElMessage.success('已登记出款');
    await load();
  } catch (e: any) {
    if (e === 'cancel' || e?.message === 'cancel') return;
    ElMessage.error(e?.response?.data?.message || e?.message || '登记失败');
  }
}
</script>

<style scoped>
.trf {
  padding: 12px;
}
.trf-chain {
  margin-bottom: 12px;
}
.trf-cards {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.trf-card {
  flex: 1 1 220px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  padding: 10px 12px;
}
.trf-card__head {
  font-weight: 600;
  margin-bottom: 6px;
}
.trf-card__row {
  display: flex;
  gap: 12px;
  font-size: 13px;
  flex-wrap: wrap;
}
.trf-card__amt {
  margin-top: 6px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.warn {
  color: var(--el-color-warning);
}
.ok {
  color: var(--el-color-success);
}
.bad {
  color: var(--el-color-danger);
}
.trf-filter {
  margin-bottom: 8px;
}
.trf-page {
  margin-top: 10px;
  justify-content: flex-end;
}
.trf-item {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.muted {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  margin-left: 4px;
}
.amt {
  color: var(--el-color-danger);
  font-size: 16px;
}
</style>
