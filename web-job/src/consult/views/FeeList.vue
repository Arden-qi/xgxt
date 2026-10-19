<script setup lang="ts">
/**
 * 收款与缴费
 *
 * 规则在此页的体现：
 *   - 规则2：发起收费时金额由财务按「费用标准」取值，页面只展示预览值，不让手填
 *   - 规则3-①：只能发起咨询模块负责的费用类型（学费 / 试学费），其他类型调用会被拒
 *   - 规则3-②：上传凭证时，非餐费一人一张；重复时财务拒绝并提示占用方
 */

import { ref, onMounted, computed } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type {
  ConsultFeeOrder,
  ConsultFeeStats,
  FinanceStandardView,
  ConsultStudentListItem,
} from 'shared-types/consult';
import {
  FeeType,
  FEE_TYPE_NAME,
  CONSULT_FEE_STATUS_NAME,
  ConsultFeeStatus,
  ConsultState as CS,
} from 'shared-types/consult';
import {
  fetchFeeList,
  fetchFeeStats,
  createFees,
  uploadFile,
  uploadVoucher,
  resubmitOrder,
  fetchStandardBatch,
  fetchOpenClasses,
  enrollToClass,
  fetchAssignStatus,
  fetchStudentList,
  type OpenClassItem,
  type AssignStatusItem,
} from '@/consult/api/consult';
import { useAuthStore } from '@/consult/stores/auth';

const auth = useAuthStore();

/* ---------- 列表 ---------- */
const loading = ref(false);
const list = ref<ConsultFeeOrder[]>([]);
const total = ref(0);

/** 分页总页数（原型 pager 里的「第 N/M 页」） */
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / (size.value || 20))));
const page = ref(1);
const size = ref(10);
const query = ref({
  keyword: '',
  feeType: undefined as number | undefined,
  status: undefined as number | undefined,
});

const stats = ref<ConsultFeeStats | null>(null);

async function load() {
  loading.value = true;
  try {
    const [res, st] = await Promise.all([
      fetchFeeList({
        page: page.value,
        size: size.value,
        keyword: query.value.keyword || undefined,
        feeType: query.value.feeType,
        status: query.value.status,
      }),
      fetchFeeStats(),
    ]);
    list.value = res.list;
    total.value = res.total;
    stats.value = st;
    void loadAssignStatus();
  } finally {
    loading.value = false;
  }
}

/* ---------- ★ 2026-10-06 分班状态：已分班不可再分派，驳回后可再分派 ---------- */
/**
 * 每个学生当前分到哪一步了（来自班级 / 初高侧的权威状态）。
 * 「分班」按钮只在 canAssign 时可用 —— 已推送/已接收的是禁用并提示原因。
 */
const assignStatus = ref<Record<string, AssignStatusItem>>({});

async function loadAssignStatus() {
  const ids = Array.from(
    new Set(list.value.map((r) => r.consultStudentId).filter(Boolean) as string[]),
  );
  if (!ids.length) {
    assignStatus.value = {};
    return;
  }
  try {
    assignStatus.value = await fetchAssignStatus(ids);
  } catch {
    // 查不到不阻塞页面：按「可点」展示，后端 /enroll-to-class 仍会二次拦截
    assignStatus.value = {};
  }
}

/**
 * ★ 2026-10-09 退费中的/已退费的学生不可再分班（用户口径）：
 *    收款单停留在「已到账」，但学生已进入退费流程或已退费 ——
 *    按钮必须按学生**最新**咨询状态隐藏，而不是只看单据状态。
 */
const REFUND_BLOCK_STATES: number[] = [CS.REFUND_MGR, CS.REFUND_FINANCE, CS.REFUNDED];

function isRefundBlocked(row: ConsultFeeOrder): boolean {
  const s = (row as any).consultState;
  return s !== undefined && s !== null && REFUND_BLOCK_STATES.includes(Number(s));
}

/** 当前行能否再分班（默认 true：没查到状态时不误伤） */
function canAssignOf(row: ConsultFeeOrder): boolean {
  if (isRefundBlocked(row)) return false;
  const s = assignStatus.value[row.consultStudentId];
  return s ? s.canAssign : true;
}

/** 按钮禁用原因（鼠标悬停提示） */
function assignTipOf(row: ConsultFeeOrder): string {
  if (isRefundBlocked(row)) {
    const name = (row as any).consultStateName || '退费流程中';
    return `学生${name}，不能再分班`;
  }
  const s = assignStatus.value[row.consultStudentId];
  if (!s) return '选择要分入的开放班级';
  return s.label;
}

function search() {
  page.value = 1;
  load();
}

function resetQuery() {
  query.value = { keyword: '', feeType: undefined, status: undefined };
  page.value = 1;
  load();
}

/* ---------- 发起收费 ---------- */
const createVisible = ref(false);
const createForm = ref<{
  consultStudentId: string;
  /** ★ 2026-10-08 费用类型改单选：一次只发一种费用 */
  feeType: number;
  payMethod: string;
}>({
  consultStudentId: '',
  feeType: FeeType.TRIAL_FEE,
  payMethod: '',
});

/* ---------- 学生选择（★ 2026-10-08：必填项由「学生ID」改为「学生姓名」） ---------- */
const studentOptions = ref<Array<{ consultStudentId: string; studentName: string; consultStateName?: string }>>([]);
const studentSearching = ref(false);

/**
 * 远程搜索学生（按姓名/学号模糊匹配）
 *
 * ★ 状态全流转：不传 consultState，候选覆盖【全部状态】的学生 ——
 *    待面试 / 试学费·待确认 / 试学中 / 正式……都能被选中发起收费。
 *    之前「齐甜甜搜不到」就是因为旧弹窗要手输学生ID，而不是搜索范围的锅。
 */
async function searchStudents(keyword: string) {
  studentSearching.value = true;
  try {
    const res = await fetchStudentList({ page: 1, size: 20, keyword: keyword || undefined });
    studentOptions.value = res.list.map((s: ConsultStudentListItem) => ({
      consultStudentId: s.consultStudentId,
      studentName: s.studentName,
      consultStateName: s.consultStateName,
    }));
  } catch {
    studentOptions.value = [];
  } finally {
    studentSearching.value = false;
  }
}

/** 咨询模块能发起的费用类型（规则3-①：只有学费/试学费） */
const CONSULT_FEE_OPTIONS = [
  { value: FeeType.TRIAL_FEE, label: '试学费' },
  { value: FeeType.TUITION, label: '学费（正式）' },
];

/** 费用标准预览（规则2：从财务取，不手填） */
const standards = ref<FinanceStandardView[]>([]);

async function loadStandards() {
  try {
    const res = await fetchStandardBatch(
      [createForm.value.feeType].filter((v) => v !== undefined && v !== null),
    );
    standards.value = res.list || [];
  } catch {
    standards.value = [];
  }
}

function openCreate(row?: ConsultFeeOrder) {
  createForm.value = {
    consultStudentId: row?.consultStudentId || '',
    feeType: FeeType.TRIAL_FEE,
    payMethod: '',
  };
  // 从行内带出学生：把该学生放进候选，保证下拉能显示姓名
  studentOptions.value = row?.consultStudentId
    ? [{ consultStudentId: row.consultStudentId, studentName: row.studentName }]
    : [];
  createVisible.value = true;
  loadStandards();
}

async function submitCreate() {
  if (!createForm.value.consultStudentId) {
    ElMessage.warning('请选择学生');
    return;
  }
  if (createForm.value.feeType === undefined || createForm.value.feeType === null) {
    ElMessage.warning('请选择要发起的费用类型');
    return;
  }
  const res = await createFees({
    consultStudentId: createForm.value.consultStudentId,
    feeTypes: [createForm.value.feeType] as FeeType[],
    payMethod: createForm.value.payMethod || undefined,
  });
  ElMessage.success(res.message || '已发起收费');
  createVisible.value = false;
  load();
}

/* ---------- 上传凭证 ---------- */
const voucherVisible = ref(false);
const voucherForm = ref<{ order: ConsultFeeOrder | null; dataUrl: string; voucherNo: string }>({
  order: null,
  dataUrl: '',
  voucherNo: '',
});
const uploading = ref(false);

function openVoucher(row: ConsultFeeOrder) {
  voucherForm.value = { order: row, dataUrl: '', voucherNo: '' };
  voucherVisible.value = true;
}

/** 选文件 → 转 base64 */
function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    ElMessage.error('图片不能超过 5MB');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    voucherForm.value.dataUrl = String(reader.result || '');
  };
  reader.readAsDataURL(file);
}

async function submitVoucher() {
  if (!voucherForm.value.dataUrl) {
    ElMessage.warning('请先选择缴费截图');
    return;
  }
  uploading.value = true;
  try {
    // ① 上传图片拿 URL（会双写到财务 uploads，确保财务能看到）
    const up = await uploadFile(voucherForm.value.dataUrl, 'voucher');
    // ② 绑定并同步给财务（规则3-② 的唯一性校验在这里生效）
    await uploadVoucher(voucherForm.value.order!.orderId, up.url, voucherForm.value.voucherNo || undefined);
    ElMessage.success('缴费截图已上传，等待财务核对');
    voucherVisible.value = false;
    load();
  } catch (err: any) {
    // 财务拒绝时（如凭证重复占用）后端已弹提示，这里只需刷新状态（凭证已回滚）
    load();
  } finally {
    uploading.value = false;
  }
}

/* ---------- 重新提交 ---------- */
async function doResubmit(row: ConsultFeeOrder) {
  await ElMessageBox.confirm(
    `确认重新提交单号 ${row.orderNo}？提交后财务将重新核对。`,
    '重新提交',
    { type: 'warning' },
  );
  await resubmitOrder(row.orderId);
  ElMessage.success('已重新提交');
  load();
}

/* ---------- ★ 2026-10-05 分班（已缴后可用） ---------- */
const assignVisible = ref(false);
const assignLoading = ref(false);
const assignSubmitting = ref(false);
const assignForm = ref<{
  order: ConsultFeeOrder | null;
  side: 'univ' | 'jh';
  classId: string;
}>({ order: null, side: 'univ', classId: '' });
const openClasses = ref<{ univ: OpenClassItem[]; jh: OpenClassItem[] }>({ univ: [], jh: [] });

const assignClassOptions = computed(() => {
  const list = assignForm.value.side === 'jh' ? openClasses.value.jh : openClasses.value.univ;
  return (list || []).map((c) => ({
    value: String(c.classId ?? c.id ?? ''),
    label: `${c.className}${c.stageName ? ` · ${c.stageName}` : ''}${
      c.headTeacherName ? ` · 班主任 ${c.headTeacherName}` : ''
    }`,
  }));
});

async function openAssign(row: ConsultFeeOrder) {
  assignForm.value = { order: row, side: 'univ', classId: '' };
  assignVisible.value = true;
  assignLoading.value = true;
  try {
    openClasses.value = await fetchOpenClasses();
  } catch {
    ElMessage.error('获取开放班级失败，请确认班级模块已启动');
  } finally {
    assignLoading.value = false;
  }
}

async function submitAssign() {
  const f = assignForm.value;
  if (!f.order) return;
  if (!f.classId) {
    ElMessage.warning('请选择要分入的班级');
    return;
  }
  const opt = assignClassOptions.value.find((o) => o.value === f.classId);
  await ElMessageBox.confirm(
    `确认把「${f.order.studentName}」分入「${opt?.label ?? f.classId}」？` +
      '将推送到该班班主任的「待接收学员」，班主任接收后入班。',
    '确认分班',
    { type: 'warning' },
  );
  assignSubmitting.value = true;
  try {
    const r = await enrollToClass(
      f.order.consultStudentId,
      f.classId,
      f.side === 'jh' ? 'class-jh' : 'class',
    );
    ElMessage.success(`「${f.order.studentName}」已推送到「待接收学员」，待班主任接收`);
    assignVisible.value = false;
    load();
  } finally {
    assignSubmitting.value = false;
  }
}

/* ---------- 展示辅助 ---------- */
const fmtMoney = (cent?: number) => (cent == null ? '—' : `¥${(cent / 100).toFixed(2)}`);

const statusTag = (s: number) => {
  if (s === ConsultFeeStatus.ARRIVED) return 'success';
  if (s === ConsultFeeStatus.PENDING) return 'warning';
  if (s === ConsultFeeStatus.REJECTED) return 'danger';
  return 'info';
};

function openVoucherImage(url: string) {
  window.open(url, '_blank');
}

onMounted(load);
</script>

<template>
  <div class="page">
    <!-- 统计 -->
    <div v-if="stats" class="stats">
      <el-card shadow="never" class="stat">
        <div class="stat-label">收款单总数</div>
        <div class="stat-value">{{ stats.voucherCount + stats.pendingCount + stats.arrivedCount }}</div>
      </el-card>
      <el-card shadow="never" class="stat">
        <div class="stat-label">被驳回</div>
        <div class="stat-value warn">{{ stats.rejectedCount }}</div>
      </el-card>
      <el-card shadow="never" class="stat">
        <div class="stat-label">待财务确认</div>
        <div class="stat-value warn">{{ stats.pendingCount }}</div>
      </el-card>
      <el-card shadow="never" class="stat">
        <div class="stat-label">已到账金额</div>
        <div class="stat-value ok">{{ fmtMoney(stats.arrivedAmount) }}</div>
      </el-card>
    </div>

    <!-- 列表（单卡片通栏：条件行 + 工具条 + 表格 + 分页，与财务模块版式一致） -->
    <el-card shadow="never" class="table-card card-flush">
      <!-- 条件行 -->
      <div class="filter-row">
        <el-input
          v-model="query.keyword"
          placeholder="搜索学生姓名 / 咨询老师 / 班级 / 单号"
          clearable
          style="max-width: 280px"
          @keyup.enter="search"
          @clear="search"
        />
        <el-select v-model="query.feeType" placeholder="全部费用类型" clearable style="width: 150px">
          <el-option
            v-for="(name, val) in FEE_TYPE_NAME"
            :key="val"
            :value="Number(val)"
            :label="name"
          />
        </el-select>
        <el-select v-model="query.status" placeholder="全部状态" clearable style="width: 140px">
          <el-option
            v-for="(name, val) in CONSULT_FEE_STATUS_NAME"
            :key="val"
            :value="Number(val)"
            :label="name"
          />
        </el-select>
        <el-button type="primary" @click="search">查询</el-button>
        <el-button @click="resetQuery">重置</el-button>
      </div>

      <!-- 工具条：左主按钮，右统计 -->
      <div class="table-toolbar">
        <div class="tools">
          <el-button type="primary" @click="openCreate()">＋ 发起收费</el-button>
        </div>
        <div class="tools">
          <span class="stat-line">共 <b>{{ total }}</b> 条收费单 · 待财务确认 <b>{{ stats?.pendingCount ?? 0 }}</b> 笔</span>
        </div>
      </div>

      <el-table v-loading="loading" :data="list" stripe>
        <el-table-column label="学生" min-width="140">
          <template #default="{ row }">
            <div class="stu-name">{{ row.studentName }}</div>
            <div class="stu-sub">{{ row.className || '未分班' }}</div>
          </template>
        </el-table-column>

        <el-table-column prop="orderNo" label="单号" width="160" />

        <el-table-column label="费用类型" width="100">
          <template #default="{ row }">
            <el-tag size="small">{{ row.feeTypeName }}</el-tag>
          </template>
        </el-table-column>

        <el-table-column label="金额" width="110">
          <template #default="{ row }">{{ row.amountYuan }}</template>
        </el-table-column>

        <el-table-column label="咨询侧状态" width="120">
          <template #default="{ row }">
            <el-tag size="small" :type="statusTag(row.status)">{{ row.statusName }}</el-tag>
          </template>
        </el-table-column>

        <el-table-column label="财务侧状态" width="110">
          <template #default="{ row }">
            <el-tag size="small" type="info">{{ row.financePayStatusName }}</el-tag>
          </template>
        </el-table-column>

        <el-table-column label="凭证" width="120">
          <template #default="{ row }">
            <el-button
              v-if="row.voucherUrl"
              link
              type="primary"
              @click="openVoucherImage(row.voucherUrl)"
            >
              查看截图
            </el-button>
            <span v-else class="stu-sub">未上传</span>
          </template>
        </el-table-column>

        <el-table-column prop="lastAction" label="最近操作" min-width="200" show-overflow-tooltip />

        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button
              v-if="row.status === ConsultFeeStatus.NO_VOUCHER || row.status === ConsultFeeStatus.REJECTED"
              link
              type="primary"
              @click="openVoucher(row)"
            >
              {{ row.status === ConsultFeeStatus.REJECTED ? '重新上传' : '上传凭证' }}
            </el-button>
            <el-button
              v-if="row.status === ConsultFeeStatus.REJECTED"
              link
              type="warning"
              @click="doResubmit(row)"
            >
              重新提交
            </el-button>
            <!-- ★ 2026-10-05 分班：缴费状态=已缴（已到账）才出现
                 ★ 2026-10-06 已分班（待接收/已接收/初高已入班）后禁用 ——
                    用户口径「咨询将学生分班之后就不能再将学生分派到其他班级，
                    驳回之后可以」
                 ★ 2026-10-09 学生退费中/已退费 → 整个按钮隐藏（不能再分班） -->
            <el-tooltip
              v-if="row.status === ConsultFeeStatus.ARRIVED && !isRefundBlocked(row)"
              :content="assignTipOf(row)"
              placement="top"
            >
              <span>
                <el-button
                  link
                  type="success"
                  :disabled="!canAssignOf(row)"
                  @click="openAssign(row)"
                >
                  分班
                </el-button>
              </span>
            </el-tooltip>
          </template>
        </el-table-column>
      </el-table>

      <div class="pager-bar">
        <span>共 {{ total }} 条记录，第 {{ page }}/{{ totalPages }} 页</span>
        <el-pagination
          v-model:current-page="page"
        v-model:page-size="size"
        :total="total"
        :page-sizes="[10, 20, 50]"
        layout="sizes, prev, pager, next"
        @current-change="load"
        @size-change="search"
        />
      </div>
    </el-card>

    <!-- ============ 发起收费 ============ -->
    <el-dialog v-model="createVisible" title="发起收费" width="540px">
      <el-alert type="info" :closable="false" show-icon class="mb">
        <template #title>
          金额由财务按「费用标准」自动取值，无需手动填写（规则2）；
          咨询模块只能发起学费 / 试学费（规则3-①）。
        </template>
      </el-alert>

      <el-form label-width="110px">
        <el-form-item label="学生姓名" required>
          <el-select
            v-model="createForm.consultStudentId"
            filterable
            remote
            clearable
            reserve-keyword
            :remote-method="searchStudents"
            :loading="studentSearching"
            placeholder="输入学生姓名搜索选择（全状态可选）"
            style="width: 100%"
          >
            <el-option
              v-for="s in studentOptions"
              :key="s.consultStudentId"
              :value="s.consultStudentId"
              :label="s.consultStateName ? `${s.studentName}（${s.consultStateName}）` : s.studentName"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="费用类型" required>
          <!-- ★ 2026-10-08 改单选：一次只发一种费用 -->
          <el-radio-group v-model="createForm.feeType" @change="loadStandards">
            <el-radio v-for="o in CONSULT_FEE_OPTIONS" :key="o.value" :value="o.value">
              {{ o.label }}
            </el-radio>
          </el-radio-group>
        </el-form-item>

        <el-form-item label="金额（预览）">
          <div v-if="standards.length" class="std-preview">
            <div v-for="s in standards" :key="s.feeType" class="std-item">
              <span>{{ s.feeTypeName }}</span>
              <b>{{ fmtMoney(s.amount) }}</b>
              <el-tag size="small" type="info">{{ s.deptName }}</el-tag>
            </div>
          </div>
          <span v-else class="stu-sub">取不到费用标准，请确认财务模块是否已启动</span>
        </el-form-item>

        <el-form-item label="缴费方式">
          <el-input v-model="createForm.payMethod" placeholder="如「微信转账」/「分期缴纳」（选填）" />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" @click="submitCreate">确认发起</el-button>
      </template>
    </el-dialog>

    <!-- ============ 上传凭证 ============ -->
    <el-dialog v-model="voucherVisible" title="上传缴费截图" width="520px">
      <el-alert type="warning" :closable="false" show-icon class="mb">
        <template #title>
          非餐费类费用要求「一人一张凭证」，重复使用会被财务拒绝（规则3-②）。
        </template>
      </el-alert>

      <div v-if="voucherForm.order" class="voucher-info">
        <div>
          <span class="stu-sub">单号</span> {{ voucherForm.order.orderNo }}
        </div>
        <div>
          <span class="stu-sub">学生</span> {{ voucherForm.order.studentName }}
        </div>
        <div>
          <span class="stu-sub">应付</span>
          <b>{{ voucherForm.order.amountYuan }}</b>
        </div>
      </div>

      <el-form label-width="90px" class="mt">
        <el-form-item label="缴费截图" required>
          <input type="file" accept="image/*" @change="onFileChange" />
          <div v-if="voucherForm.dataUrl" class="preview">
            <img :src="voucherForm.dataUrl" alt="预览" />
          </div>
        </el-form-item>
        <el-form-item label="转账单号">
          <el-input v-model="voucherForm.voucherNo" placeholder="如微信/支付宝交易单号（选填）" />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="voucherVisible = false">取消</el-button>
        <el-button type="primary" :loading="uploading" @click="submitVoucher">上传并提交</el-button>
      </template>
    </el-dialog>

    <!-- ============ ★ 2026-10-05 分班（缴费已到账后可用） ============ -->
    <el-dialog v-model="assignVisible" title="分班" width="560px">
      <el-alert type="info" :closable="false" show-icon class="mb">
        <template #title>
          选大学部班级 → 推送到「待接收学员」，本班班主任同意后入班；
          选初高班级 → 直接进入对应班级。
        </template>
      </el-alert>

      <div v-if="assignForm.order" class="voucher-info">
        <div>
          <span class="stu-sub">学生</span> {{ assignForm.order.studentName }}
          <el-tag v-if="assignForm.order.className" size="small" type="info" class="ml8">
            已意向：{{ assignForm.order.className }}
          </el-tag>
        </div>
      </div>

      <el-form label-width="90px" class="mt" v-loading="assignLoading">
        <el-form-item label="学部">
          <el-radio-group v-model="assignForm.side" @change="assignForm.classId = ''">
            <el-radio-button value="univ">大学部</el-radio-button>
            <el-radio-button value="jh">教学管理（初高）</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="开放班级" required>
          <el-select
            v-model="assignForm.classId"
            placeholder="请选择开放的班级"
            style="width: 100%"
            filterable
          >
            <el-option
              v-for="c in assignClassOptions"
              :key="c.value"
              :label="c.label"
              :value="c.value"
            />
          </el-select>
          <div v-if="!assignLoading && !assignClassOptions.length" class="stu-sub mt8">
            该学部当前没有「开放」状态的班级
          </div>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="assignVisible = false">取消</el-button>
        <el-button type="primary" :loading="assignSubmitting" @click="submitAssign">
          确认分班
        </el-button>
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

.stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}

.stat {
  text-align: center;
}

.stat-label {
  font-size: 12px;
  color: #A2938E;
}

.stat-value {
  font-size: 20px;
  font-weight: 700;
  margin-top: 4px;
  color: #443432;
}

.stat-value.ok {
  color: #5FA36F;
}

.stat-value.warn {
  color: #C9852E;
}

.toolbar-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.spacer {
  flex: 1;
}

.table-card {
  flex: 1;
}

.stu-name {
  font-weight: 600;
  color: #443432;
}

.stu-sub {
  font-size: 12px;
  color: #A2938E;
}

.std-preview {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}

.std-item {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
}

.voucher-info {
  display: flex;
  gap: 20px;
  padding: 10px 12px;
  background: #F6F3EF;
  border-radius: 6px;
  font-size: 13px;
}

.preview {
  margin-top: 8px;
}

.preview img {
  max-width: 220px;
  max-height: 220px;
  border: 1px solid #DCD2CB;
  border-radius: 6px;
}

.mb {
  margin-bottom: 12px;
}

.mt {
  margin-top: 12px;
}
</style>
