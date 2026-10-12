<script setup lang="ts">
/**
 * 学生管理
 *
 * 功能：
 *   - 列表 + 搜索 + 状态筛选
 *   - 新建学生
 *   - 详情抽屉（档案 / 跟进历史 / 缴费单 / 退费单）
 *   - 按状态显示可执行动作：分配(经理) / 领取 / 面试 / 分班 / 入班 / 转正式 / 流失
 */

import { ref, onMounted, computed } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { InfoFilled } from '@element-plus/icons-vue';
import type {
  ConsultStudentListItem,
  ConsultStudent,
  ConsultState,
  ConsultSupplementPlan,
  FormalPayMode,
} from 'shared-types/consult';
import {
  CONSULT_STATE_NAME,
  ConsultState as CS,
  DEPT_NAME,
  FEE_TYPE_NAME,
  FeeType,
  FormalPayMode as FPM,
} from 'shared-types/consult';
import {
  fetchStudentList,
  fetchStudentDetail,
  addStudent,
  updateStudentExtra,
  assignOwner,
  claimStudent,
  assignClass,
  recordLoss,
  fetchConsultants,
  toFormal,
  fetchSupplementPlan,
  submitInterviewResult as submitInterviewResultApi,
  cancelNotEnrolled,
  enrollToClass as enrollToClassApi,
  fetchOpenClasses,
  fetchAssignStatus,
  type AssignStatusItem,
  type OpenClassItem,
} from '@/consult/api/consult';
import { useAuthStore } from '@/consult/stores/auth';

const auth = useAuthStore();

/* ---------- 列表 ---------- */
const loading = ref(false);
const list = ref<ConsultStudentListItem[]>([]);
const total = ref(0);

/** 分页总页数（原型 pager 里的「第 N/M 页」） */
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / (size.value || 20))));
const page = ref(1);
const size = ref(10);

const query = ref({
  keyword: '',
  consultState: undefined as number | undefined,
  deptCode: undefined as number | undefined,
});

/** 状态筛选按钮（按业务顺序） */
const stateOptions = computed(() =>
  Object.entries(CONSULT_STATE_NAME).map(([k, v]) => ({ value: Number(k), label: v })),
);

async function load() {
  loading.value = true;
  try {
    const res = await fetchStudentList({
      page: page.value,
      size: size.value,
      keyword: query.value.keyword || undefined,
      consultState: query.value.consultState,
      deptCode: query.value.deptCode,
    });
    list.value = res.list;
    total.value = res.total;
    // 拉取「分班/入班」权威状态，用于禁用已入班的「入班」按钮（与收款与缴费页同口径）
    await loadAssignStatus();
  } finally {
    loading.value = false;
  }
}

function search() {
  page.value = 1;
  load();
}

function resetQuery() {
  query.value = { keyword: '', consultState: undefined, deptCode: undefined };
  page.value = 1;
  load();
}

/* ---------- 详情 ---------- */
const detailVisible = ref(false);
const detail = ref<ConsultStudent | null>(null);
const detailLoading = ref(false);

async function openDetail(row: ConsultStudentListItem) {
  detailVisible.value = true;
  detailLoading.value = true;
  try {
    detail.value = await fetchStudentDetail(row.consultStudentId);
  } finally {
    detailLoading.value = false;
  }
}

async function refreshDetail() {
  if (detail.value) {
    detail.value = await fetchStudentDetail(detail.value.id);
  }
}

/* ---------- 新建学生 ---------- */
const newVisible = ref(false);
const newForm = ref({
  studentName: '',
  gender: 1,
  phone: '',
  deptCode: 1,
  sourceChannel: 1,
  sourceRemark: '',
  intendCourse: '',
  parentContact: '',
  parentPhone: '',
});

function openNew() {
  newForm.value = {
    studentName: '',
    gender: 1,
    phone: '',
    deptCode: 1,
    sourceChannel: 1,
    sourceRemark: '',
    intendCourse: '',
    parentContact: '',
    parentPhone: '',
  };
  newVisible.value = true;
}

async function submitNew() {
  if (!newForm.value.studentName.trim()) {
    ElMessage.warning('请填写学生姓名');
    return;
  }
  const f = newForm.value;
  const res = await addStudent({
    studentName: f.studentName.trim(),
    gender: f.gender,
    phone: f.phone || undefined,
    deptCode: f.deptCode,
    sourceChannel: f.sourceChannel,
    sourceRemark: f.sourceRemark || undefined,
    intendCourse: f.intendCourse || undefined,
    parentContact: f.parentContact || undefined,
    parentPhone: f.parentPhone || undefined,
  });
  ElMessage.success('新建成功，状态为「待分配」');
  newVisible.value = false;
  load();
}

/* ---------- 分配 / 领取 ---------- */
const assignVisible = ref(false);
const consultants = ref<Array<{ id: string; name: string; title: string }>>([]);
const assignForm = ref({ consultStudentId: '', ownerName: '' });

async function openAssign(row: ConsultStudentListItem | ConsultStudent) {
  const id = (row as any).consultStudentId || (row as any).id;
  assignForm.value = { consultStudentId: id, ownerName: '' };
  if (!consultants.value.length) {
    consultants.value = await fetchConsultants();
  }
  assignVisible.value = true;
}

async function submitAssign() {
  if (!assignForm.value.ownerName) {
    ElMessage.warning('请选择咨询老师');
    return;
  }
  await assignOwner(assignForm.value);
  ElMessage.success('已分配咨询老师');
  assignVisible.value = false;
  await load();
  if (detailVisible.value) await refreshDetail();
}

async function doClaim(row: ConsultStudentListItem | ConsultStudent) {
  const id = (row as any).consultStudentId || (row as any).id;
  await claimStudent(id);
  ElMessage.success('已领取，现在由你跟进');
  await load();
  if (detailVisible.value) await refreshDetail();
}

/* ---------- 面试结果（流程图：「是否接收该学生」→「是否当场报名」） ---------- */
const interviewVisible = ref(false);
const interviewForm = ref({
  consultStudentId: '',
  accepted: true,
  /** ★ 2026-10-08：接收后当场确定是否报名，一步到位 */
  enrolled: true,
  reason: '',
});

function openInterview(row: ConsultStudentListItem | ConsultStudent) {
  const id = (row as any).consultStudentId || (row as any).id;
  interviewForm.value = { consultStudentId: id, accepted: true, enrolled: true, reason: '' };
  interviewVisible.value = true;
}

/**
 * 提交面试结果
 *
 * ★ 2026-10-08 口径：面试结果直接确定「报名 / 未报名 / 不接收」，且只能录一次：
 *    · 接收 + 当场报名   → 状态 → 「试学费·待确认」，去「收费与到账」缴费（面试按钮随之消失）
 *    · 接收 + 未当场报名 → 「未报名·待跟进」（可取消，不计入流失率）
 *    · 不接收            → 到此结束，**不做统计、不计入流失**（状态 REJECTED）
 *  后端有防重护栏：非「待面试」状态再提交会被拒绝，杜绝重复面试。
 */
async function submitInterviewResult() {
  const f = interviewForm.value;
  if (!f.accepted && !f.reason.trim()) {
    ElMessage.warning('不接收时请填写原因，便于复盘');
    return;
  }
  if (f.accepted && !f.enrolled && !f.reason.trim()) {
    ElMessage.warning('未当场报名时请填写原因（如「家长想再对比一下」）');
    return;
  }
  await submitInterviewResultApi(
    f.consultStudentId,
    f.accepted,
    f.reason || undefined,
    f.accepted ? f.enrolled : undefined,
  );
  ElMessage.success(
    !f.accepted
      ? '已记录：不予接收（不计入流失统计）'
      : f.enrolled
        ? '已确认当场报名，请到「收费与到账」发起试学费收费'
        : '已记录「未报名·待跟进」，可随时取消',
  );
  interviewVisible.value = false;
  await load();
  if (detailVisible.value) await refreshDetail();
}

/* ---------- 分班 ---------- */
const classVisible = ref(false);
const classForm = ref({ consultStudentId: '', className: '' });
const classOptions = ref<string[]>([]);

function openClass(d: ConsultStudent) {
  classForm.value = { consultStudentId: d.id, className: '' };
  classOptions.value = d.classOptions || [];
  classVisible.value = true;
}

async function submitClass() {
  if (!classForm.value.className) {
    ElMessage.warning('请选择班级');
    return;
  }
  try {
    await assignClass(classForm.value);
    ElMessage.success('分班成功，学生状态 → 试学中');
    classVisible.value = false;
    await load();
    await refreshDetail();
  } catch {
    /* 后端已提示（如「试学费未到账」） */
  }
}

/* ---------- ★ 2026-10-06 入班（选学段 + 选开放班级） ---------- */
/**
 * 用户口径（2026-10-06）：
 *   「学生管理点『入班』→ 选择进入 初高中 / 大学部 → 选择对应的开放班级
 *     → 确认后学生信息进入到班级」
 *
 * 分流规则与「收款与缴费 → 分班」**完全一致**（复用同一个后端接口）：
 *   · 大学部（module='class'）   → 进「待接收学员」，班主任接收后入班
 *   · 初高中（module='class-jh'）→ **直接入班**（用户口径：初高不需要班主任同意）
 * 幂等：后端按学号去重，重复确认不会重复推送。
 */
const enrollVisible = ref(false);
const enrollSaving = ref(false);
const enrollForm = ref<{ row: ConsultStudentListItem | ConsultStudent | null; side: 'univ' | 'jh'; classId: string }>({
  row: null,
  side: 'univ',
  classId: '',
});
const enrollOpenClasses = ref<{ univ: OpenClassItem[]; jh: OpenClassItem[] }>({ univ: [], jh: [] });

/**
 * 列表整体的分班状态（和「收款与缴费」页同一口径）：
 * 已推送 / 已接收 / 初高已入班 → 「入班」按钮禁用并提示，避免点了才知道报错。
 */
const assignStatus = ref<Record<string, AssignStatusItem>>({});

async function loadAssignStatus() {
  const ids = Array.from(
    new Set(list.value.map((r) => (r as any).consultStudentId || (r as any).id).filter(Boolean) as string[]),
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

/** 当前行还能不能入班（没查到状态时不误伤） */
function canEnrollOf(row: ConsultStudentListItem | ConsultStudent): boolean {
  const s = assignStatus.value[(row as any).consultStudentId || (row as any).id];
  return s ? s.canAssign : true;
}

/** 按钮禁用原因 */
function enrollTipOf(row: ConsultStudentListItem | ConsultStudent): string {
  const s = assignStatus.value[(row as any).consultStudentId || (row as any).id];
  return s ? s.label : '选择学段与开放班级后入班';
}

/** 按学段切开放班级（初高/大学部字段名不同：classId / id） */
const enrollClassOptions = computed(() => {
  const list = enrollForm.value.side === 'jh' ? enrollOpenClasses.value.jh : enrollOpenClasses.value.univ;
  return (list || [])
    .map((c) => ({
      value: String(c.classId ?? c.id ?? ''),
      label: c.className + (c.stageName ? `（${c.stageName}）` : ''),
    }))
    .filter((o) => o.value);
});

async function openEnroll(row: ConsultStudentListItem | ConsultStudent) {
  enrollForm.value = { row, side: 'univ', classId: '' };
  enrollVisible.value = true;
  try {
    enrollOpenClasses.value = await fetchOpenClasses();
  } catch {
    enrollOpenClasses.value = { univ: [], jh: [] };
  }
}

async function submitEnroll() {
  const f = enrollForm.value;
  if (!f.row) return;
  if (!f.classId) {
    ElMessage.warning('请选择要进入的开放班级');
    return;
  }
  const id = (f.row as any).consultStudentId || (f.row as any).id;
  const name = (f.row as any).studentName || '该学员';
  const opt = enrollClassOptions.value.find((o) => o.value === f.classId);
  const target = `「${opt?.label ?? f.classId}」`;

  try {
    await ElMessageBox.confirm(
      f.side === 'jh'
        ? `确认把「${name}」直接分入初高 ${target}？\n初高不需要班主任接收，确认后立即建立学籍入班。`
        : `确认把「${name}」分入 ${target}？\n该学员会进入「待接收学员」，由该班班主任接收后入班（重复确认不会重复推送）。`,
      '确认入班',
      { confirmButtonText: '确认入班', cancelButtonText: '取消', type: 'info' },
    );
  } catch {
    return; // 用户取消
  }

  enrollSaving.value = true;
  try {
    const r = await enrollToClassApi(id, f.classId, f.side === 'jh' ? 'class-jh' : 'class');
    ElMessage.success(
      f.side === 'jh'
        ? `已把「${name}」分入初高 ${target}`
        : r.inserted > 0
          ? `已把「${name}」推送到班级管理，请班主任接收建档`
          : `「${name}」已在「待接收学员」里了（未重复推送）`,
    );
    enrollVisible.value = false;
    await load();
    if (detailVisible.value) await refreshDetail();
  } catch {
    /* 后端已提示（未缴 / 已分班 / 班级模块不可用 等） */
  } finally {
    enrollSaving.value = false;
  }
}

/* ---------- ★ 2026-10-08 取消「未报名」 ---------- */
/**
 * 用户口径：还未报名的，可以取消掉 ——
 * 取消后回到「试学费·待确认」（报名确认态），直接重走缴费流程。
 * ★ 面试结果只能录一次：取消未报名 ≠ 重新面试，所以不回「待面试」。
 */
async function doCancelNotEnroll(row: ConsultStudentListItem | ConsultStudent) {
  const id = (row as any).consultStudentId || (row as any).id;
  const name = (row as any).studentName;
  const { value } = await ElMessageBox.prompt(
    `将取消「${name}」的「未报名·待跟进」标记，状态恢复为「试学费·待确认」，可继续走缴费流程（无需重复面试）。可填备注：`,
    '取消未报名',
    {
      confirmButtonText: '确认取消',
      cancelButtonText: '返回',
      inputPlaceholder: '如「学生又愿意报了」（选填）',
    },
  );
  await cancelNotEnrolled(id, value || undefined);
  ElMessage.success('已取消「未报名」，请到「收费与到账」继续缴费流程');
  await load();
  if (detailVisible.value) await refreshDetail();
}

/* ---------- 流失（明确不来了，计入流失率） ---------- */
const LOSS_REASONS = [
  '学费超出预算',
  '选择其他学校',
  '家庭原因',
  '试学体验不满意',
  '联系方式失效',
  '其他',
];
const lossVisible = ref(false);
const lossForm = ref({ consultStudentId: '', lossReason: '', remark: '' });

function openLoss(row: ConsultStudentListItem | ConsultStudent) {
  const id = (row as any).consultStudentId || (row as any).id;
  lossForm.value = { consultStudentId: id, lossReason: '', remark: '' };
  lossVisible.value = true;
}

async function submitLoss() {
  if (!lossForm.value.lossReason) {
    ElMessage.warning('请选择流失原因');
    return;
  }
  await recordLoss(lossForm.value);
  ElMessage.success('已记录流失（计入流失率）');
  lossVisible.value = false;
  await load();
  if (detailVisible.value) await refreshDetail();
}

/* ============================================================
 * 转正式 · 补缴（流程图：「是否一次性付清学费」）
 *
 * ⚠️ 流程图在这里是一个分叉：
 *    · 是（一次性缴清）→ 把还差的各类型一次全发
 *    · 否（分笔补缴）  → 学生这次缴哪几笔，就只发哪几笔，剩下的下次再发
 * 金额永远由财务按费用标准决定（规则2），本模块**不传 amount**。
 * ============================================================ */
const formalVisible = ref(false);
const formalLoading = ref(false);
const formalForm = ref<{
  consultStudentId: string;
  studentName: string;
  payMode: FormalPayMode;
  feeTypes: FeeType[];
}>({
  consultStudentId: '',
  studentName: '',
  payMode: FPM.FULL,
  feeTypes: [],
});

/** 补缴明细（全款 / 已到账 / 还差） */
const supplementPlan = ref<ConsultSupplementPlan | null>(null);

/** 补缴弹窗里可勾选的类型 = 当前缺口（只让勾还差的，避免重复建单） */
const missingTypes = computed(() => supplementPlan.value?.missing || []);

/**
 * ⚠️ 规则3-①：咨询侧只能发起「学费 / 试学费」。
 *    住宿费 / 餐费 / 保险费归教务模块发起 —— 这里把它们挑出来，
 *    在界面上禁勾并说明原因，而不是让老师勾了再被后端拒绝。
 */
const CONSULT_OWNED_TYPES: FeeType[] = [FeeType.TUITION, FeeType.TRIAL_FEE];

/** 本次可勾选的缺口类型（咨询侧有权发起的） */
const selectableTypes = computed(() =>
  missingTypes.value.filter((t) => CONSULT_OWNED_TYPES.includes(t)),
);

/** 缺口里但归其他模块发起的类型（禁勾 + 提示原因） */
const notOwnedTypes = computed(() =>
  missingTypes.value.filter((t) => !CONSULT_OWNED_TYPES.includes(t)),
);

async function openToFormal(d: ConsultStudent) {
  formalForm.value = {
    consultStudentId: d.id,
    studentName: d.studentName,
    payMode: FPM.FULL,
    feeTypes: [],
  };
  supplementPlan.value = null;
  formalVisible.value = true;
  formalLoading.value = true;
  try {
    supplementPlan.value = await fetchSupplementPlan(d.id);
  } catch (e: any) {
    ElMessage.error(e?.message || '补缴明细加载失败');
  } finally {
    formalLoading.value = false;
  }
}

/** 切换「一次性缴清 / 分笔补缴」时同步勾选状态 */
function onPayModeChange(mode: FormalPayMode) {
  if (mode === FPM.FULL) {
    formalForm.value.feeTypes = [];
  }
}

async function submitToFormal() {
  const f = formalForm.value;
  if (f.payMode === FPM.INSTALLMENT && !f.feeTypes.length) {
    ElMessage.warning('分笔补缴请至少勾选一笔费用类型');
    return;
  }
  try {
    await ElMessageBox.confirm(
      f.payMode === FPM.FULL
        ? `将为「${f.studentName}」一次性发起全部欠费（${
            supplementPlan.value?.missing.map((t) => FEE_TYPE_NAME[t]).join(' / ') || '—'
          }），金额由财务按费用标准取值。是否继续？`
        : `将为「${f.studentName}」发起补缴：${f.feeTypes
            .map((t) => FEE_TYPE_NAME[t])
            .join(' / ')}，剩余欠费下次再缴。是否继续？`,
      '转正式 · 发起收费',
      { type: 'warning', confirmButtonText: '确认发起' },
    );

    const res = await toFormal(
      f.consultStudentId,
      f.payMode,
      f.payMode === FPM.INSTALLMENT ? f.feeTypes : undefined,
    );
    ElMessage.success({ message: res.message || '已发起收费', duration: 5000 });
    formalVisible.value = false;
    await load();
    if (detailVisible.value) await refreshDetail();
  } catch {
    /* 用户取消，或后端已提示（如「已到账无需重复发起」） */
  }
}

/* ---------- 档案完善 ---------- */
const extraVisible = ref(false);
const extraForm = ref({
  consultStudentId: '',
  idCard: '',
  school: '',
  address: '',
  targetCollege: '',
  birthday: '',
  payMode: '',
  remark: '',
});

function openExtra(d: ConsultStudent) {
  extraForm.value = {
    consultStudentId: d.id,
    idCard: d.idCard || '',
    school: d.school || '',
    address: d.address || '',
    targetCollege: d.targetCollege || '',
    birthday: (d as any).birthday || '',
    payMode: d.payMode || '',
    remark: d.remark || '',
  };
  extraVisible.value = true;
}

async function submitExtra() {
  await updateStudentExtra(extraForm.value);
  ElMessage.success('档案已更新');
  extraVisible.value = false;
  await load();
  await refreshDetail();
}

/* ---------- 状态 → 可执行动作 ----------
 *
 * ⚠️ 这里的映射直接对应流程图上的判断点：
 *    待分配   → 分配(经理) / 领取(咨询师)
 *    待面试   → 面试（★ 只能录一次）→「是否接收」+「是否当场报名」
 *    试学费·待确认 → 面试已结束：去「收费与到账」发起收费（本页不再有面试按钮）
 *    试学中   → 转正式 →「是否一次性付清学费」（转正式弹窗里分 FULL/INSTALLMENT）
 *    未报名·待跟进 → 取消未报名（回「试学费·待确认」，不重复面试）
 */
function actionsOf(row: ConsultStudentListItem | ConsultStudent) {
  const s = (row as any).consultState as ConsultState;
  const isMgr = auth.isManagerUp;

  return {
    canAssign: s === CS.WAIT_ASSIGN && isMgr,
    canClaim: s === CS.WAIT_ASSIGN && !isMgr,
    canInterview: s === CS.WAIT_INTERVIEW,
    canClass: s === CS.TRIAL_WAIT_CLASS,
    canToFormal: s === CS.TRIAL || s === CS.FULL_FEE_PENDING,
    /**
     * ★ 2026-10-05 入班（咨询 → 班级管理）
     *
     * 已分班（试学中）及之后的学生，可以把人「交」给学管：
     * 推到班级管理的「待接收学员」，由班主任接收并建档。
     * 幂等：重复点不会重复推送（class 侧按学号/咨询单号去重）。
     */
    canEnroll: [CS.TRIAL, CS.FULL_FEE_PENDING, CS.FORMAL].includes(s),
    /**
     * ★ 2026-10-08：「未报名」不再是待面试阶段的独立按钮 ——
     * 面试结果弹窗里直接确定「报名 / 未报名」。
     * 未报名·待跟进状态 → 显示「取消未报名」。
     */
    canCancelNotEnroll: s === CS.NOT_ENROLLED,
    /** 可记录流失：已经进入试学/缴费阶段才谈得上「流失」 */
    canLoss: [
      CS.TRIAL_FEE_PENDING,
      CS.TRIAL_WAIT_CLASS,
      CS.TRIAL,
      CS.FULL_FEE_PENDING,
    ].includes(s),
  };
}

const fmtMoney = (cent?: number) => (cent == null ? '—' : `¥${(cent / 100).toFixed(2)}`);

/** 从补缴明细里取某类型的金额（用于勾选框后面的「· ¥XXXX」） */
function planAmountOf(t: FeeType): number | undefined {
  return supplementPlan.value?.items.find((i) => i.feeType === t)?.amount;
}

const completenessTag = (c?: { level: string }) => {
  if (!c) return 'info';
  return c.level === 'FULL' ? 'success' : c.level === 'PARTIAL' ? 'warning' : 'info';
};

function openVoucher(url: string) {
  window.open(url, '_blank');
}

onMounted(load);
</script>

<template>
  <div class="page">
    <!-- 搜索栏 -->
    <el-card shadow="never" class="toolbar">
      <div class="toolbar-row">
        <el-input
          v-model="query.keyword"
          placeholder="搜索姓名 / 手机号 / 咨询老师 / 班级 / 来源 / 意向课程"
          clearable
          style="max-width: 380px"
          @keyup.enter="search"
          @clear="search"
        />
        <el-select v-model="query.deptCode" placeholder="全部部门" clearable style="width: 130px">
          <el-option :value="1" :label="DEPT_NAME[1]" />
          <el-option :value="2" :label="DEPT_NAME[2]" />
        </el-select>
        <el-button type="primary" @click="search">查询</el-button>
        <el-button @click="resetQuery">重置</el-button>
        <div class="spacer" />
        <el-button type="primary" plain @click="openNew">＋ 新建学生</el-button>
      </div>

      <!-- 状态筛选 -->
      <div class="state-filter">
        <el-tag
          :effect="query.consultState === undefined ? 'dark' : 'plain'"
          class="state-tag"
          @click="
            () => {
              query.consultState = undefined;
              search();
            }
          "
        >
          全部
        </el-tag>
        <el-tag
          v-for="s in stateOptions"
          :key="s.value"
          :effect="query.consultState === s.value ? 'dark' : 'plain'"
          class="state-tag"
          @click="
            () => {
              query.consultState = s.value;
              search();
            }
          "
        >
          {{ s.label }}
        </el-tag>
      </div>
    </el-card>

    <!-- 列表 -->
    <el-card shadow="never" class="table-card">
      <el-table v-loading="loading" :data="list" stripe style="width: 100%">
        <el-table-column label="学生" min-width="150">
          <template #default="{ row }">
            <div class="stu-name">{{ row.studentName }}</div>
            <div class="stu-sub">{{ row.genderName }} · {{ row.phone || '无手机号' }}</div>
          </template>
        </el-table-column>

        <el-table-column label="来源" min-width="150">
          <template #default="{ row }">
            <el-tag size="small" plain>{{ row.sourceChannelName }}</el-tag>
            <div class="stu-sub">{{ row.source || '—' }}</div>
          </template>
        </el-table-column>

        <el-table-column label="跟进人" min-width="120">
          <template #default="{ row }">
            <span v-if="row.ownerName">{{ row.ownerName }}</span>
            <el-tag v-else size="small" type="warning">待分配</el-tag>
          </template>
        </el-table-column>

        <el-table-column label="当前状态" min-width="130">
          <template #default="{ row }">
            <el-tag size="small" type="primary">{{ row.consultStateName }}</el-tag>
          </template>
        </el-table-column>

        <el-table-column label="信息完整度" min-width="180">
          <template #default="{ row }">
            <el-tag size="small" :type="completenessTag(row.infoCompleteness)">
              {{ row.infoCompleteness.label }}
            </el-tag>
            <div class="stu-sub">
              基本 {{ row.infoCompleteness.baseCount }}/{{ row.infoCompleteness.baseTotal }} · 档案
              {{ row.infoCompleteness.extraCount }}/{{ row.infoCompleteness.extraTotal }}
            </div>
          </template>
        </el-table-column>

        <el-table-column label="收费 / 到账" min-width="130">
          <template #default="{ row }">
            <div>已缴 <b class="ok">{{ row.paidCount }}</b> 笔</div>
            <div class="stu-sub">待确认 {{ row.pendingCount }} 笔</div>
          </template>
        </el-table-column>

        <el-table-column label="操作" width="330" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openDetail(row)">详情</el-button>
            <el-button v-if="actionsOf(row).canAssign" link type="warning" @click="openAssign(row)">
              分配
            </el-button>
            <el-button v-if="actionsOf(row).canClaim" link type="warning" @click="doClaim(row)">
              领取
            </el-button>
            <el-button
              v-if="actionsOf(row).canInterview"
              link
              type="primary"
              @click="openInterview(row)"
            >
              面试
            </el-button>
            <el-button
              v-if="actionsOf(row).canCancelNotEnroll"
              link
              type="warning"
              @click="doCancelNotEnroll(row)"
            >
              取消未报名
            </el-button>
            <!-- 入班：已推送/已接收/初高已入班 → 禁用并提示（与收款与缴费页同口径） -->
            <el-tooltip
              v-if="actionsOf(row).canEnroll"
              :content="enrollTipOf(row)"
              placement="top"
            >
              <span>
                <el-button
                  link
                  type="primary"
                  :disabled="!canEnrollOf(row)"
                  @click="openEnroll(row)"
                >
                  入班
                </el-button>
              </span>
            </el-tooltip>
            <el-button v-if="actionsOf(row).canLoss" link type="danger" @click="openLoss(row)">
              流失
            </el-button>
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

    <!-- ============ 详情抽屉 ============ -->
    <el-drawer v-model="detailVisible" title="学生档案" size="720px">
      <div v-loading="detailLoading">
        <template v-if="detail">
          <div class="d-head">
            <div>
              <div class="d-name">
                {{ detail.studentName }}
                <el-tag size="small" type="primary">{{ detail.consultStateName }}</el-tag>
              </div>
              <div class="d-sub">
                {{ detail.genderName }} · {{ detail.phone || '无手机号' }} · {{ detail.deptName }}
              </div>
            </div>
            <div class="d-actions">
              <el-button size="small" @click="openExtra(detail)">完善档案</el-button>
              <el-button
                v-if="actionsOf(detail).canInterview"
                size="small"
                type="primary"
                @click="openInterview(detail)"
              >
                录入面试结果
              </el-button>
              <el-button
                v-if="actionsOf(detail).canClass"
                size="small"
                type="primary"
                @click="openClass(detail)"
              >
                分班
              </el-button>
              <el-tooltip
                v-if="actionsOf(detail).canEnroll"
                :content="enrollTipOf(detail)"
                placement="top"
              >
                <span>
                  <el-button
                    size="small"
                    type="primary"
                    plain
                    :disabled="!canEnrollOf(detail)"
                    @click="openEnroll(detail)"
                  >
                    入班
                  </el-button>
                </span>
              </el-tooltip>
              <el-button
                v-if="actionsOf(detail).canToFormal"
                size="small"
                type="success"
                @click="openToFormal(detail)"
              >
                转正式
              </el-button>
              <el-button
                v-if="actionsOf(detail).canCancelNotEnroll"
                size="small"
                type="warning"
                @click="doCancelNotEnroll(detail)"
              >
                取消未报名
              </el-button>
              <el-button
                v-if="actionsOf(detail).canToFormal"
                size="small"
                type="warning"
                @click="openToFormal(detail)"
              >
                补缴
              </el-button>
            </div>
          </div>

          <el-descriptions title="基本信息" :column="2" border size="small" class="d-block">
            <el-descriptions-item label="来源">
              {{ detail.sourceChannelName }}{{ detail.sourceRemark ? ' · ' + detail.sourceRemark : '' }}
            </el-descriptions-item>
            <el-descriptions-item label="意向课程">{{ detail.intendCourse || '—' }}</el-descriptions-item>
            <el-descriptions-item label="跟进人">
              {{ detail.ownerName || '待分配' }}
              <span v-if="detail.ownerTitle" class="d-sub">（{{ detail.ownerTitle }}）</span>
            </el-descriptions-item>
            <el-descriptions-item label="建档人">{{ detail.creatorName || '—' }}</el-descriptions-item>
            <el-descriptions-item label="家长联系人">{{ detail.parentContact || '—' }}</el-descriptions-item>
            <el-descriptions-item label="家长电话">{{ detail.parentPhone || '—' }}</el-descriptions-item>
            <el-descriptions-item label="班级">{{ detail.className || '未分班' }}</el-descriptions-item>
            <el-descriptions-item label="试学开始">{{ detail.trialStart || '—' }}</el-descriptions-item>
            <el-descriptions-item label="身份证号">{{ detail.idCard || '—' }}</el-descriptions-item>
            <el-descriptions-item label="就读/毕业学校">{{ detail.school || '—' }}</el-descriptions-item>
            <el-descriptions-item label="家庭住址" :span="2">{{ detail.address || '—' }}</el-descriptions-item>
            <el-descriptions-item label="报考院校">{{ detail.targetCollege || '—' }}</el-descriptions-item>
            <el-descriptions-item label="缴费方式">{{ detail.payMode || '—' }}</el-descriptions-item>
            <el-descriptions-item label="备注" :span="2">{{ detail.remark || '—' }}</el-descriptions-item>
          </el-descriptions>

          <div v-if="detail.fullFeeStatus" class="d-block">
            <el-alert
              :type="detail.fullFeeStatus.allArrived ? 'success' : 'info'"
              :closable="false"
              show-icon
            >
              <template #title>
                {{
                  detail.fullFeeStatus.allArrived
                    ? '全款 4 项（学费/住宿费/餐费/保险费）均已到账'
                    : '全款未齐：还缺 ' + detail.fullFeeStatus.missing.length + ' 项'
                }}
              </template>
            </el-alert>
          </div>

          <div class="d-block">
            <div class="d-title">缴费单（{{ detail.fees?.length || 0 }}）</div>
            <el-table v-if="detail.fees?.length" :data="detail.fees" size="small" border>
              <el-table-column prop="orderNo" label="单号" width="150" />
              <el-table-column prop="feeTypeName" label="类型" width="80" />
              <el-table-column label="金额" width="100">
                <template #default="{ row }">{{ fmtMoney(row.amount) }}</template>
              </el-table-column>
              <el-table-column label="状态" width="100">
                <template #default="{ row }">
                  <el-tag size="small" :type="row.status === 2 ? 'success' : 'info'">
                    {{ row.status === 2 ? '已到账' : row.status === 1 ? '待确认' : '待上传' }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="凭证" width="90">
                <template #default="{ row }">
                  <el-button
                    v-if="row.voucherUrl"
                    link
                    type="primary"
                    @click="openVoucher(row.voucherUrl)"
                  >
                    查看
                  </el-button>
                  <span v-else class="d-sub">无</span>
                </template>
              </el-table-column>
              <el-table-column prop="createTime" label="创建时间" min-width="140" />
            </el-table>
            <el-empty v-else description="暂无缴费单" :image-size="60" />
          </div>

          <div v-if="detail.refund" class="d-block">
            <div class="d-title">退费单</div>
            <el-descriptions :column="2" border size="small">
              <el-descriptions-item label="退费单号">{{ detail.refund.refundNo }}</el-descriptions-item>
              <el-descriptions-item label="状态">{{ detail.refund.statusName }}</el-descriptions-item>
              <el-descriptions-item label="试学天数">{{ detail.refund.trialDays }} 天</el-descriptions-item>
              <el-descriptions-item label="消耗扣减">
                {{ fmtMoney(detail.refund.deductTotal) }}
              </el-descriptions-item>
              <el-descriptions-item label="应退金额" :span="2">
                <b class="warn">{{ fmtMoney(detail.refund.refundAmount) }}</b>
              </el-descriptions-item>
            </el-descriptions>
          </div>

          <div class="d-block">
            <div class="d-title">跟进历史（{{ detail.history?.length || 0 }}）</div>
            <el-timeline v-if="detail.history?.length">
              <el-timeline-item
                v-for="(h, i) in detail.history"
                :key="i"
                :timestamp="h.at"
                placement="top"
              >
                <div class="h-action">{{ h.text }}</div>
                <div class="d-sub">
                  {{ h.by }}{{ h.byTitle ? ' · ' + h.byTitle : '' }}
                </div>
              </el-timeline-item>
            </el-timeline>
            <el-empty v-else description="暂无跟进记录" :image-size="60" />
          </div>
        </template>
      </div>
    </el-drawer>

    <!-- ============ 新建学生 ============ -->
    <el-dialog v-model="newVisible" title="新建学生" width="560px">
      <el-form label-width="96px">
        <el-form-item label="姓名" required>
          <el-input v-model="newForm.studentName" placeholder="学生姓名" />
        </el-form-item>
        <el-form-item label="性别">
          <el-radio-group v-model="newForm.gender">
            <el-radio :value="1">男</el-radio>
            <el-radio :value="2">女</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="手机号">
          <el-input v-model="newForm.phone" placeholder="学生本人手机号" />
        </el-form-item>
        <el-form-item label="部门">
          <el-select v-model="newForm.deptCode" style="width: 100%">
            <el-option :value="1" :label="DEPT_NAME[1]" />
            <el-option :value="2" :label="DEPT_NAME[2]" />
          </el-select>
        </el-form-item>
        <el-form-item label="来源">
          <el-select v-model="newForm.sourceChannel" style="width: 100%">
            <el-option :value="1" label="家访" />
            <el-option :value="2" label="线上咨询" />
            <el-option :value="3" label="转介绍" />
            <el-option :value="4" label="主动上门" />
            <el-option :value="5" label="电话咨询" />
            <el-option :value="9" label="其他" />
          </el-select>
        </el-form-item>
        <el-form-item label="来源备注">
          <el-input v-model="newForm.sourceRemark" placeholder="如「青山社区」" />
        </el-form-item>
        <el-form-item label="意向课程">
          <el-input v-model="newForm.intendCourse" placeholder="如「护理班」" />
        </el-form-item>
        <el-form-item label="家长联系人">
          <el-input v-model="newForm.parentContact" placeholder="如「陈建国（父）」" />
        </el-form-item>
        <el-form-item label="家长电话">
          <el-input v-model="newForm.parentPhone" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="newVisible = false">取消</el-button>
        <el-button type="primary" @click="submitNew">确定</el-button>
      </template>
    </el-dialog>

    <!-- ============ 分配 ============ -->
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

    <!-- ============ 面试结果（流程图：「是否接收该学生」→「是否当场报名」） ============ -->
    <el-dialog v-model="interviewVisible" title="录入面试结果" width="520px">
      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="对应流程图「是否接收该学生」：不接收则流程到此结束，不计统计、不计流失"
        class="mb"
      />
      <el-form label-width="110px">
        <el-form-item label="是否接收" required>
          <el-radio-group v-model="interviewForm.accepted">
            <el-radio :value="true">接收（继续走报名流程）</el-radio>
            <el-radio :value="false">不接收（结束，不计统计）</el-radio>
          </el-radio-group>
        </el-form-item>
        <!-- ★ 2026-10-08：面试通过后当场确定「报名 / 未报名」，一步到位 -->
        <el-form-item v-if="interviewForm.accepted" label="是否当场报名" required>
          <el-radio-group v-model="interviewForm.enrolled">
            <el-radio :value="true">当场报名（进入缴费流程）</el-radio>
            <el-radio :value="false">未报名（记「未报名·待跟进」，可取消）</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="原因 / 评价">
          <el-input
            v-model="interviewForm.reason"
            type="textarea"
            :rows="3"
            :placeholder="
              !interviewForm.accepted
                ? '不接收的原因（必填），如「基础太弱，建议明年再来」'
                : interviewForm.enrolled
                  ? '面试通过评价（选填）'
                  : '未当场报名的原因（必填），如「家长想再对比一下其他机构」'
            "
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="interviewVisible = false">取消</el-button>
        <el-button type="primary" @click="submitInterviewResult">提交</el-button>
      </template>
    </el-dialog>

    <!-- 取消「未报名」：用 ElMessageBox.prompt 轻量确认，无需独立弹窗 -->

    <!-- ============ 转正式 / 补缴（流程图：「是否一次性付清学费」） ============ -->
    <el-dialog v-model="formalVisible" title="转正式 · 发起收费" width="620px">
      <div v-loading="formalLoading">
        <!-- 补缴明细 -->
        <div v-if="supplementPlan" class="plan-box">
          <div class="plan-row">
            <span>全款合计</span>
            <b>{{ fmtMoney(supplementPlan.totalAmount) }}</b>
          </div>
          <div class="plan-row">
            <span>已到账</span>
            <b class="ok">{{ fmtMoney(supplementPlan.arrivedAmount) }}</b>
          </div>
          <div class="plan-row">
            <span>仍缺</span>
            <b class="warn">
              {{ fmtMoney(supplementPlan.missingAmount) }}
              <span v-if="supplementPlan.missing.length" class="d-sub">
                （{{ supplementPlan.missing.map((t) => FEE_TYPE_NAME[t]).join('、') }}）
              </span>
            </b>
          </div>

          <el-table :data="supplementPlan.items" size="small" border class="plan-table">
            <el-table-column label="费用类型" width="90">
              <template #default="{ row }">{{ row.feeTypeName }}</template>
            </el-table-column>
            <el-table-column label="金额" width="110">
              <template #default="{ row }">{{ fmtMoney(row.amount) }}</template>
            </el-table-column>
            <el-table-column label="状态" width="100">
              <template #default="{ row }">
                <el-tag
                  size="small"
                  :type="
                    row.state === 'ARRIVED'
                      ? 'success'
                      : row.state === 'PENDING'
                        ? 'warning'
                        : row.state === 'REJECTED'
                          ? 'danger'
                          : 'info'
                  "
                >
                  {{ row.stateName }}
                </el-tag>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <el-alert
          v-if="supplementPlan?.allArrived"
          type="success"
          :closable="false"
          show-icon
          title="全款已到账，无需再次发起"
          class="mb"
        />

        <!-- 缴费方式分支 -->
        <el-form v-else label-width="110px" class="mt">
          <el-form-item label="缴费方式" required>
            <el-radio-group
              v-model="formalForm.payMode"
              @change="onPayModeChange(formalForm.payMode)"
            >
              <el-radio :value="FPM.FULL">一次性缴清（把欠费全发）</el-radio>
              <el-radio :value="FPM.INSTALLMENT">分笔补缴（本次缴哪几笔就发哪几笔）</el-radio>
            </el-radio-group>
          </el-form-item>

          <el-form-item v-if="formalForm.payMode === FPM.INSTALLMENT" label="本次补缴">
            <div>
              <el-checkbox-group v-model="formalForm.feeTypes">
                <el-checkbox v-for="t in selectableTypes" :key="t" :value="t">
                  {{ FEE_TYPE_NAME[t] }} · {{ fmtMoney(planAmountOf(t)) }}
                </el-checkbox>
              </el-checkbox-group>

              <div v-if="!selectableTypes.length" class="d-sub">
                当前缺口里没有咨询模块可发起的类型。
              </div>

              <!-- 规则3-①：归属其他模块的类型，禁勾并说明 -->
              <div v-if="notOwnedTypes.length" class="owned-tip">
                <el-icon><InfoFilled /></el-icon>
                <span>
                  以下类型归其他模块发起，咨询侧无权建单：
                  <b>{{ notOwnedTypes.map((t) => FEE_TYPE_NAME[t]).join('、') }}</b>
                  <span class="d-sub">（住宿费/餐费/保险费请由教务模块发起）</span>
                </span>
              </div>

              <div class="d-sub mt6">
                只能勾选「仍缺」且本模块有权发起的类型；未勾选的留到下次补缴。
                金额由财务按费用标准给出，本模块不填金额。
              </div>
            </div>
          </el-form-item>

          <!-- 一次性缴清时也提前告知哪些不会由本模块发起 -->
          <el-alert
            v-else-if="notOwnedTypes.length"
            type="info"
            :closable="false"
            show-icon
            :title="`一次性缴清只会发起咨询侧可建的 ${
              selectableTypes.map((t) => FEE_TYPE_NAME[t]).join('、') || '（无）'
            }；${notOwnedTypes.map((t) => FEE_TYPE_NAME[t]).join('、')} 需由教务模块发起`"
            class="mt"
          />
        </el-form>
      </div>

      <template #footer>
        <el-button @click="formalVisible = false">取消</el-button>
        <el-button
          type="primary"
          :disabled="!supplementPlan || supplementPlan.allArrived"
          @click="submitToFormal"
        >
          {{ formalForm.payMode === FPM.FULL ? '一次性发起收费' : '发起本次补缴' }}
        </el-button>
      </template>
    </el-dialog>

    <!-- ============ ★ 入班（选学段 + 选开放班级） ============ -->
    <el-dialog v-model="enrollVisible" title="入班" width="560px">
      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="先选学段，再选该学段下的开放班级；大学部需班主任接收，初高确认后直接入班"
        class="mb"
      />
      <el-form label-width="90px" label-position="right">
        <el-form-item label="学生">
          <span>{{ (enrollForm.row && (enrollForm.row.studentName || '—')) || '—' }}</span>
        </el-form-item>
        <el-form-item label="进入学段" required>
          <el-radio-group
            v-model="enrollForm.side"
            :disabled="enrollSaving"
            @change="enrollForm.classId = ''"
          >
            <el-radio-button value="univ">大学部</el-radio-button>
            <el-radio-button value="jh">初高中</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="开放班级" required>
          <el-select
            v-model="enrollForm.classId"
            placeholder="请选择该学段下的开放班级"
            style="width: 100%"
            :disabled="enrollSaving"
            filterable
          >
            <el-option
              v-for="o in enrollClassOptions"
              :key="o.value"
              :value="o.value"
              :label="o.label"
            />
          </el-select>
          <div v-if="!enrollClassOptions.length" class="tip-warn">
            该学段当前没有开放班级（班级管理 / 教学管理（初高）里把班级状态置为「开放」后才会出现）
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="enrollSaving" @click="enrollVisible = false">取消</el-button>
        <el-button type="primary" :loading="enrollSaving" @click="submitEnroll">
          确认入班
        </el-button>
      </template>
    </el-dialog>

    <!-- ============ 分班 ============ -->
    <el-dialog v-model="classVisible" title="分班" width="420px">
      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="分班前系统会校验试学费是否已到账"
        class="mb"
      />
      <el-select v-model="classForm.className" placeholder="请选择班级" style="width: 100%">
        <el-option v-for="c in classOptions" :key="c" :value="c" :label="c" />
      </el-select>
      <template #footer>
        <el-button @click="classVisible = false">取消</el-button>
        <el-button type="primary" @click="submitClass">确定分班</el-button>
      </template>
    </el-dialog>

    <!-- ============ 流失 ============ -->
    <el-dialog v-model="lossVisible" title="记录流失" width="460px">
      <el-form label-width="90px">
        <el-form-item label="流失原因" required>
          <el-select v-model="lossForm.lossReason" placeholder="请选择" style="width: 100%">
            <el-option v-for="r in LOSS_REASONS" :key="r" :value="r" :label="r" />
          </el-select>
        </el-form-item>
        <el-form-item label="补充说明">
          <el-input v-model="lossForm.remark" type="textarea" :rows="3" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="lossVisible = false">取消</el-button>
        <el-button type="danger" @click="submitLoss">确认流失</el-button>
      </template>
    </el-dialog>

    <!-- ============ 完善档案 ============ -->
    <el-dialog v-model="extraVisible" title="完善档案" width="520px">
      <el-form label-width="110px">
        <el-form-item label="身份证号">
          <el-input v-model="extraForm.idCard" />
        </el-form-item>
        <el-form-item label="就读/毕业学校">
          <el-input v-model="extraForm.school" />
        </el-form-item>
        <el-form-item label="家庭住址">
          <el-input v-model="extraForm.address" />
        </el-form-item>
        <el-form-item label="报考院校">
          <el-input v-model="extraForm.targetCollege" />
        </el-form-item>
        <el-form-item label="出生日期">
          <el-input v-model="extraForm.birthday" placeholder="YYYY-MM-DD" />
        </el-form-item>
        <el-form-item label="缴费方式">
          <el-input v-model="extraForm.payMode" placeholder="如「分期缴纳」" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="extraForm.remark" type="textarea" :rows="3" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="extraVisible = false">取消</el-button>
        <el-button type="primary" @click="submitExtra">保存</el-button>
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

.toolbar-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.spacer {
  flex: 1;
}

.state-filter {
  margin-top: 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.state-tag {
  cursor: pointer;
  user-select: none;
}

.table-card {
  flex: 1;
}

.stu-name {
  font-weight: 600;
  color: #303133;
}

.stu-sub {
  font-size: 12px;
  color: #909399;
  margin-top: 2px;
}

.ok {
  color: #67c23a;
}

.warn {
  color: #e6a23c;
}

.d-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid #ebeef5;
}

.d-name {
  font-size: 18px;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 8px;
}

.d-sub {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
}

.d-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.d-block {
  margin-top: 18px;
}

.d-title {
  font-weight: 600;
  color: #303133;
  margin-bottom: 8px;
}

.h-action {
  font-size: 13px;
  color: #303133;
}

.mb {
  margin-bottom: 12px;
}

/* ---- 转正式 / 补缴弹窗 ---- */
.plan-box {
  background: #f7f9fc;
  border: 1px solid #e4e9f2;
  border-radius: 6px;
  padding: 12px 14px;
}

.plan-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  font-size: 13px;
  color: #606266;
  padding: 3px 0;
}

.plan-table {
  margin-top: 10px;
}

.mt {
  margin-top: 14px;
}

.mt6 {
  margin-top: 6px;
}

/* 规则3-① 归属提示：其他模块发起的类型，禁勾说明 */
.owned-tip {
  display: flex;
  align-items: flex-start;
  gap: 5px;
  margin-top: 8px;
  padding: 7px 9px;
  background: #fdf6ec;
  border: 1px solid #f5dab1;
  border-radius: 4px;
  font-size: 12px;
  color: #b88230;
  line-height: 1.6;
}
</style>
