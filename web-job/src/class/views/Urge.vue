<template>
  <div class="note-box brand">
    催费数据<b>同步自教务管理</b>（本模块只读，不回写上游）；这里执行的「催收」只在本模块记录催费流水，
    并把催费次数 +1。金额单位统一为<b>分</b>，页面按元展示。
  </div>

  <!-- 统计卡片 -->
  <div class="kpi-row">
    <div class="kpi k-red">
      <div class="kpi-l">逾期人数</div>
      <div class="kpi-v">{{ overdueCount }}<small>人</small></div>
      <div class="kpi-s">逾期即到期日已过且未缴</div>
    </div>
    <div class="kpi">
      <div class="kpi-l">待催费条数</div>
      <div class="kpi-v">{{ total }}<small>条</small></div>
      <div class="kpi-s">当前筛选命中数</div>
    </div>
    <div class="kpi k-amber">
      <div class="kpi-l">待缴合计</div>
      <div class="kpi-v">¥{{ totalAmountYuan }}</div>
      <div class="kpi-s">仅统计待缴 / 逾期</div>
    </div>
  </div>

  <el-card shadow="never" class="panel-card">
    <div class="toolbar">
      <el-input
        v-model="filters.keyword"
        class="w-search"
        placeholder="搜索姓名 / 学号"
        clearable
        :prefix-icon="Search"
        @keyup.enter="applyFilters"
        @clear="applyFilters"
      />
      <el-select v-model="filters.classId" placeholder="全部班级" clearable style="width: 150px" @change="applyFilters">
        <el-option v-for="c in classList" :key="c.id" :label="c.className" :value="c.id" />
      </el-select>
      <el-select v-model="filters.feeType" placeholder="全部费用类型" clearable style="width: 150px" @change="applyFilters">
        <el-option v-for="o in dict.options('feeType')" :key="o.value" :label="o.label" :value="o.value" />
      </el-select>
      <el-select v-model="filters.payStatus" placeholder="全部缴费状态" clearable style="width: 150px" @change="applyFilters">
        <el-option v-for="o in dict.options('payStatus')" :key="o.value" :label="o.label" :value="o.value" />
      </el-select>
      <el-checkbox v-model="filters.onlyOverdue" @change="applyFilters">仅看逾期</el-checkbox>
      <el-button :icon="Search" @click="applyFilters">搜索</el-button>

      <span class="spacer" />

      <el-button link type="primary" :disabled="!selected.length" @click="batchUrge">
        批量催收（已选 {{ selected.length }} 条）
      </el-button>
    </div>

    <el-table
      v-loading="loading"
      :data="rows"
      size="small"
      border
      style="margin-top: 12px"
      row-key="id"
      @selection-change="(v: UrgeRow[]) => (selected = v)"
    >
      <el-table-column type="selection" width="40" />
      <el-table-column prop="studentName" label="姓名" width="110" fixed>
        <template #default="{ row }">
          <span class="avatar-sq">{{ (row.studentName || '').slice(0, 1) }}</span>
          <b>{{ row.studentName }}</b>
        </template>
      </el-table-column>
      <el-table-column prop="studentNo" label="学号" width="120" />
      <el-table-column prop="className" label="班级" width="90">
        <template #default="{ row }">{{ row.className || '—' }}</template>
      </el-table-column>
      <el-table-column label="欠费类型" width="100">
        <template #default="{ row }">{{ row.feeTypeName || dict.label('feeType', row.feeType) }}</template>
      </el-table-column>
      <el-table-column label="欠费金额" width="112" align="right">
        <template #default="{ row }"><b class="money">¥{{ row.amountYuan }}</b></template>
      </el-table-column>
      <el-table-column prop="expireDate" label="到期日期" width="106" />
      <el-table-column label="逾期天数" width="94" align="right">
        <template #default="{ row }">
          <el-tag v-if="row.isOverdue" type="danger" size="small" effect="light">{{ row.overdueDays }} 天</el-tag>
          <span v-else class="dim">未逾期</span>
        </template>
      </el-table-column>
      <el-table-column label="缴费状态" width="100">
        <template #default="{ row }">
          <el-tag :type="dict.tagTypeOf('payStatus', row.payStatus)" size="small" effect="light">
            {{ row.payStatusName || dict.label('payStatus', row.payStatus) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="联系方式" width="150">
        <template #default="{ row }">
          <div class="phone-cell">
            <span>{{ row.phone || '—' }}</span>
            <span class="dim">家长 {{ row.parentPhone || '—' }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column prop="headTeacherName" label="班主任" width="96">
        <template #default="{ row }">{{ row.headTeacherName || '—' }}</template>
      </el-table-column>
      <el-table-column label="催费次数" width="94" align="right">
        <template #default="{ row }">
          <el-tag v-if="row.urgeCount" type="warning" size="small" effect="light">{{ row.urgeCount }} 次</el-tag>
          <span v-else>0 次</span>
        </template>
      </el-table-column>
      <el-table-column prop="lastUrgeTime" label="最近催收" width="150">
        <template #default="{ row }">{{ row.lastUrgeTime || '—' }}</template>
      </el-table-column>
      <el-table-column label="功能" width="130" fixed="right">
        <template #default="{ row }">
          <div class="fn-cell">
            <el-button link type="primary" size="small" @click="openUrge(row)">催收</el-button>
            <el-button link type="primary" size="small" @click="openLogs(row)">催收记录</el-button>
          </div>
        </template>
      </el-table-column>
      <template #empty>
        <el-empty :image-size="70" description="没有催费记录" />
      </template>
    </el-table>

    <el-pagination
      v-model:current-page="page"
      v-model:page-size="size"
      :total="total"
      :page-sizes="[10, 20, 50, 100]"
      layout="total, sizes, prev, pager, next, jumper"
      @current-change="load"
      @size-change="onSizeChange"
    />
  </el-card>

  <!-- ============ 执行催收 ============ -->
  <el-dialog v-model="urgeVisible" title="执行催收" width="560px" destroy-on-close>
    <el-form ref="urgeRef" :model="urgeForm" :rules="urgeRules" label-width="100px">
      <el-form-item label="学员">
        <el-input :model-value="urgeTargetText" disabled />
      </el-form-item>
      <el-form-item label="催收渠道" prop="channel">
        <el-radio-group v-model="urgeForm.channel">
          <el-radio value="phone">电话</el-radio>
          <el-radio value="sms">短信</el-radio>
          <el-radio value="wechat">微信</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="催收说明">
        <el-input v-model="urgeForm.remark" type="textarea" :rows="3" placeholder="如：已电话联系家长，承诺 3 日内缴清" />
      </el-form-item>
    </el-form>
    <div v-if="batchMode" class="note-box">
      批量催收将对已勾选的 <b>{{ selected.length }}</b> 条记录逐个执行，渠道与说明统一使用本次填写的内容。
    </div>
    <template #footer>
      <el-button @click="urgeVisible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="submitUrge">确认催收</el-button>
    </template>
  </el-dialog>

  <!-- ============ 催收记录 ============ -->
  <el-dialog v-model="logVisible" title="催收记录" width="720px" destroy-on-close>
    <div v-loading="logLoading">
      <el-table :data="logs" size="small" border max-height="360">
        <el-table-column prop="urgeTime" label="催收时间" width="160" />
        <el-table-column prop="studentName" label="学员" width="110">
          <template #default="{ row }"><b>{{ row.studentName }}</b></template>
        </el-table-column>
        <el-table-column label="渠道" width="90">
          <template #default="{ row }">{{ row.channelName || channelName(row.channel) }}</template>
        </el-table-column>
        <el-table-column prop="operatorName" label="操作人" width="110">
          <template #default="{ row }">{{ row.operatorName || '—' }}</template>
        </el-table-column>
        <el-table-column prop="remark" label="说明" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ row.remark || '—' }}</template>
        </el-table-column>
        <template #empty><el-empty :image-size="60" description="暂无催收记录" /></template>
      </el-table>
    </div>
    <template #footer><el-button @click="logVisible = false">关闭</el-button></template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { Search } from '@element-plus/icons-vue';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { classOptions, urgeDo, urgeList, urgeLogList } from '@/class/api/student';
import type { ClassRow, UrgeLogRow, UrgeRow } from '@/class/api/types';
import { useDictStore } from '@/class/stores/dict';

/**
 * 催费管理
 *
 * 需求二：催费信息同步自教务管理。所以本页所有「待缴 / 逾期」判断都基于
 * 同步副本 `t_class_urge_sync`，本模块不产生催费数据，只产生催收动作流水。
 */
const dict = useDictStore();

const loading = ref(false);
const saving = ref(false);
const rows = ref<UrgeRow[]>([]);
const total = ref(0);
const page = ref(1);
const size = ref(10);
const classList = ref<ClassRow[]>([]);
const selected = ref<UrgeRow[]>([]);

const filters = reactive<{
  keyword: string;
  classId: string | null;
  feeType: number | null;
  payStatus: number | null;
  onlyOverdue: boolean;
}>({ keyword: '', classId: null, feeType: null, payStatus: null, onlyOverdue: false });

/** 当前页的逾期人数（不是全量，卡片上已注明口径） */
const overdueCount = computed(() => rows.value.filter((r) => r.isOverdue).length);

/** 待缴合计：只在「待缴 / 逾期 / 冻结」这些未结清状态上求和 */
const totalAmountYuan = computed(() => {
  const sum = rows.value
    .filter((r) => [1, 4, 5].includes(r.payStatus))
    .reduce((acc, r) => acc + Number(r.amount ?? 0), 0);
  return (sum / 100).toFixed(2);
});

function channelName(c: string): string {
  return { phone: '电话', sms: '短信', wechat: '微信' }[c] ?? c;
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const res = await urgeList({
      page: page.value,
      size: size.value,
      keyword: filters.keyword.trim() || undefined,
      classId: filters.classId ?? undefined,
      feeType: filters.feeType ?? undefined,
      payStatus: filters.payStatus ?? undefined,
      onlyOverdue: filters.onlyOverdue || undefined,
    });
    rows.value = res.list ?? [];
    total.value = res.total ?? 0;
  } finally {
    loading.value = false;
  }
}

function applyFilters(): void {
  page.value = 1;
  void load();
}

function onSizeChange(): void {
  page.value = 1;
  void load();
}

/* ---------------- 催收 ---------------- */
const urgeVisible = ref(false);
const batchMode = ref(false);
const urgeRef = ref<FormInstance>();
const urgeForm = reactive<{ channel: 'phone' | 'sms' | 'wechat'; remark: string }>({
  channel: 'phone',
  remark: '',
});
const urgeTarget = ref<UrgeRow | null>(null);

const urgeRules: FormRules = {
  channel: [{ required: true, message: '请选择催收渠道', trigger: 'change' }],
};

const urgeTargetText = computed(() => {
  if (batchMode.value) return `已选 ${selected.value.length} 条记录`;
  const t = urgeTarget.value;
  return t ? `${t.studentName} · ${t.studentNo} · 欠费 ¥${t.amountYuan}` : '—';
});

function openUrge(row: UrgeRow): void {
  batchMode.value = false;
  urgeTarget.value = row;
  urgeForm.channel = 'phone';
  urgeForm.remark = '';
  urgeVisible.value = true;
}

function batchUrge(): void {
  if (!selected.value.length) return;
  batchMode.value = true;
  urgeTarget.value = null;
  urgeForm.channel = 'phone';
  urgeForm.remark = '';
  urgeVisible.value = true;
}

async function submitUrge(): Promise<void> {
  const okForm = await urgeRef.value?.validate().catch(() => false);
  if (!okForm) return;

  const targets = batchMode.value ? selected.value : urgeTarget.value ? [urgeTarget.value] : [];
  if (!targets.length) return;

  saving.value = true;
  let okCount = 0;
  let failCount = 0;
  try {
    // 串行执行：并发打同一个接口容易触发上游限流，
    // 且失败时能明确知道是哪几条没成功，便于用户重试。
    for (const t of targets) {
      try {
        await urgeDo({ urgeId: t.id, channel: urgeForm.channel, remark: urgeForm.remark || undefined });
        okCount += 1;
      } catch {
        failCount += 1;
      }
    }
    if (failCount === 0) ElMessage.success(`已完成 ${okCount} 条催收`);
    else ElMessage.warning(`成功 ${okCount} 条，失败 ${failCount} 条，请重试失败的记录`);
    urgeVisible.value = false;
    selected.value = [];
    await load();
  } finally {
    saving.value = false;
  }
}

/* ---------------- 催收记录 ---------------- */
const logVisible = ref(false);
const logLoading = ref(false);
const logs = ref<UrgeLogRow[]>([]);

async function openLogs(row: UrgeRow): Promise<void> {
  logVisible.value = true;
  logs.value = [];
  logLoading.value = true;
  try {
    const res = await urgeLogList({ page: 1, size: 100, studentId: row.studentId });
    logs.value = res.list ?? [];
  } finally {
    logLoading.value = false;
  }
}

onMounted(async () => {
  await dict.ensure();
  classList.value = (await classOptions()).list ?? [];
  await load();
});
</script>

<style scoped>
.panel-card {
  border: 1px solid var(--line);
  border-radius: var(--r-m);
  box-shadow: var(--sh-1);
}
.panel-card :deep(.el-card__body) {
  padding: 12px 14px;
}
.w-search {
  width: 210px;
}
.dim {
  color: var(--text-2);
}
.money {
  font-variant-numeric: tabular-nums;
  color: var(--red, #d93025);
}
.phone-cell {
  display: flex;
  flex-direction: column;
  line-height: 1.4;
  font-size: 12px;
}
</style>
