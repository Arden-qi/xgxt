<template>
  <div class="note-box brand">
    咨询管理推送来的学员、<b>教学管理（初高）升学来的学员</b>、<b>成绩管理「末班」转来的重修学员</b>
    以及<b>班级信息管理「换班」转来的学员</b>，都在这里<b>接收或驳回</b>。
    接收后学员落入「班级信息管理」并归入<b>接受班级</b>；驳回需填写原因。
    <br />
    <b>接受班级由咨询 / 教学管理（初高）在推送时决定</b>，本页面不提供班级选择 ——
    只有<b>该班的班主任</b>、<b>校长</b>和<b>学管</b>可以接收；驳回后由咨询侧重新分班。
  </div>

  <!-- ============ KPI ============ -->
  <div class="kpi-row">
    <div class="kpi k-amber">
      <div class="kpi-l">待接收</div>
      <div class="kpi-v">{{ kpi.pending }}<small>人</small></div>
      <div class="kpi-s">等待学管处理</div>
    </div>
    <div class="kpi k-green">
      <div class="kpi-l">已接收</div>
      <div class="kpi-v">{{ kpi.received }}<small>人</small></div>
      <div class="kpi-s">已落入学员档案</div>
    </div>
    <div class="kpi">
      <div class="kpi-l">已驳回</div>
      <div class="kpi-v">{{ kpi.rejected }}<small>人</small></div>
      <div class="kpi-s">未通过接收</div>
    </div>
  </div>

  <!-- ============ 待接收卡片区 ============ -->
  <el-card shadow="never" class="panel-card">
    <div class="block-title">待接收（{{ pendingRows.length }}）</div>
    <div v-loading="loadingPending" class="card-area">
      <div v-for="c in pendingRows" :key="c.id" class="consult-card">
        <div class="cc-head">
          <b>{{ c.studentName }}</b>
          <el-tag :type="c.isTransfer ? 'success' : c.isRepeatIn ? 'warning' : 'info'" size="small" effect="plain">
            {{ c.sourceKind || (c.isTransfer ? '换班转入' : c.isRepeatIn ? '末班重修' : '咨询新生') }}
          </el-tag>
          <span class="cc-age" v-if="c.age != null">{{ c.age }} 岁</span>
        </div>
        <div class="cc-line"><span class="cc-k">电话</span>{{ c.phone || '—' }}</div>
        <div class="cc-line"><span class="cc-k">家长</span>{{ c.parentPhone || '—' }}</div>
        <div v-if="c.isRepeatIn || c.isTransfer" class="cc-line">
          <span class="cc-k">原班级</span>{{ c.fromClassName || '—' }}
        </div>
        <div class="cc-line"><span class="cc-k">转入班级</span>{{ c.intendClassName || '—' }}</div>
        <div v-if="c.isTransfer" class="cc-line">
          <span class="cc-k">换班原因</span>{{ c.transferReason || c.remark || '—' }}
        </div>
        <div class="cc-line">
          <span class="cc-k">意向阶段</span>{{ c.intendStageName || dict.label('stage', c.intendStage) }}
        </div>
        <!--
          ★ 2026-10-06（用户拍板）：接受班级**由咨询 / 初高在推送时决定**，
            本页面【不提供】班级选择 —— 这里只做只读展示。
            班主任/校长/学管只能「接收」或「驳回」，不能把学员改派到别的班。
        -->
        <div class="cc-line cc-accept">
          <span class="cc-k">接受班级</span>
          <b :class="{ 'cc-miss': !c.intendClassId }">{{ c.intendClassName || '咨询未指定班级' }}</b>
        </div>
        <div class="cc-line cc-remark"><span class="cc-k">备注</span>{{ c.remark || '—' }}</div>
        <div class="cc-line"><span class="cc-k">推送</span>{{ c.pushTime || '—' }}</div>
        <div class="cc-fn" v-if="canReceiveCard(c) && c.intendClassId">
          <el-button type="primary" size="small" @click="openReceive(c)">接收</el-button>
          <el-button type="warning" size="small" @click="openReject(c)">驳回</el-button>
        </div>
        <div class="cc-fn" v-else-if="!c.intendClassId">
          <el-tag size="small" type="warning" effect="plain">咨询未指定班级，待咨询补填</el-tag>
        </div>
        <div class="cc-fn" v-else>
          <el-tag size="small" type="info" effect="plain">仅本班班主任 / 校长 / 学管可接收</el-tag>
        </div>
      </div>
      <el-empty v-if="!pendingRows.length && !loadingPending" :image-size="70" description="暂无待接收学员" />
    </div>
  </el-card>

  <!-- ============ 全部推送记录 ============ -->
  <el-card shadow="never" class="panel-card">
    <div class="toolbar">
      <el-input
        v-model="tableFilters.keyword"
        class="w-search"
        placeholder="搜索姓名 / 学号 / 咨询单号"
        clearable
        :prefix-icon="Search"
        @keyup.enter="loadTable"
        @clear="loadTable"
      />
      <el-select v-model="tableFilters.applyStatus" placeholder="全部状态" clearable style="width: 130px" @change="loadTable">
        <el-option v-for="o in dict.options('consultStatus')" :key="o.value" :label="o.label" :value="o.value" />
      </el-select>
      <el-button :icon="Search" @click="loadTable">搜索</el-button>
    </div>

    <el-table v-loading="loadingTable" :data="tableRows" size="small" border style="margin-top: 12px">
      <el-table-column prop="consultNo" label="咨询单号" width="150">
        <template #default="{ row }"><span class="mono">{{ row.consultNo }}</span></template>
      </el-table-column>
      <el-table-column prop="studentName" label="姓名" width="100" />
      <el-table-column label="性别" width="64">
        <template #default="{ row }">{{ row.genderName || dict.label('gender', row.gender) }}</template>
      </el-table-column>
      <el-table-column prop="phone" label="电话" width="120" />
      <el-table-column prop="parentPhone" label="家长电话" width="120" />
      <el-table-column label="意向班级" width="120">
        <template #default="{ row }">{{ row.intendClassName || '—' }}</template>
      </el-table-column>
      <el-table-column label="意向阶段" width="100">
        <template #default="{ row }">{{ row.intendStageName || dict.label('stage', row.intendStage) }}</template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="dict.tagTypeOf('consultStatus', row.applyStatus)" size="small" effect="light">
            {{ row.applyStatusName || dict.label('consultStatus', row.applyStatus) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="pushTime" label="推送时间" width="150" />
      <el-table-column prop="receiverName" label="接收人" width="100">
        <template #default="{ row }">{{ row.receiverName || '—' }}</template>
      </el-table-column>
      <el-table-column prop="rejectReason" label="驳回原因" min-width="150" show-overflow-tooltip>
        <template #default="{ row }">{{ row.rejectReason || '—' }}</template>
      </el-table-column>
      <template #empty><el-empty :image-size="70" description="暂无推送记录" /></template>
    </el-table>

    <el-pagination
      v-model:current-page="tablePage"
      v-model:page-size="tableSize"
      :total="tableTotal"
      :page-sizes="[10, 20, 50, 100]"
      layout="total, sizes, prev, pager, next, jumper"
      @current-change="loadTable"
      @size-change="onTableSizeChange"
    />
  </el-card>

  <!-- ============ 接收 ============ -->
  <el-dialog v-model="receiveVisible" title="接收学员" width="720px" top="5vh" destroy-on-close>
    <el-form ref="receiveRef" :model="receiveForm" :rules="receiveRules" label-width="110px" label-position="right">
      <el-form-item label="学员">
        <el-input :model-value="activeConsult ? `${activeConsult.studentName} · ${activeConsult.consultNo}` : ''" disabled />
      </el-form-item>
      <!-- ★ 2026-10-06：接受班级只读 —— 由咨询 / 初高推送时决定，此处不可改 -->
      <el-form-item label="接受班级">
        <el-input :model-value="activeConsult?.intendClassName || '（咨询未指定）'" disabled />
        <div class="form-hint">
          归入班级由<b>咨询 / 教学管理（初高）</b>推送时确定，接收时不可更改。
          如需换班，请先<b>驳回</b>，由咨询侧重新分班。
        </div>
      </el-form-item>
      <el-row :gutter="16">
        <el-col :span="12">
          <el-form-item label="学号">
            <el-input v-model="receiveForm.studentNo" placeholder="留空则由系统生成" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="学习阶段">
            <el-select v-model="receiveForm.stage" clearable style="width: 100%">
              <el-option v-for="o in stageOptions" :key="o.value" :label="o.label" :value="o.value" />
            </el-select>
          </el-form-item>
        </el-col>
      </el-row>
      <el-row :gutter="16">
        <el-col :span="12">
          <el-form-item label="手机号"><el-input v-model="receiveForm.phone" /></el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="家长手机号"><el-input v-model="receiveForm.parentPhone" /></el-form-item>
        </el-col>
      </el-row>
      <el-row :gutter="16">
        <el-col :span="12">
          <el-form-item label="学历">
            <el-select v-model="receiveForm.education" clearable style="width: 100%">
              <el-option v-for="e in EDUCATIONS" :key="e" :label="e" :value="e" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="入学日期">
            <el-date-picker v-model="receiveForm.enrollDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
          </el-form-item>
        </el-col>
      </el-row>
      <el-row :gutter="16">
        <el-col :span="12">
          <el-form-item label="学生状态">
            <el-select v-model="receiveForm.studentStatus" style="width: 100%">
              <el-option v-for="o in dict.options('studentStatus')" :key="o.value" :label="o.label" :value="o.value" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="年龄">
            <el-input-number v-model="receiveForm.age" :min="5" :max="60" controls-position="right" style="width: 100%" />
          </el-form-item>
        </el-col>
      </el-row>
      <el-form-item label="宿舍 / 床位">
        <BedSelect v-model="dormPick" />
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="receiveForm.remark" type="textarea" :rows="2" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="receiveVisible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="submitReceive">确认接收</el-button>
    </template>
  </el-dialog>

  <!-- ============ 驳回 ============ -->
  <el-dialog v-model="rejectVisible" title="驳回接收" width="520px" destroy-on-close>
    <el-alert type="warning" :closable="false" show-icon style="margin-bottom: 14px">
      驳回需填写原因，学员将退回咨询管理重新跟进。
    </el-alert>
    <el-form ref="rejectRef" :model="rejectForm" :rules="rejectRules" label-width="90px">
      <el-form-item label="学员">
        <el-input :model-value="activeConsult?.studentName || ''" disabled />
      </el-form-item>
      <el-form-item label="驳回原因" prop="rejectReason">
        <el-input v-model="rejectForm.rejectReason" type="textarea" :rows="3" placeholder="请说明驳回原因" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="rejectVisible = false">取消</el-button>
      <el-button type="danger" :loading="saving" @click="submitReject">确认驳回</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { Search } from '@element-plus/icons-vue';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { consultList, consultReceive, consultReject } from '@/class/api';
import type { ConsultItem } from '@/class/api/types';
import { useDictStore } from '@/class/stores/dict';
import { useUserStore } from '@/class/stores/user';
import BedSelect, { type BedPick } from '@/class/components/BedSelect.vue';

/**
 * 待接收学员（咨询同步）
 *
 * 数据来自 /api/class/consult/list：applyStatus 1 待接收 / 2 已接收 / 3 已驳回。
 * 接收把学员归入班级（同时可补学号 / 阶段 / 宿舍床位），驳回需填原因。
 */
const dict = useDictStore();
const user = useUserStore();

/**
 * ★ 2026-10-06 用户拍板：谁能接收？
 *   「对应班级的班主任可以接收学员，校长和学管也可以」
 *
 * 所以判定改成「角色 + 班级归属」两个条件，而不是单纯的按钮权限码：
 *   · 校长 / 学管主任 / 系统管理员 → 任何推送单都能接收（全局）
 *   · 班主任（TEACH_HEAD）          → **只有**推送目标班级是自己带的班时才能接收
 *   · 其余角色（教务 / 就业 / 教员 / 助教）→ 不能接收
 *
 * 后端 /api/class/consult/receive 会按同样口径复判一次（前端只管按钮显隐）。
 */
const GLOBAL_RECEIVER_ROLES: string[] = ['RM_PRINCIPAL', 'TEACH_DEAN', 'SYS_ADMIN'];

const isGlobalReceiver = computed(() =>
  user.roles.some((r: string) => GLOBAL_RECEIVER_ROLES.includes(r)),
);

/** 我负责的班级 ID（后端 /api/class/me 下发） */
const myClassIds = computed<string[]>(() => user.meInfo?.classIds ?? []);

/** 某条推送单当前登录人能否接收 */
function canReceiveCard(row: ConsultItem): boolean {
  if (isGlobalReceiver.value) return true;
  if (!user.roles.includes('TEACH_HEAD')) return false;
  const target = row.intendClassId;
  return !!target && myClassIds.value.includes(target);
}

/** 是否具备「驳回」权限（与接收同口径：本班班主任 / 校长 / 学管） */
const canReject = canReceiveCard;

const kpi = reactive<{ pending: number; received: number; rejected: number }>({ pending: 0, received: 0, rejected: 0 });

/* ---------------- 待接收卡片 ---------------- */
const loadingPending = ref(false);
const pendingRows = ref<ConsultItem[]>([]);

/* ---------------- 全部推送记录 ---------------- */
const loadingTable = ref(false);
const tableRows = ref<ConsultItem[]>([]);
const tableTotal = ref(0);
const tablePage = ref(1);
const tableSize = ref(10);
const tableFilters = reactive<{ keyword: string; applyStatus: number | null }>({ keyword: '', applyStatus: null });

const EDUCATIONS = ['初中', '高中', '中专', '大专', '本科在读', '本科', '硕士'];
const stageOptions = computed(() => dict.options('stage'));

async function loadKpi(): Promise<void> {
  const [p, r, j] = await Promise.all([
    consultList({ page: 1, size: 1, applyStatus: 1 }),
    consultList({ page: 1, size: 1, applyStatus: 2 }),
    consultList({ page: 1, size: 1, applyStatus: 3 }),
  ]);
  kpi.pending = p.total ?? 0;
  kpi.received = r.total ?? 0;
  kpi.rejected = j.total ?? 0;
}

async function loadPending(): Promise<void> {
  loadingPending.value = true;
  try {
    const res = await consultList({ page: 1, size: 200, applyStatus: 1 });
    pendingRows.value = res.list ?? [];
  } finally {
    loadingPending.value = false;
  }
}

async function loadTable(): Promise<void> {
  loadingTable.value = true;
  try {
    const res = await consultList({
      page: tablePage.value,
      size: tableSize.value,
      keyword: tableFilters.keyword.trim() || undefined,
      ...({ applyStatus: tableFilters.applyStatus ?? undefined } as Record<string, unknown>),
    });
    tableRows.value = res.list ?? [];
    tableTotal.value = res.total ?? 0;
  } finally {
    loadingTable.value = false;
  }
}

function onTableSizeChange(): void {
  tablePage.value = 1;
  void loadTable();
}

/* ---------------- 接收 ---------------- */
const receiveVisible = ref(false);
const saving = ref(false);
const receiveRef = ref<FormInstance>();
const activeConsult = ref<ConsultItem | null>(null);
const dormPick = ref<BedPick>({ dormId: null, dormNo: null, bedNo: null });
const receiveForm = reactive<{
  classId: string | null;
  studentNo: string;
  stage: number | null;
  age: number | null;
  phone: string;
  parentPhone: string;
  education: string | null;
  enrollDate: string | null;
  studentStatus: number;
  remark: string;
}>({
  classId: null,
  studentNo: '',
  stage: null,
  age: null,
  phone: '',
  parentPhone: '',
  education: null,
  enrollDate: null,
  studentStatus: 3,
  remark: '',
});

// ★ 2026-10-06：接受班级只读，无需校验（由咨询/初高推送时决定）
const receiveRules: FormRules = {};

function openReceive(row: ConsultItem): void {
  activeConsult.value = row;
  // 接受班级：**只能**取咨询 / 初高推送的意向班级，不接收任何人工改写
  receiveForm.classId = row.intendClassId ?? null;
  receiveForm.studentNo = '';
  receiveForm.stage = row.intendStage ?? null;
  receiveForm.age = row.age;
  receiveForm.phone = row.phone || '';
  receiveForm.parentPhone = row.parentPhone || '';
  receiveForm.education = row.education;
  receiveForm.enrollDate = null;
  receiveForm.studentStatus = 3;
  receiveForm.remark = row.remark || '';
  dormPick.value = { dormId: null, dormNo: null, bedNo: null };
  receiveVisible.value = true;
}

async function submitReceive(): Promise<void> {
  const okForm = await receiveRef.value?.validate().catch(() => false);
  if (!okForm || !activeConsult.value) return;
  saving.value = true;
  try {
    await consultReceive({
      id: activeConsult.value.id,
      // 只读透传：后端仍以推送单上的意向班级为准，不信任前端传值
      classId: activeConsult.value.intendClassId ?? null,
      studentNo: receiveForm.studentNo.trim() || null,
      stage: receiveForm.stage,
      age: receiveForm.age,
      phone: receiveForm.phone || null,
      parentPhone: receiveForm.parentPhone || null,
      education: receiveForm.education,
      enrollDate: receiveForm.enrollDate,
      studentStatus: receiveForm.studentStatus,
      dormId: dormPick.value.dormId,
      dormNo: dormPick.value.dormNo,
      bedNo: dormPick.value.bedNo,
      remark: receiveForm.remark || null,
    });
    ElMessage.success('已接收，学员已落入学员档案');
    receiveVisible.value = false;
    await Promise.all([loadKpi(), loadPending(), loadTable()]);
  } catch {
    // request 层已弹提示
  } finally {
    saving.value = false;
  }
}

/* ---------------- 驳回 ---------------- */
const rejectVisible = ref(false);
const rejectRef = ref<FormInstance>();
const rejectForm = reactive<{ id: string; rejectReason: string }>({ id: '', rejectReason: '' });
const rejectRules: FormRules = {
  rejectReason: [{ required: true, message: '请填写驳回原因', trigger: 'blur' }],
};

function openReject(row: ConsultItem): void {
  activeConsult.value = row;
  rejectForm.id = row.id;
  rejectForm.rejectReason = '';
  rejectVisible.value = true;
}

async function submitReject(): Promise<void> {
  const okForm = await rejectRef.value?.validate().catch(() => false);
  if (!okForm) return;
  saving.value = true;
  try {
    await consultReject({ id: rejectForm.id, rejectReason: rejectForm.rejectReason.trim() });
    ElMessage.success('已驳回');
    rejectVisible.value = false;
    await Promise.all([loadKpi(), loadPending(), loadTable()]);
  } catch {
    // request 层已弹提示
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  await dict.ensure();
  await Promise.all([loadKpi(), loadPending(), loadTable()]);
});
</script>

<style scoped>
.panel-card {
  border: 1px solid var(--line);
  border-radius: var(--r-m);
  box-shadow: var(--sh-1);
  margin-top: 12px;
}
.panel-card :deep(.el-card__body) {
  padding: 12px 14px;
}
.w-search {
  width: 240px;
}
.block-title {
  font-weight: 600;
  font-size: 14px;
  margin-bottom: 10px;
}
.card-area {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
}
.consult-card {
  border: 1px solid var(--line);
  border-radius: var(--r-s);
  padding: 12px;
  background: var(--bg-soft);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.cc-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.cc-age {
  font-size: 12px;
  color: var(--text-2);
}
.cc-line {
  font-size: 13px;
  color: var(--text);
  line-height: 1.5;
}
.cc-k {
  display: inline-block;
  width: 56px;
  flex: none;
  color: var(--text-2);
}
.cc-accept {
  display: flex;
  align-items: center;
}
.cc-select {
  flex: 1;
}
.cc-miss {
  color: var(--el-color-warning);
  font-weight: 400;
}
.form-hint {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-2);
}
.cc-remark {
  color: var(--text-2);
}
.cc-fn {
  margin-top: 8px;
  display: flex;
  gap: 8px;
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}
</style>
