<script setup lang="ts">
/**
 * 催费管理页（缴费台账 / 登记缴费·上传缴费凭证 / 导出）
 *
 * ★ 2026-10-20 用户要求（两轮）：
 *   ① 催费推送 / 催费记录下线 → 操作列整列移除；
 *   ② 操作列**恢复**，只放「上传缴费凭证」= 登记缴费（缴费方式 / 金额 / 时间 / 备注 / 截图）。
 *   后端 /fee/share、/fee/notify/list 接口**保留但页面不再有入口**（将来接真实短信发送时复用；
 *   数据表 t_class_fee_notify 也照旧保留，「催费次数」列仍按它统计）。
 */

import { computed, ref, reactive, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { Search, Refresh, Download, Plus } from '@element-plus/icons-vue';
import { FEE_TYPE_NAME, PAY_METHOD_NAME, PAY_STATUS_NAME, PayMethod, PayStatus } from 'shared-types/class-jh';
import type { FeeRecord, FeeListQuery, ClassInfo } from 'shared-types/class-jh';
import { fetchFeeList, exportFee, submitFeePayment } from '@/class-jh/api/fee';
import { urgeList } from '@/class/api/student';
import { fetchFeeCallList } from '@/api/feeCall';
import { fetchClassOptions } from '@/class-jh/api/classInfo';
import { exportCsv } from '@/class-jh/utils/exportCsv';
import { dash, formatAmount, formatDate, payStatusTagType } from '@/class-jh/utils/format';

const loading = ref(false);
const classOptions = ref<ClassInfo[]>([]);

// ★ 2026-10-19 部门维度（用户二次要求）：催费列表聚合 初高/大学/就业 三部门——
//   初高=本页原生缴费台账（功能不变）；大学=催缴记录（/api/class/urge/list）；
//   就业=催费单（/api/job/fee-call/page，实训/就业共用 sms_job 库）。
type FeeRow = FeeRecord & {
  dept?: string;
  /** 原始行（就业催费单的回填字段在 raw 上） */
  raw?: any;
  /** 催费次数（初高=催费记录数；大学=催缴次数；就业无此概念显示 —） */
  urgeCount?: number;
  /** 就业原始催缴状态名（待催缴 / 催缴中 / 已缴清）：列表按统一缴费状态展示，这个值挂 title 备查 */
  callStatusName?: string;
};

const query = reactive<FeeListQuery & {
  page: number;
  size: number;
  dept: 'jh' | 'class' | 'employ' | 'all';
}>({
  page: 1,
  size: 20,
  dept: 'all',
  classId: undefined,
  feeType: undefined,
  payStatus: undefined,
  isUrgent: undefined,
  keyword: undefined,
  startDate: undefined,
  endDate: undefined,
});

const tableRows = ref<FeeRow[]>([]);
/** 「全部部门」合并视图的结果（前端分页） */
const mergedRows = ref<FeeRow[]>([]);
const serverTotal = ref(0);
/**
 * 初高催费窗口天数（后端设置项 feeUrgeWindowDays，默认 20）
 *
 * ★ 2026-10-20 用户要求：催费列表的内容来自财务管理 · 缴费管理，
 *   且「到期日距今 ≤ 20 天」的缴费单才进列表 → 由后端过滤，这里只取回天数做界面说明，
 *   不然用户会以为「台账里有的单怎么列表里没有」。
 */
const urgeWindowDays = ref<number | null>(null);

const total = computed(() => (query.dept === 'all' ? mergedRows.value.length : serverTotal.value));
const tableData = computed<FeeRow[]>(() => {
  if (query.dept !== 'all') return tableRows.value;
  const start = (query.page - 1) * query.size;
  return mergedRows.value.slice(start, start + query.size);
});

/**
 * 「缴费状态」下拉选项 —— **三个部门共用一套**（待缴 / 已缴 / 已核对 / 逾期 / 冻结）
 *
 * ★ 2026-10-20 用户要求：「就业的缴费状态采用初高中大学的」。
 *   之前就业单独展示催费单状态（1 待催缴 / 2 催缴中 / 3 已缴清），
 *   与初高/大学（1 待缴 / 2 已缴 / 3 已核对 / 4 逾期 / 5 冻结）两套码并列，用户看着分裂。
 *   → 现在下拉只有一套缴费状态；就业的**库内真实状态**（催缴中/已缴清）不再单独成列，
 *     而是由 callStatusToPayStatus() 翻译成缴费状态展示，原始催缴状态放在 tag 的 title 里备查。
 */
const payStatusOptions = computed<Array<{ label: string; value: number }>>(() =>
  Object.entries(PAY_STATUS_NAME).map(([value, label]) => ({ value: Number(value), label: String(label) })),
);

/**
 * 就业催费单状态（call_status）→ 统一缴费状态
 *   3 已缴清 → 2 已缴
 *   1 待催缴 / 2 催缴中：还没收到钱 → 待缴；**已过应缴日则为逾期**（2026-10-20 用户反馈
 *   「剩余 -12 天了还显示待缴」—— 逾期不在催费单状态里，只能按日期派生）
 */
function callStatusToPayStatus(callStatus: any, dueDate?: string | null): number {
  const s = Number(callStatus);
  if (s === 3) return PayStatus.PAID; // 已缴清 → 已缴
  return isPastDate(dueDate) ? PayStatus.OVERDUE : PayStatus.UNPAID;
}

/** 日期串（YYYY-MM-DD / 带时间）是否早于今天 */
function isPastDate(dateStr?: string | null): boolean {
  if (!dateStr) return false;
  const d = String(dateStr).slice(0, 10);
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const today = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  return d < today;
}

/** 大学催缴行 → 台账行形状（公共列直接复用现有表格） */
function urgeToRow(r: any): FeeRow {
  return {
    feeId: `urge:${r.id}`,
    studentId: r.studentId,
    studentNo: r.studentNo || '',
    studentName: r.studentName || '',
    // ★ 2026-10-20 用户要求：大学催缴副本（t_class_urge_sync）自带 phone / parent_phone
    phone: r.phone ?? null,
    parentPhone: r.parentPhone ?? null,
    classId: r.classId ?? undefined,
    className: r.className,
    feeType: r.feeType,
    feeTypeName: r.feeTypeName || '',
    feeAmount: Number(r.amount || 0),
    payStatus: r.payStatus,
    payStatusName: r.payStatusName || '',
    expireDate: r.expireDate || undefined,
    remainDays: r.overdueDays ? -r.overdueDays : undefined,
    isUrgent: !!r.isOverdue,
    urgeCount: Number(r.urgeCount || 0),
    dept: '大学',
  } as unknown as FeeRow;
}

/** 就业催费单行 → 台账行形状 */
function callToRow(r: any): FeeRow {
  return {
    feeId: `call:${r.id}`,
    studentId: r.studentId,
    studentNo: r.studentNo || '',
    studentName: r.studentName || '',
    // ★ 2026-10-20 用户要求：就业催费单存的是发起时的电话快照（t_job_fee_call.phone/parent_phone）
    phone: r.phone ?? null,
    parentPhone: r.parentPhone ?? null,
    classId: r.classId ?? undefined,
    className: r.className,
    feeType: r.feeType,
    feeTypeName: r.feeTypeName || '',
    feeAmount: Number(r.feeAmount || 0),
    // ★ 2026-10-20：就业也按统一缴费状态展示（原催缴状态留在 callStatusName 里，列上用 title 提示）；
    //    未缴清且已过应缴日 → 逾期（催费单本身没有「逾期」这个状态）
    payStatus: callStatusToPayStatus(r.callStatus, r.dueDate),
    payStatusName: PAY_STATUS_NAME[callStatusToPayStatus(r.callStatus, r.dueDate)] || '',
    callStatusName: r.callStatusName || '',
    expireDate: r.dueDate || undefined,
    isUrgent: !!r.overdue,
    raw: r,
    dept: '就业',
  } as unknown as FeeRow;
}

async function loadData() {
  loading.value = true;
  try {
    if (query.dept === 'class') {
      // 大学催缴记录：缴费状态 / 仅看紧急 / 应缴日期 三筛全生效（2026-10-20）
      const data = await urgeList({
        page: query.page,
        size: query.size,
        classId: query.classId,
        feeType: query.feeType,
        payStatus: query.payStatus,
        onlyOverdue: query.isUrgent,
        startDate: query.startDate,
        endDate: query.endDate,
        keyword: query.keyword || undefined,
      });
      tableRows.value = data.list.map((r) => urgeToRow(r));
      serverTotal.value = data.total;
    } else if (query.dept === 'employ') {
      // 就业催费单：缴费状态统一成初高/大学那套，由后端按口径翻译（待缴/逾期靠应缴日区分）
      const data = await fetchFeeCallList({
        page: query.page,
        size: query.size,
        classId: query.classId,
        feeType: query.feeType,
        payStatus: query.payStatus,
        onlyOverdue: query.isUrgent,
        startDate: query.startDate,
        endDate: query.endDate,
        keyword: query.keyword || undefined,
      });
      tableRows.value = data.list.map((r) => callToRow(r));
      serverTotal.value = data.total;
    } else if (query.dept === 'all') {
      // 三源各取前 100 条合并（催费数据量级远小于此），应缴日期倒序，前端分页
      const kw = query.keyword || undefined;
      const settled = await Promise.allSettled([
        fetchFeeList({ ...query, page: 1, size: 100 }),
        urgeList({
          page: 1,
          size: 100,
          classId: query.classId,
          feeType: query.feeType,
          payStatus: query.payStatus,
          onlyOverdue: query.isUrgent,
          startDate: query.startDate,
          endDate: query.endDate,
          keyword: kw,
        }),
        // 选了「已核对 / 冻结」时就业没有对应状态 → 后端 payStatus 翻译成 1=0，该源不出数据
        fetchFeeCallList({
          page: 1,
          size: 100,
          classId: query.classId,
          feeType: query.feeType,
          payStatus: query.payStatus,
          onlyOverdue: query.isUrgent,
          startDate: query.startDate,
          endDate: query.endDate,
          keyword: kw,
        }),
      ]);
      const rows: FeeRow[] = [];
      if (settled[0].status === 'fulfilled') {
        rows.push(...settled[0].value.list.map((r) => ({ ...r, dept: '初高' } as FeeRow)));
        urgeWindowDays.value = settled[0].value.urgeWindowDays ?? urgeWindowDays.value;
      }
      if (settled[1].status === 'fulfilled') rows.push(...settled[1].value.list.map((r: any) => urgeToRow(r)));
      if (settled[2].status === 'fulfilled') rows.push(...settled[2].value.list.map((r: any) => callToRow(r)));
      rows.sort((a, b) => (b.expireDate || '0000').localeCompare(a.expireDate || '0000'));
      mergedRows.value = rows;
    } else {
      // 初高：原生缴费台账（功能不变）
      const data = await fetchFeeList(query);
      tableRows.value = data.list.map((r) => ({ ...r, dept: '初高' } as FeeRow));
      serverTotal.value = data.total;
      urgeWindowDays.value = data.urgeWindowDays ?? null;
    }
  } catch {
    /* 错误已统一处理 */
  } finally {
    loading.value = false;
  }
}

/** 切部门：页码归 1 重查
 *  ★ 2026-10-20：缴费状态已三部门统一（原就业那套催费状态码不再单独成列），
 *    但切部门后旧筛选值仍可能对不上（如就业没有「已核对」），一并清掉 */
function handleDeptChange() {
  query.page = 1;
  query.payStatus = undefined;
  loadData();
}

async function loadClassOptions() {
  try {
    classOptions.value = await fetchClassOptions({ excludeGraduated: false });
  } catch {
    /* 错误已统一处理 */
  }
}

function handleSearch() {
  query.page = 1;
  loadData();
}

function handleReset() {
  query.page = 1;
  query.size = 20;
  query.classId = undefined;
  query.feeType = undefined;
  query.payStatus = undefined;
  query.isUrgent = undefined;
  query.keyword = undefined;
  query.startDate = undefined;
  query.endDate = undefined;
  loadData();
}

/* ============ 登记缴费（上传缴费凭证） ============ */
const paymentVisible = ref(false);
const paymentSubmitting = ref(false);
const paymentRow = ref<FeeRow | null>(null);
/** 缴费详情弹窗（★ 2026-10-20 用户要求：查看时看到全部登记信息，不只是图片） */
const voucherViewVisible = ref(false);
const voucherViewUrl = ref('');
const voucherViewRow = ref<FeeRow | null>(null);
/** el-upload 实例（重开弹窗要清空上一张，否则limit=1选不了新图） */
const voucherUploadRef = ref<any>(null);

/** 表单：金额按「元」录入，提交时 ×100 转成分 */
const paymentForm = reactive({
  payMethod: PayMethod.WECHAT as number,
  amountYuan: 0,
  payDate: '',
  remark: '',
});
/** 本地选中的截图文件（el-upload 不自动上传，自己读成 base64 再提交） */
const voucherFile = ref<File | null>(null);

/** 缴费方式下拉：微信支付 / 支付宝 / 现金 */
const payMethodOptions = computed(() =>
  Object.entries(PAY_METHOD_NAME).map(([value, label]) => ({ value: Number(value), label: String(label) })),
);

/** 今天 YYYY-MM-DD（缴费时间默认值） */
function todayStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 缴费时间只能选今天及以前（未来的日期不可点） */
function disabledFutureDate(date: Date): boolean {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return date.getTime() > end.getTime();
}

/** 打开登记缴费弹窗：金额默认带出应缴金额，时间默认今天 */
function openPayment(row: FeeRow) {
  paymentRow.value = row;
  paymentForm.payMethod = PayMethod.WECHAT;
  paymentForm.amountYuan = Number(((row.paidAmount ?? row.feeAmount) || 0) / 100);
  paymentForm.payDate = todayStr();
  paymentForm.remark = '';
  voucherFile.value = null;
  voucherUploadRef.value?.clearFiles?.();
  paymentVisible.value = true;
}

/** 选图（el-upload 只做本地选择，不发请求） */
function onVoucherChange(file: any) {
  const raw: File | undefined = file?.raw;
  if (!raw) return;
  if (!/^image\//.test(raw.type)) {
    ElMessage.warning('缴费截图只能是图片');
    return;
  }
  if (raw.size > 5 * 1024 * 1024) {
    ElMessage.warning('图片不能超过 5MB，请压缩后重试');
    return;
  }
  voucherFile.value = raw;
}

function onVoucherRemove() {
  voucherFile.value = null;
}

/** File → dataURL（后端收 base64 落盘） */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
}

async function submitPayment() {
  if (!paymentRow.value) return;
  if (!paymentForm.payDate) {
    ElMessage.warning('请选择缴费时间');
    return;
  }
  if (!paymentForm.amountYuan || paymentForm.amountYuan <= 0) {
    ElMessage.warning('请填写正确的缴费金额');
    return;
  }
  // ★ 2026-10-20 用户要求：现金是线下交付、没有转账凭证，可以不传截图；
  //   微信支付 / 支付宝必须传（钱是从账上走的，要对得上）。
  const isCash = paymentForm.payMethod === PayMethod.CASH;
  if (!isCash && !voucherFile.value) {
    ElMessage.warning('请上传缴费截图（微信支付 / 支付宝需要凭证）');
    return;
  }
  paymentSubmitting.value = true;
  try {
    const dataUrl = voucherFile.value ? await readAsDataUrl(voucherFile.value) : undefined;
    await submitFeePayment({
      feeId: paymentRow.value.feeId,
      payMethod: paymentForm.payMethod,
      paidAmount: Math.round(paymentForm.amountYuan * 100),
      payDate: paymentForm.payDate,
      remark: paymentForm.remark.trim() || undefined,
      dataUrl,
    });
    ElMessage.success('缴费登记成功');
    paymentVisible.value = false;
    loadData();
  } catch {
    /* 错误已统一处理 */
  } finally {
    paymentSubmitting.value = false;
  }
}

/** 查看已上传的凭证（相对地址由 Vite 代理 /uploads 转发到后端） */
/**
 * 查看缴费详情（★ 2026-10-20 用户要求：不只看图片，登记的每一项都要能看到）
 *   → 传整行，弹窗里把 学生/缴费项目/方式/金额/时间/备注 全部列出来，图片放最下面。
 *   地址是相对路径（/uploads/...）时补上开头的斜杠，交给 Vite 的 /uploads 代理转发后端。
 */
function viewVoucher(row: FeeRow) {
  const url = row?.voucherUrl;
  voucherViewRow.value = row;
  voucherViewUrl.value = url
    ? /^https?:\/\//i.test(url)
      ? url
      : url.startsWith('/')
        ? url
        : `/${url}`
    : '';
  voucherViewVisible.value = true;
}

/**
 * 这一行是否已经登记过缴费
 *
 * ★ 不能只看「有没有截图」：**现金**登记时截图是非必填的，
 *   只有 payMethod / paidAmount 才是"登记过"的可靠标志。
 */
function hasPayment(row: FeeRow): boolean {
  return row.payMethod != null || !!row.voucherUrl;
}

/* ============ 导出 ============ */
async function handleExport() {
  try {
    const list = await exportFee(query);
    exportCsv(
      '催费台账',
      [
        '学号',
        '姓名',
        '手机号',
        '家长手机号',
        '班级',
        '缴费类型',
        '应缴金额',
        '实缴金额',
        '缴费方式',
        '缴费状态',
        '应缴日期',
        '缴费日期',
        '备注',
        '剩余天数',
        '是否紧急',
      ],
      list.map((r) => [
        r.studentNo,
        r.studentName,
        r.phone || '',
        r.parentPhone || '',
        r.className,
        r.feeTypeName,
        formatAmount(r.feeAmount),
        r.paidAmount == null ? '' : formatAmount(r.paidAmount),
        r.payMethodName || '',
        r.payStatusName,
        formatDate(r.expireDate),
        formatDate(r.payDate),
        r.payRemark || '',
        r.remainDays ?? '',
        r.isUrgent ? '是' : '否',
      ]),
    );
    ElMessage.success('导出成功');
  } catch {
    /* 错误已统一处理 */
  }
}

onMounted(() => {
  loadClassOptions();
  loadData();
});
</script>

<template>
  <div class="page-container">
    <el-card shadow="never" class="search-card">
      <!-- ★ 2026-10-19：筛选全部「选完即查」（@change → handleSearch），不用再点查询；选完不动，用户视角就是筛选没生效 -->
        <!-- ★ 2026-10-19（二次要求）：部门维度——列表加部门列，筛选加部门（初高/大学/就业）；
             ★ 2026-10-20（三次要求）：三个筛选（缴费状态 / 仅看紧急 / 应缴日期）对全部部门生效，
               取消原来的按部门禁用；就业状态码与缴费状态不同，下拉按部门切换选项集 -->
      <el-form :model="query" inline>
        <el-form-item label="部门">
          <el-select v-model="query.dept" style="width: 130px" @change="handleDeptChange">
            <el-option label="全部部门" value="all" />
            <el-option label="初高" value="jh" />
            <el-option label="大学" value="class" />
            <el-option label="就业" value="employ" />
          </el-select>
        </el-form-item>
        <el-form-item label="关键字">
          <el-input v-model="query.keyword" placeholder="学号/姓名" clearable style="width: 150px" @keyup.enter="handleSearch" @clear="handleSearch" />
        </el-form-item>
        <el-form-item label="班级">
          <el-select v-model="query.classId" placeholder="全部" clearable style="width: 150px" @change="handleSearch">
            <el-option v-for="c in classOptions" :key="c.classId" :label="c.className" :value="c.classId" />
          </el-select>
        </el-form-item>
        <el-form-item label="缴费类型">
          <el-select v-model="query.feeType" placeholder="全部" clearable style="width: 130px" @change="handleSearch">
            <el-option v-for="(name, value) in FEE_TYPE_NAME" :key="value" :label="name" :value="Number(value)" />
          </el-select>
        </el-form-item>
        <el-form-item label="缴费状态">
          <el-select v-model="query.payStatus" placeholder="全部" clearable style="width: 120px" @change="handleSearch">
            <el-option v-for="o in payStatusOptions" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="仅看紧急">
          <el-switch v-model="query.isUrgent" @change="handleSearch" />
        </el-form-item>
        <el-form-item label="应缴日期">
          <el-date-picker v-model="query.startDate" type="date" value-format="YYYY-MM-DD" placeholder="开始" style="width: 140px" @change="handleSearch" />
          <span class="sep">~</span>
          <el-date-picker v-model="query.endDate" type="date" value-format="YYYY-MM-DD" placeholder="结束" style="width: 140px" @change="handleSearch" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :icon="Search" @click="handleSearch">查询</el-button>
          <el-button :icon="Refresh" @click="handleReset">重置</el-button>
        </el-form-item>
        <el-form-item>
          <div class="dept-hint">注：缴费状态、仅看紧急、应缴日期对全部部门（初高/大学/就业）生效；缴费状态三部门统一（待缴/已缴/已核对/逾期/冻结），就业的催费单状态（待催缴/催缴中/已缴清）已折算为缴费状态；「紧急」= 未结清且已过应缴日（逾期一律算紧急）</div>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never" class="table-card">
      <div class="toolbar">
        <el-button v-if="query.dept === 'jh'" :icon="Download" @click="handleExport">导出</el-button>
        <!-- ★ 2026-10-20 用户要求：催费列表来自财务管理 · 缴费管理，到期日到 20 天才进列表 -->
        <span v-if="urgeWindowDays && query.dept !== 'class' && query.dept !== 'employ'" class="window-hint">
          初高数据来自「财务管理 · 缴费管理」，只列到期日距今 ≤ {{ urgeWindowDays }} 天的缴费单（含已逾期；未设到期日的不显示）
        </span>
      </div>

      <el-table v-loading="loading" :data="tableData" border stripe style="width: 100%" empty-text="暂无数据">
        <el-table-column type="index" label="序号" width="60" align="center" />
        <el-table-column label="部门" width="80" align="center">
          <template #default="{ row }">{{ row.dept || '初高' }}</template>
        </el-table-column>
        <el-table-column prop="studentNo" label="学号" width="120" />
        <el-table-column prop="studentName" label="姓名" width="90" />
        <!-- ★ 2026-10-20 用户要求：催费列表加手机号 / 家长手机号（催费主要打家长号）
             三源口径：初高按 studentId 关联 t_class_student 取；
             大学取催缴副本 t_class_urge_sync 自带列；就业取催费单电话快照 -->
        <el-table-column label="手机号" width="125">
          <template #default="{ row }">{{ dash(row.phone) }}</template>
        </el-table-column>
        <el-table-column label="家长手机号" width="125">
          <template #default="{ row }">{{ dash(row.parentPhone) }}</template>
        </el-table-column>
        <el-table-column label="班级" width="110">
          <template #default="{ row }">{{ dash(row.className) }}</template>
        </el-table-column>
        <el-table-column prop="feeTypeName" label="缴费类型" width="100" />
        <el-table-column label="应缴金额" width="120" align="right">
          <template #default="{ row }">{{ formatAmount(row.feeAmount) }}</template>
        </el-table-column>
        <!-- ★ 2026-10-20 登记缴费写入的实缴金额（未登记显示 —，允许与应缴不同＝部分缴） -->
        <el-table-column label="实缴金额" width="120" align="right">
          <template #default="{ row }">{{ row.paidAmount == null ? '—' : formatAmount(row.paidAmount) }}</template>
        </el-table-column>
        <el-table-column label="缴费状态" width="100" align="center">
          <template #default="{ row }">
            <!-- ★ 2026-10-20：就业按统一缴费状态展示；原始催缴状态（待催缴/催缴中/已缴清）放 title 备查 -->
            <el-tag
              :type="payStatusTagType(row.payStatus)"
              size="small"
              :title="row.callStatusName ? `催费单状态：${row.callStatusName}` : ''"
            >{{ row.payStatusName }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="缴费方式" width="110" align="center">
          <template #default="{ row }">{{ dash(row.payMethodName) }}</template>
        </el-table-column>
        <el-table-column label="应缴日期" width="120">
          <template #default="{ row }">{{ formatDate(row.expireDate) }}</template>
        </el-table-column>
        <el-table-column label="缴费日期" width="120">
          <template #default="{ row }">{{ formatDate(row.payDate) }}</template>
        </el-table-column>
        <el-table-column label="剩余天数" width="100" align="center">
          <template #default="{ row }">{{ dash(row.remainDays) }}</template>
        </el-table-column>
        <el-table-column label="紧急" width="80" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.isUrgent" type="danger" size="small">紧急</el-tag>
            <span v-else>—</span>
          </template>
        </el-table-column>
        <!-- ★ 催费次数（2026-10-19 用户要求）：初高=催费推送记录数；大学=催缴次数；就业催费单无此概念 -->
        <el-table-column label="催费次数" width="90" align="center">
          <template #default="{ row }">{{ row.urgeCount ?? '—' }}</template>
        </el-table-column>
        <!-- ★ 2026-10-20 用户要求：操作列恢复，只放「上传缴费凭证」（= 登记缴费）；
             催费推送 / 催费记录 / 催缴记录已下线，不要再加回来 -->
        <el-table-column label="操作" width="160" align="center" fixed="right">
          <template #default="{ row }">
            <template v-if="!row.dept || row.dept === '初高'">
              <el-button link type="primary" size="small" @click="openPayment(row)">
                {{ hasPayment(row) ? '重新登记' : '上传缴费凭证' }}
              </el-button>
              <el-button v-if="hasPayment(row)" link type="success" size="small" @click="viewVoucher(row)">
                查看
              </el-button>
            </template>
            <span v-else>—</span>
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

    <!-- 登记缴费（上传缴费凭证） -->
    <el-dialog v-model="paymentVisible" title="上传缴费凭证" width="560px">
      <el-form :model="paymentForm" label-width="96px">
        <el-form-item label="学生">
          <el-input :model-value="paymentRow ? `${paymentRow.studentNo} ${paymentRow.studentName}` : ''" disabled />
        </el-form-item>
        <el-form-item label="缴费项目">
          <el-input
            :model-value="paymentRow ? `${paymentRow.feeTypeName}（应缴 ${formatAmount(paymentRow.feeAmount)}）` : ''"
            disabled
          />
        </el-form-item>
        <el-form-item label="缴费方式" required>
          <el-radio-group v-model="paymentForm.payMethod">
            <el-radio v-for="o in payMethodOptions" :key="o.value" :value="o.value">{{ o.label }}</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="缴费金额" required>
          <el-input-number
            v-model="paymentForm.amountYuan"
            :min="0.01"
            :max="10000000"
            :precision="2"
            :step="100"
            controls-position="right"
            style="width: 200px"
          />
          <span class="field-unit">元（默认带出应缴金额，可改为实际收到的金额）</span>
        </el-form-item>
        <el-form-item label="缴费时间" required>
          <el-date-picker
            v-model="paymentForm.payDate"
            type="date"
            value-format="YYYY-MM-DD"
            :clearable="false"
            :disabled-date="disabledFutureDate"
            placeholder="默认当天"
            style="width: 200px"
          />
          <span class="field-unit">只能选今天及以前</span>
        </el-form-item>
        <el-form-item label="备注">
          <el-input
            v-model="paymentForm.remark"
            type="textarea"
            :rows="2"
            maxlength="200"
            show-word-limit
            placeholder="转账单号 / 其他说明，可留空"
          />
        </el-form-item>
        <!-- ★ 现金：截图为非必填（线下交付没有转账截图） -->
        <el-form-item label="缴费截图" :required="paymentForm.payMethod !== PayMethod.CASH">
          <el-upload
            ref="voucherUploadRef"
            :auto-upload="false"
            :limit="1"
            accept="image/*"
            list-type="picture-card"
            :on-change="onVoucherChange"
            :on-remove="onVoucherRemove"
          >
            <el-icon><Plus /></el-icon>
          </el-upload>
          <div class="upload-tip">
            <template v-if="paymentForm.payMethod === PayMethod.CASH">
              现金可不传截图；如需留存收据也可从本地选一张（jpg / png / webp，≤ 5MB）
            </template>
            <template v-else>从本地选择图片：jpg / png / webp，单张不超过 5MB</template>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="paymentVisible = false">取消</el-button>
        <el-button type="primary" :loading="paymentSubmitting" @click="submitPayment">提交</el-button>
      </template>
    </el-dialog>

    <!-- 缴费详情（登记信息 + 凭证图片） -->
    <el-dialog v-model="voucherViewVisible" title="缴费详情" width="680px">
      <el-descriptions v-if="voucherViewRow" :column="2" border size="small">
        <el-descriptions-item label="学生" :span="2">
          {{ voucherViewRow.studentNo }} {{ voucherViewRow.studentName }}
        </el-descriptions-item>
        <el-descriptions-item label="班级">{{ dash(voucherViewRow.className) }}</el-descriptions-item>
        <el-descriptions-item label="缴费项目">{{ dash(voucherViewRow.feeTypeName) }}</el-descriptions-item>
        <el-descriptions-item label="应缴金额">{{ formatAmount(voucherViewRow.feeAmount) }}</el-descriptions-item>
        <el-descriptions-item label="缴费方式">{{ dash(voucherViewRow.payMethodName) }}</el-descriptions-item>
        <el-descriptions-item label="实缴金额">
          {{ voucherViewRow.paidAmount == null ? '—' : formatAmount(voucherViewRow.paidAmount) }}
        </el-descriptions-item>
        <el-descriptions-item label="缴费时间">{{ formatDate(voucherViewRow.payDate) }}</el-descriptions-item>
        <el-descriptions-item label="备注" :span="2">{{ dash(voucherViewRow.payRemark) }}</el-descriptions-item>
      </el-descriptions>
      <div class="voucher-title">缴费截图</div>
      <div class="voucher-wrap">
        <img v-if="voucherViewUrl" :src="voucherViewUrl" alt="缴费截图" class="voucher-img" />
        <span v-else class="field-unit">未上传截图</span>
      </div>
      <template #footer>
        <el-button @click="voucherViewVisible = false">关闭</el-button>
        <el-button type="primary" tag="a" :href="voucherViewUrl" target="_blank" rel="noopener">新窗口打开截图</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page-container {
  padding: 16px;
}
.sep {
  margin: 0 6px;
}
.search-card {
  margin-bottom: 12px;
}
.search-card :deep(.el-form-item) {
  margin-bottom: 8px;
  margin-top: 8px;
}
.toolbar {
  margin-bottom: 12px;
}
/* 催费窗口说明：靠右、浅色，别和操作按钮抢注意力 */
.window-hint {
  float: right;
  line-height: 32px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.dept-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
/* 登记缴费弹窗内的说明文字 / 凭证预览 */
.field-unit {
  margin-left: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.upload-tip {
  width: 100%;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.voucher-title {
  margin: 14px 0 8px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.voucher-wrap {
  text-align: center;
}
.voucher-img {
  max-width: 100%;
  max-height: 60vh;
  border-radius: 6px;
}
.table-card :deep(.el-card__body) {
  padding: 16px;
}
</style>
